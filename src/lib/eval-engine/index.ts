import { DISCLAIMER } from "../copy/disclaimer";
import type { Usage } from "../llm/types";
import {
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type Citation,
  type EvalComment,
  type EvaluationInput,
  type EvaluationResult,
  type RawJudgement,
  type Span,
} from "../schemas/evaluation";
import { mayBeOutdated, verifyCitation, type CheckWithSource } from "../sources";
import { locateQuote, overlaps } from "../util/text";
import { extractFeatures } from "./features";
import type { Judge } from "./judges/types";
import { runPatternChecks } from "./pattern-facts";
import { clampSuggestion, isGeneric, repairText, validateResult, type Violation } from "./validate";

export interface EngineRun {
  result: EvaluationResult;
  usage: Usage;
  models: string[];
  violations: Violation[];
}

const SEVERITY_WEIGHT = { minor: 1, moderate: 2, major: 3 } as const;

export const roundHalf = (x: number) => Math.round(x * 2) / 2;
const floorHalf = (x: number) => Math.floor(x * 2 + 1e-9) / 2;
const ceilHalf = (x: number) => Math.ceil(x * 2 - 1e-9) / 2;
export const round2 = (x: number) => Math.round(x * 100) / 100;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function spansFor(text: string, quotes: string[]): Span[] {
  const out: Span[] = [];
  for (const q of quotes) {
    const loc = locateQuote(text, q);
    if (!loc) continue;
    if (out.some((s) => s.start === loc.start && s.end === loc.end)) continue;
    out.push({ start: loc.start, end: loc.end, quote: text.slice(loc.start, loc.end) });
  }
  return out;
}

interface Candidate {
  sample: number;
  raw: RawJudgement["comments"][number];
  spans: Span[];
  citations: Citation[];
  droppedCitations: number;
}

/**
 * Evaluate an answer: run `samples` independent judgements, aggregate (median bands; comments kept
 * when supported by a majority of samples or marked uncertain), map bands to marks in code, attach
 * deterministic pattern-based fact checks, then validate. The judge never produces the total.
 */
export async function evaluateAnswer(
  input: EvaluationInput,
  judge: Judge,
  opts: { patternChecks?: CheckWithSource[]; isAi: boolean; providerName: "anthropic" | "heuristic" | "mock"; providerLabel: string },
): Promise<EngineRun> {
  const text = input.transcript.text;
  const notes: string[] = [];
  let repairs = 0;
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const models = new Set<string>();

  // ---- 1. Samples (deterministic judges need only one) ----
  const nSamples = judge.name === "heuristic" ? 1 : input.engine.samples;
  const samples: RawJudgement[] = [];
  const errors: string[] = [];
  // Samples are independent, so run them concurrently (keeps evaluation inside serverless time
  // limits); results are consumed in sample order so aggregation stays deterministic.
  const settled = await Promise.allSettled(Array.from({ length: nSamples }, (_, i) => judge.judge(input, i)));
  for (const r of settled) {
    if (r.status === "fulfilled") {
      samples.push(r.value.raw);
      usage.inputTokens += r.value.usage.inputTokens;
      usage.outputTokens += r.value.usage.outputTokens;
      models.add(r.value.model);
    } else {
      errors.push((r.reason as Error)?.message ?? String(r.reason));
    }
  }
  if (samples.length === 0) throw new Error(`All evaluation samples failed: ${errors.join(" | ").slice(0, 500)}`);
  if (errors.length) notes.push(`${errors.length} sample(s) failed and were excluded`);

  // ---- 2. Criteria: median band, spread ----
  const enabled = input.rubric_version.criteria.filter((c) => c.input_modes.includes(input.transcript.input_mode));
  const weightSum = enabled.reduce((s, c) => s + c.weight, 0);
  const maxBand = input.rubric_version.max_band;
  const Q = input.question.marks;
  const spread: Record<string, number> = {};
  const criteria: EvaluationResult["criteria"] = enabled.map((c) => {
    const entries = samples.map((s) => s.criteria.find((x) => x.code === c.code)).filter((x): x is NonNullable<typeof x> => !!x);
    const bands = entries.map((e) => Math.max(0, Math.min(maxBand, e.band)));
    if (bands.length === 0) {
      notes.push(`criterion ${c.code} missing from all samples; scored 0 with low confidence`);
      repairs++;
    }
    const band = bands.length ? median(bands) : 0;
    spread[c.code] = bands.length ? Math.max(...bands) - Math.min(...bands) : maxBand;
    const rep = entries.find((e) => Math.max(0, Math.min(maxBand, e.band)) === band) ?? entries[0];
    const marksMax = (Q * c.weight) / weightSum;
    const descriptor = c.bands.find((b) => b.band === band);
    let rationale = rep?.rationale ?? "No judgement returned for this criterion.";
    rationale = repairText(rationale, notes, `criterion ${c.code}`);
    return {
      code: c.code,
      name: c.name,
      band,
      max_band: maxBand,
      band_range: { low: bands.length ? Math.min(...bands) : 0, high: bands.length ? Math.max(...bands) : maxBand },
      marks_awarded: round2((marksMax * band) / maxBand),
      marks_max: round2(marksMax),
      rationale,
      descriptor_matched: descriptor?.descriptor_id ?? `${c.code}.${band}`,
      descriptor_text: descriptor?.descriptor ?? "",
    };
  });

  // ---- 3. Comments: locate quotes, verify citations, cluster across samples ----
  const uncertainSpans = input.transcript.uncertain_spans;
  const candidates: Candidate[] = [];
  samples.forEach((s, si) => {
    for (const raw of s.comments) {
      if (!enabled.some((c) => c.code === raw.criterion_code)) {
        repairs++;
        notes.push(`dropped comment for disabled/unknown criterion ${raw.criterion_code}`);
        continue;
      }
      if (!input.context.skill_tags.includes(raw.skill_tag)) {
        repairs++;
        notes.push(`dropped comment with unknown skill tag ${raw.skill_tag}`);
        continue;
      }
      const spans = spansFor(text, raw.quotes);
      if (raw.quotes.length > 0 && spans.length < raw.quotes.length) {
        repairs++;
        notes.push(`comment quote(s) not found in answer were discarded (${raw.quotes.length - spans.length})`);
      }
      const citations: Citation[] = [];
      let dropped = 0;
      for (const c of raw.citations) {
        const v = verifyCitation(input.context.retrieved_sources, c.source_chunk_id, c.quote);
        if (v) citations.push(v);
        else dropped++;
      }
      if (dropped) {
        repairs++;
        notes.push(`dropped ${dropped} unverifiable citation(s)`);
      }
      candidates.push({ sample: si, raw, spans, citations, droppedCitations: dropped });
    }
  });

  interface Cluster {
    members: Candidate[];
  }
  const clusters: Cluster[] = [];
  const positive = (k: string) => k === "strength";
  for (const cand of candidates) {
    const match = clusters.find((cl) => {
      const r = cl.members[0];
      if (r.raw.skill_tag !== cand.raw.skill_tag || positive(r.raw.kind) !== positive(cand.raw.kind)) return false;
      if (r.spans.length && cand.spans.length) return r.spans.some((a) => cand.spans.some((b) => overlaps(a, b)));
      if (!r.spans.length && !cand.spans.length) return (r.raw.question_part_id ?? null) === (cand.raw.question_part_id ?? null);
      return false;
    });
    if (match) match.members.push(cand);
    else clusters.push({ members: [cand] });
  }
  const need = samples.length > 1 ? Math.ceil(samples.length / 2) : 1;
  let comments: EvalComment[] = [];
  for (const cl of clusters) {
    const support = new Set(cl.members.map((m) => m.sample)).size;
    const rep = cl.members[0];
    const raw = rep.raw;
    const evidenceMissing =
      rep.spans.length === 0 &&
      !((raw.kind === "missing_dimension" || raw.kind === "presentation") && (raw.question_part_id || raw.rubric_descriptor_id));
    if (evidenceMissing) {
      repairs++;
      notes.push(`dropped a ${raw.kind} comment with no locatable evidence`);
      continue;
    }
    let uncertain = raw.uncertain;
    let reason: string | null = raw.uncertainty_reason ?? null;
    if (support < need) {
      uncertain = true;
      reason = reason ?? `low_sample_agreement (${support}/${samples.length} samples)`;
    }
    if (rep.spans.some((s) => uncertainSpans.some((u) => overlaps(s, u)))) {
      uncertain = true;
      reason = reason ?? "ocr_uncertain_region";
    }
    const citations = rep.citations.length ? rep.citations : cl.members.flatMap((m) => m.citations).slice(0, 2);
    if (raw.kind === "factual_error" && citations.length === 0) {
      uncertain = true;
      reason = "no_supporting_source";
    }
    let message = repairText(raw.message, notes, "comment");
    if (!message) continue;
    let suggestion = clampSuggestion(repairText(raw.suggestion, notes, "suggestion"), notes, "suggestion");
    if (!suggestion) suggestion = "Use the hint ladder for a targeted nudge.";
    if (
      raw.kind !== "strength" &&
      raw.kind !== "missing_dimension" &&
      raw.kind !== "presentation" &&
      isGeneric(message, rep.spans.map((s) => s.quote).join(" "), input.question.text) &&
      !uncertain
    ) {
      // Do not hide it, but be honest that it may be generic.
      uncertain = true;
      reason = "possibly_generic";
    }
    if (citations.some((c) => c.may_be_outdated)) message += " (The cited source may be outdated — check the latest figure.)";
    comments.push({
      id: "",
      criterion_code: raw.criterion_code,
      skill_tag: raw.skill_tag,
      kind: raw.kind,
      severity: raw.severity,
      message,
      evidence: {
        answer_spans: rep.spans,
        question_part_id: raw.question_part_id ?? null,
        rubric_descriptor_id: raw.rubric_descriptor_id ?? null,
        citations,
      },
      suggestion,
      uncertain,
      uncertainty_reason: uncertain ? reason : null,
      sample_support: support,
    });
  }

  // ---- 4. Engine-level deterministic checks: injection lines, word limit, pattern facts ----
  const feats = extractFeatures(text);
  for (const s of feats.injectionSentences.slice(0, 2)) {
    const span: Span = { start: s.start, end: s.end, quote: text.slice(s.start, s.end) };
    if (comments.some((c) => c.skill_tag === "CONTENT.irrelevance" && c.evidence.answer_spans.some((x) => overlaps(x, span)))) continue;
    comments.push({
      id: "",
      criterion_code: "CONTENT",
      skill_tag: "CONTENT.irrelevance",
      kind: "weakness",
      severity: "minor",
      message: "This line addresses the evaluator rather than the question. It earns no credit and was ignored when judging the answer.",
      evidence: { answer_spans: [span], question_part_id: null, rubric_descriptor_id: null, citations: [] },
      suggestion: "Remove it; spend the words on the question.",
      uncertain: false,
      uncertainty_reason: null,
      sample_support: samples.length,
    });
  }

  const limit = input.question.word_limit;
  const wc = input.transcript.word_count;
  let wlStatus: EvaluationResult["word_limit"]["status"] = "no_limit";
  if (limit) {
    wlStatus = wc > limit * (1 + input.question.word_tolerance_pct / 100) ? "over" : wc < limit * 0.6 ? "under" : "within";
    const sents = feats.usableSentences;
    if (wlStatus === "over" && sents.length) {
      // Point at the first sentence that falls beyond the limit.
      let count = 0;
      const beyond = sents.find((s) => (count += s.text.split(/\s+/).length) > limit) ?? sents[sents.length - 1];
      comments.push({
        id: "",
        criterion_code: "LANGUAGE",
        skill_tag: "TIME.over_limit",
        kind: "weakness",
        severity: "minor",
        message: `The answer is ${wc} words against a limit of about ${limit}. In the exam, extra words cost time you need for other questions. The limit is crossed around here.`,
        evidence: { answer_spans: [{ start: beyond.start, end: beyond.end, quote: text.slice(beyond.start, beyond.end) }], question_part_id: null, rubric_descriptor_id: null, citations: [] },
        suggestion: "Cut repetition and merge overlapping points to land near the limit.",
        uncertain: false,
        uncertainty_reason: null,
        sample_support: samples.length,
      });
    } else if (wc < limit * 0.4 && sents.length) {
      const lastS = sents[sents.length - 1];
      comments.push({
        id: "",
        criterion_code: "LANGUAGE",
        skill_tag: "TIME.incomplete",
        kind: "weakness",
        severity: "moderate",
        message: `At ${wc} words against a limit of about ${limit}, the answer is too short to develop the parts the question asks for.`,
        evidence: { answer_spans: [{ start: lastS.start, end: lastS.end, quote: text.slice(lastS.start, lastS.end) }], question_part_id: null, rubric_descriptor_id: null, citations: [] },
        suggestion: "Plan 3–4 points before writing and budget words per part.",
        uncertain: false,
        uncertainty_reason: null,
        sample_support: samples.length,
      });
    }
  }

  // Factual checks: from samples (llm) + deterministic patterns.
  const factual: EvaluationResult["factual_checks"] = [];
  for (const s of samples) {
    for (const fc of s.factual_checks) {
      const loc = locateQuote(text, fc.claim_quote);
      if (!loc) {
        repairs++;
        notes.push("dropped a factual check whose claim could not be located");
        continue;
      }
      const span: Span = { start: loc.start, end: loc.end, quote: text.slice(loc.start, loc.end) };
      if (factual.some((x) => overlaps(x.claim_span, span))) continue;
      const cites = fc.citations.map((c) => verifyCitation(input.context.retrieved_sources, c.source_chunk_id, c.quote)).filter((c): c is Citation => !!c);
      let verdict = fc.verdict;
      if ((verdict === "contradicted" || verdict === "outdated" || verdict === "supported") && cites.length === 0) {
        if (verdict !== "supported") {
          repairs++;
          notes.push(`factual verdict '${verdict}' downgraded to unverifiable (no verified citation)`);
        }
        verdict = "unverifiable";
      }
      factual.push({ claim_span: span, verdict, citations: cites, note: repairText(fc.note, notes, "factual note"), method: "llm" });
    }
  }
  const pattern = opts.patternChecks ? runPatternChecks(text, opts.patternChecks) : [];
  for (const p of pattern) {
    const chunk = opts.patternChecks!.find((c) => c.source.source_chunk_id === p.sourceChunkId)!.source;
    const citation: Citation = {
      source_chunk_id: chunk.source_chunk_id,
      source_title: chunk.title,
      source_url: chunk.url,
      published_on: chunk.published_on,
      quote: p.sourceQuote,
      text_kind: chunk.text_kind,
      verification_status: chunk.verification_status,
      may_be_outdated: mayBeOutdated(chunk),
    };
    // Make the cited chunk part of the retrieved set so validators can check it.
    if (!input.context.retrieved_sources.some((r) => r.source_chunk_id === chunk.source_chunk_id)) input.context.retrieved_sources.push(chunk);
    const span: Span = { start: p.claimStart, end: p.claimEnd, quote: text.slice(p.claimStart, p.claimEnd) };
    const existing = factual.findIndex((x) => overlaps(x.claim_span, span));
    const entry = { claim_span: span, verdict: p.verdict, citations: [citation], note: p.note, method: "pattern" as const };
    if (existing >= 0) {
      if (factual[existing].verdict === "unverifiable") factual[existing] = entry;
    } else factual.push(entry);
    if (p.verdict === "contradicted" && !comments.some((c) => c.kind === "factual_error" && c.evidence.answer_spans.some((s) => overlaps(s, span)))) {
      comments.push({
        id: "",
        criterion_code: "EVIDENCE",
        skill_tag: "EVIDENCE.factual_error",
        kind: "factual_error",
        severity: "moderate",
        message: `${p.note} Check this against the cited source before your next attempt.`,
        evidence: { answer_spans: [span], question_part_id: null, rubric_descriptor_id: "EVIDENCE.1", citations: [citation] },
        suggestion: "Correct the figure or date, or drop it if you are unsure — a wrong specific costs more than a general statement.",
        uncertain: false,
        uncertainty_reason: null,
        sample_support: samples.length,
      });
    }
  }
  // A cited factual error caps the evidence criterion at band 2 (applied once, not double-penalised elsewhere).
  if (comments.some((c) => c.kind === "factual_error" && !c.uncertain)) {
    const ev = criteria.find((c) => c.code === "EVIDENCE");
    if (ev && ev.band > 2) {
      const rc = enabled.find((c) => c.code === "EVIDENCE")!;
      ev.band = 2;
      ev.band_range = { low: Math.min(ev.band_range.low, 2), high: Math.min(ev.band_range.high, Math.max(2, ev.band_range.high)) };
      ev.marks_awarded = round2((ev.marks_max * 2) / maxBand);
      ev.descriptor_matched = rc.bands.find((b) => b.band === 2)?.descriptor_id ?? "EVIDENCE.2";
      ev.descriptor_text = rc.bands.find((b) => b.band === 2)?.descriptor ?? "";
      ev.rationale += " Capped because a cited factual error was found.";
    }
  }

  // Order: weaknesses by severity, then strengths; assign ids.
  comments = comments
    .sort((a, b) => Number(a.kind === "strength") - Number(b.kind === "strength") || SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity])
    .map((c, i) => ({ ...c, id: `c${i + 1}` }));

  // ---- 5. Totals, range, confidence ----
  const point = round2(Math.min(Q, criteria.reduce((s, c) => s + c.marks_awarded, 0)));
  let low = criteria.reduce((s, c) => s + (c.marks_max * c.band_range.low) / maxBand, 0);
  let high = criteria.reduce((s, c) => s + (c.marks_max * c.band_range.high) / maxBand, 0);
  const reasons: string[] = [];
  let confidence: "high" | "medium" | "low" = "high";
  const downgrade = (to: "medium" | "low", why: string) => {
    reasons.push(why);
    if (to === "low" || confidence === "high") confidence = to;
  };
  if (!opts.isAi) downgrade("low", "rule_based_demo_evaluator");
  if (samples.length < 2 && opts.isAi) downgrade("medium", "single_sample");
  const maxSpread = Math.max(0, ...Object.values(spread));
  if (maxSpread >= 2) downgrade("low", "sample_disagreement");
  else if (maxSpread === 1) downgrade("medium", "minor_sample_disagreement");
  const uncertainChars = uncertainSpans.reduce((s, u) => s + (u.end - u.start), 0);
  if (text.length && uncertainChars / text.length > 0.15) downgrade("low", "ocr_uncertain_spans");
  else if (uncertainChars > 0) downgrade("medium", "ocr_uncertain_spans");
  if (wlStatus === "under" && limit && wc < limit * 0.4) downgrade("medium", "very_short_answer");
  if (comments.some((c) => c.skill_tag === "CONTENT.irrelevance" && c.severity === "major")) downgrade("medium", "possible_off_topic_answer");
  if (errors.length) downgrade("medium", "some_samples_failed");
  // Minimum honest band of ±0.5 marks around a single-sample or heuristic estimate.
  if (confidence !== "high") {
    low = Math.min(low, point - 0.5);
    high = Math.max(high, point + 0.5);
  }
  if (uncertainChars > 0) {
    const widen = roundHalf(Q * Math.min(0.2, uncertainChars / Math.max(1, text.length)));
    low -= widen;
    high += widen;
  }
  low = Math.max(0, floorHalf(Math.min(low, point)));
  high = Math.min(Q, ceilHalf(Math.max(high, point)));

  // ---- 6. Priorities, next action, self-assessment gap, rewrite delta ----
  const weightOf = (code: string) => enabled.find((c) => c.code === code)?.weight ?? 0;
  const priorities = comments
    .filter((c) => c.kind !== "strength" && !c.uncertain)
    .sort((a, b) => SEVERITY_WEIGHT[b.severity] * weightOf(b.criterion_code) - SEVERITY_WEIGHT[a.severity] * weightOf(a.criterion_code))
    .slice(0, 3)
    .map((c) => {
      const crit = criteria.find((x) => x.code === c.criterion_code);
      return {
        comment_id: c.id,
        why_first: `${c.severity[0].toUpperCase()}${c.severity.slice(1)} issue in ${crit?.name ?? c.criterion_code}, a criterion worth up to ${crit?.marks_max ?? "?"} of ${Q} marks.`,
      };
    });
  const targetTags = Array.from(new Set(priorities.map((p) => comments.find((c) => c.id === p.comment_id)!.skill_tag)));

  let rewriteDelta: EvaluationResult["rewrite_delta"] = null;
  const prior = input.context.prior_evaluation_summary;
  if (prior) {
    const llmDelta = samples[0].rewrite_delta ?? [];
    rewriteDelta = prior.comments
      .filter((pc) => pc.kind !== "strength")
      .map((pc) => {
        const now = comments.filter((c) => c.kind !== "strength" && c.skill_tag === pc.skill_tag && !c.uncertain);
        let status: "resolved" | "partially" | "unresolved" | "regressed" = "resolved";
        if (now.length) {
          const worst = Math.max(...now.map((c) => SEVERITY_WEIGHT[c.severity]));
          const before = SEVERITY_WEIGHT[pc.severity as keyof typeof SEVERITY_WEIGHT] ?? 2;
          status = worst > before ? "regressed" : worst < before ? "partially" : "unresolved";
        }
        const d = llmDelta.find((x) => x.prior_comment_id === pc.id);
        let spans = now.flatMap((c) => c.evidence.answer_spans).slice(0, 2);
        if (d) {
          const ds = spansFor(text, d.quotes);
          // Prefer the model's judgement only when it can point at evidence in the new answer.
          if (ds.length) {
            status = d.status;
            spans = ds;
          }
        }
        return { prior_comment_id: pc.id, prior_message: pc.message, skill_tag: pc.skill_tag, status, evidence_spans: spans };
      });
  }

  const allResolved = rewriteDelta && rewriteDelta.length > 0 && rewriteDelta.every((d) => d.status === "resolved");
  let instruction = repairText(samples[0].next_action_instruction || "", notes, "next action");
  if (!instruction) instruction = "Rewrite the highlighted paragraph without looking at a model answer, then try a fresh related question.";
  const nextAction: EvaluationResult["next_action"] = allResolved
    ? { type: "retest", target_skill_tags: rewriteDelta!.map((d) => d.skill_tag), instruction: "You fixed the flagged issues in this rewrite. Now test whether the fix holds on a fresh question." }
    : priorities.length
      ? { type: "rewrite_section", target_skill_tags: targetTags, instruction }
      : { type: "retest", target_skill_tags: [], instruction: "No high-priority issues were found. Try a fresh question under exam timing." };

  const selfGap = input.context.self_assessment
    ? input.context.self_assessment
        .map((s) => ({ criterion_code: s.criterion_code, self_band: s.band, ai_band: criteria.find((c) => c.code === s.criterion_code)?.band ?? -1 }))
        .filter((g) => g.ai_band >= 0)
    : null;

  const result: EvaluationResult = {
    schema_version: SCHEMA_VERSION,
    score_kind: "ai_estimate",
    disclaimer_version: DISCLAIMER.version,
    evaluator: {
      provider: opts.providerName,
      is_ai: opts.isAi,
      label: opts.providerLabel,
      engine_version: ENGINE_VERSION,
      prompt_version: judge.promptVersion,
      model_ids: [...models],
    },
    rubric: { version_id: input.rubric_version.id, code: input.rubric_version.rubric_code, version: input.rubric_version.version, status: input.rubric_version.status },
    total: { point_estimate: point, range: { low: Math.min(low, point), high: Math.max(high, point) }, max: Q, confidence, confidence_reasons: reasons },
    question_demand_analysis: {
      parts: input.question.parts.map((p) => {
        const votes = samples.map((s) => s.parts.find((x) => x.part_id === p.id)?.addressed ?? "not");
        const order = ["not", "partially", "fully"] as const;
        const idx = median(votes.map((v) => order.indexOf(v)));
        const quotes = samples.flatMap((s) => s.parts.find((x) => x.part_id === p.id)?.quotes ?? []);
        return { part_id: p.id, demand: p.demand, addressed: order[idx], evidence_spans: spansFor(text, quotes).slice(0, 3) };
      }),
      directive_compliance: input.question.directives.map((d) => {
        const entries = samples.map((s) => s.directives.find((x) => x.directive === d.code)).filter((x): x is NonNullable<typeof x> => !!x);
        const metVotes = entries.filter((e) => e.met).length;
        const met = entries.length > 0 && metVotes * 2 > entries.length;
        const rep = entries.find((e) => e.met === met) ?? entries[0];
        return {
          directive: d.code,
          met,
          explanation: rep ? repairText(rep.explanation, notes, "directive") : "Not assessed.",
          evidence_spans: spansFor(text, entries.flatMap((e) => e.quotes)).slice(0, 3),
        };
      }),
    },
    criteria,
    comments,
    factual_checks: factual,
    word_limit: { count: wc, limit, status: wlStatus },
    top_priorities: priorities,
    next_action: nextAction,
    self_assessment_gap: selfGap,
    rewrite_delta: rewriteDelta,
    diagnostics: {
      samples_run: samples.length,
      band_spread_by_criterion: spread,
      validator_repairs: repairs,
      validator_notes: Array.from(new Set(notes)).slice(0, 30),
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    },
  };

  const violations = validateResult(result, input);
  return { result, usage, models: [...models], violations };
}
