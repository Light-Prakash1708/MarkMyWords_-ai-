import type { EvaluationInput, RawJudgement } from "../../schemas/evaluation";
import { firstWords, type Sentence } from "../../util/text";
import { DIMENSION_HINTS, extractFeatures, firstSentenceMatching, MARKERS, questionOverlap, type AnswerFeatures } from "../features";
import type { Judge, JudgeOutput } from "./types";

/**
 * Rule-based demo judge. Deterministic, free and offline — used when no AI provider is configured,
 * and as a baseline in benchmarks. It can only detect what lexical rules can detect, and every
 * result it produces is labelled as such in the UI. All quotes are exact sentences from the answer.
 */
export class HeuristicJudge implements Judge {
  readonly name = "heuristic";
  readonly promptVersion = "heuristic-v1";

  async judge(input: EvaluationInput): Promise<JudgeOutput> {
    return { raw: heuristicJudgement(input), usage: { inputTokens: 0, outputTokens: 0 }, model: "rules-v1" };
  }
}

type RawComment = RawJudgement["comments"][number];

/** Short quoted lead-in so every templated message references the student's own words. */
const lead = (s: { text: string } | undefined) => (s ? `“${firstWords(s.text, 9)}” — ` : "");

function q(s: Sentence | undefined): string[] {
  return s ? [s.text] : [];
}

const MOVE_RE: Record<string, RegExp> = {
  arguments_for: MARKERS.positive,
  arguments_against: MARKERS.contrast,
  judgement: MARKERS.judgement,
  causes: MARKERS.causes,
  implications: MARKERS.effects,
  reasons: MARKERS.causes,
  evidence: MARKERS.examples,
  examples: MARKERS.examples,
  opinion: MARKERS.opinion,
  criteria: MARKERS.criteria,
  assessment: MARKERS.assessment,
  relationships: MARKERS.effects,
};

function moveSentence(f: AnswerFeatures, move: string): Sentence | undefined | null {
  if (move === "multiple_points" || move === "components") {
    return f.paragraphs.length >= 3 || f.bulletLines >= 3 ? f.usableSentences[0] : null;
  }
  if (move === "explanation") return f.usableSentences.length >= 3 ? f.usableSentences[1] : null;
  const re = MOVE_RE[move];
  if (!re) return null;
  if (move === "judgement") {
    // A judgement should come at or near the end.
    const tail = f.usableSentences.slice(Math.max(0, f.usableSentences.length - 3));
    return tail.find((s) => re.test(s.text)) ?? null;
  }
  return firstSentenceMatching(f, re) ?? null;
}

export function heuristicJudgement(input: EvaluationInput): RawJudgement {
  const text = input.transcript.text;
  const f = extractFeatures(text);
  const comments: RawComment[] = [];
  const criteria: RawJudgement["criteria"] = [];
  const enabled = new Set(
    input.rubric_version.criteria.filter((c) => c.input_modes.includes(input.transcript.input_mode)).map((c) => c.code),
  );
  const lower = f.usableSentences.map((s) => s.text).join(" ").toLowerCase();
  const last = f.usableSentences[f.usableSentences.length - 1];
  const first = f.usableSentences[0];
  const overlap = questionOverlap(lower, input.question.text);
  const offTopic = f.words > 20 && overlap < 0.1;

  // ---------- Question demand: parts ----------
  const parts: RawJudgement["parts"] = input.question.parts.map((p) => {
    const hits = p.cues.filter((c) => lower.includes(c.toLowerCase()));
    const need = Math.min(2, Math.max(1, p.cues.length));
    const addressed: "fully" | "partially" | "not" = hits.length >= need ? "fully" : hits.length >= 1 ? "partially" : "not";
    const quotes = hits
      .slice(0, 2)
      .map((c) => f.usableSentences.find((s) => s.text.toLowerCase().includes(c.toLowerCase()))?.text)
      .filter((x): x is string => !!x);
    return { part_id: p.id, addressed, quotes: Array.from(new Set(quotes)) };
  });
  for (const p of parts) {
    const part = input.question.parts.find((x) => x.id === p.part_id)!;
    if (p.addressed === "not") {
      comments.push({
        criterion_code: "DEMAND",
        skill_tag: "DEMAND.parts_missed",
        kind: "missing_dimension",
        severity: "major",
        message: `This part of the question is not addressed: "${part.demand}". Marks for it cannot be awarded however strong the rest is.`,
        quotes: [],
        question_part_id: part.id,
        rubric_descriptor_id: "DEMAND.1",
        suggestion: `Add a short section that answers "${part.demand}" directly.`,
        citations: [],
        uncertain: false,
      });
    } else if (p.addressed === "partially") {
      comments.push({
        criterion_code: "DEMAND",
        skill_tag: "DEMAND.parts_missed",
        kind: "weakness",
        severity: "moderate",
        message: `${p.quotes[0] ? `“${firstWords(p.quotes[0], 9)}” — ` : ""}"${part.demand}" is touched on here but not developed — it reads as a passing mention rather than a section of the answer.`,
        quotes: p.quotes.slice(0, 1),
        question_part_id: part.id,
        rubric_descriptor_id: "DEMAND.2",
        suggestion: "Give this part its own paragraph with at least two developed points.",
        citations: [],
        uncertain: false,
      });
    }
  }

  // ---------- Directive moves ----------
  const directives: RawJudgement["directives"] = input.question.directives.map((d) => {
    const missing: string[] = [];
    const quotes: string[] = [];
    for (const m of d.expected_moves) {
      const s = moveSentence(f, m);
      if (!s) missing.push(m);
      else if (quotes.length < 3) quotes.push(s.text);
    }
    return {
      directive: d.code,
      met: missing.length === 0,
      explanation:
        missing.length === 0
          ? `The answer performs what "${d.label}" asks: ${d.expected_moves.join(", ").replace(/_/g, " ")}.`
          : `"${d.label}" also needs: ${missing.join(", ").replace(/_/g, " ")}.`,
      quotes: Array.from(new Set(quotes)),
    };
  });
  const allMoves = new Set(input.question.directives.flatMap((d) => d.expected_moves));
  const hasJudgement = !!moveSentence(f, "judgement");
  const hasContrast = !!moveSentence(f, "arguments_against");
  if (allMoves.has("judgement") && !hasJudgement && last) {
    comments.push({
      criterion_code: "ANALYSIS",
      skill_tag: "ANALYSIS.no_judgement",
      kind: "weakness",
      severity: "major",
      message: `${lead(last)}the directive asks for a judgement, but the answer ends here without stating where you come down.`,
      quotes: [last.text],
      question_part_id: null,
      rubric_descriptor_id: "ANALYSIS.2",
      suggestion: "End with one or two sentences that weigh the sides and state your overall assessment.",
      citations: [],
      uncertain: false,
    });
  }
  if (allMoves.has("arguments_against") && !hasContrast) {
    comments.push({
      criterion_code: "ANALYSIS",
      skill_tag: "ANALYSIS.one_sided",
      kind: "missing_dimension",
      severity: "moderate",
      message: "A critical directive needs both sides, but the answer presents only one. There is no limitation, counter-argument or concern weighed against the main claims.",
      quotes: [],
      question_part_id: null,
      rubric_descriptor_id: "ANALYSIS.2",
      suggestion: "Add the strongest counter-argument and say why it does or does not change your view.",
      citations: [],
      uncertain: false,
    });
  }
  const partsScore = parts.reduce((s, p) => s + (p.addressed === "fully" ? 1 : p.addressed === "partially" ? 0.5 : 0), 0) / Math.max(1, parts.length);
  const moveTotal = input.question.directives.reduce((s, d) => s + d.expected_moves.length, 0);
  const moveMet = input.question.directives.reduce((s, d) => s + d.expected_moves.filter((m) => moveSentence(f, m)).length, 0);
  const directiveScore = moveTotal ? moveMet / moveTotal : 1;
  let demandBand = Math.round((0.6 * partsScore + 0.4 * directiveScore) * 4);
  if (offTopic) demandBand = Math.min(demandBand, 1);
  criteria.push({ code: "DEMAND", band: demandBand, descriptor_id: `DEMAND.${demandBand}`, rationale: `Parts addressed: ${parts.map((p) => `${p.part_id}=${p.addressed}`).join(", ")}; directive moves met ${moveMet}/${moveTotal}.` });

  // ---------- Content & dimensions ----------
  const expected = input.question.dimensions_expected;
  const covered = expected.filter((d) => f.dimensions.has(d));
  const ratio = expected.length ? covered.length / expected.length : f.dimensions.size >= 2 ? 1 : 0.5;
  let contentBand = ratio >= 0.99 && f.dimensions.size >= 3 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.34 ? 2 : f.dimensions.size >= 1 ? 1 : 0;
  if (offTopic) {
    contentBand = Math.min(contentBand, 1);
    if (first) {
      comments.push({
        criterion_code: "CONTENT",
        skill_tag: "CONTENT.irrelevance",
        kind: "weakness",
        severity: "major",
        message: `${lead(first)}the answer shares very little vocabulary with the question. It may be answering a different question.`,
        quotes: [first.text],
        question_part_id: null,
        rubric_descriptor_id: "CONTENT.1",
        suggestion: "Re-read the question, underline its key terms and make sure each paragraph answers one of them.",
        citations: [],
        uncertain: true,
        uncertainty_reason: "Rule-based relevance check; may misjudge answers that use synonyms.",
      });
    }
  }
  for (const d of expected.filter((x) => !f.dimensions.has(x)).slice(0, 2)) {
    comments.push({
      criterion_code: "CONTENT",
      skill_tag: "CONTENT.dimension_gap",
      kind: "missing_dimension",
      severity: "moderate",
      message: `The ${d} dimension is missing. This question calls for ${DIMENSION_HINTS[d] ?? "this angle"}.`,
      quotes: [],
      question_part_id: null,
      rubric_descriptor_id: `CONTENT.${contentBand}`,
      suggestion: `Add one point on ${DIMENSION_HINTS[d] ?? d} and link it back to the question.`,
      citations: [],
      uncertain: false,
    });
  }
  criteria.push({ code: "CONTENT", band: contentBand, descriptor_id: `CONTENT.${contentBand}`, rationale: `Relevant dimensions covered: ${covered.join(", ") || "none"} of ${expected.join(", ") || "n/a"}.` });

  // ---------- Analysis ----------
  const per100 = f.words ? (f.causalCount / f.words) * 100 : 0;
  let analysisBand = per100 >= 2.5 ? 3 : per100 >= 1.5 ? 2 : per100 > 0.4 ? 1 : 0;
  // Density alone flatters very short answers: also require an absolute number of causal links.
  analysisBand = Math.min(analysisBand, f.causalCount >= 4 ? 3 : f.causalCount >= 2 ? 2 : f.causalCount >= 1 ? 1 : 0);
  if (analysisBand >= 2 && hasJudgement && hasContrast) analysisBand += 1;
  if (allMoves.has("judgement") && !hasJudgement) analysisBand = Math.min(analysisBand, 2);
  analysisBand = Math.min(4, analysisBand);
  const bareOutcome = f.usableSentences.find(
    (s) => MARKERS.outcome.test(s.text) && !MARKERS.causes.test(s.text) && !MARKERS.effects.test(s.text) && s.text.split(/\s+/).length >= 6,
  );
  if (per100 < 1.5 && bareOutcome) {
    comments.push({
      criterion_code: "ANALYSIS",
      skill_tag: "ANALYSIS.mechanism_missing",
      kind: "weakness",
      severity: per100 < 1 ? "major" : "moderate",
      message: `${lead(bareOutcome)}this states an outcome but not the mechanism — how and why it happens. Examiners reward the causal chain, not just the result.`,
      quotes: [bareOutcome.text],
      question_part_id: null,
      rubric_descriptor_id: `ANALYSIS.${Math.min(analysisBand, 1)}`,
      suggestion: "Insert the intermediate step: what changes first, and how does that produce this outcome?",
      citations: [],
      uncertain: false,
    });
  }
  criteria.push({ code: "ANALYSIS", band: analysisBand, descriptor_id: `ANALYSIS.${analysisBand}`, rationale: `Causal/explanatory links: ${f.causalCount} (${per100.toFixed(1)} per 100 words); counter-argument ${hasContrast ? "present" : "absent"}; judgement ${hasJudgement ? "present" : "absent"}.` });

  // ---------- Evidence ----------
  const ev = f.evidenceCount;
  const evidenceBand = ev >= 6 ? 4 : ev >= 4 ? 3 : ev >= 2 ? 2 : ev >= 1 ? 1 : 0;
  if (ev < 3) {
    const claim = f.usableSentences.find((s) => /\b(is|are|has|have|should|must)\b/i.test(s.text) && !/\d/.test(s.text) && !MARKERS.examples.test(s.text) && s.text.split(/\s+/).length >= 8);
    if (claim) {
      comments.push({
        criterion_code: "EVIDENCE",
        skill_tag: "EVIDENCE.no_examples",
        kind: "weakness",
        severity: ev === 0 ? "major" : "moderate",
        message: `${lead(claim)}this claim is not backed by a specific example, provision, report or data point, so it reads as an assertion.`,
        quotes: [claim.text],
        question_part_id: null,
        rubric_descriptor_id: `EVIDENCE.${evidenceBand}`,
        suggestion: "Support it with one concrete item: an Article or Act, a committee or court finding, a scheme, or a figure you are sure of.",
        citations: [],
        uncertain: false,
      });
    }
  }
  const absolute = firstSentenceMatching(f, MARKERS.absolute);
  if (absolute) {
    comments.push({
      criterion_code: "EVIDENCE",
      skill_tag: "EVIDENCE.unsupported_claim",
      kind: "weakness",
      severity: "minor",
      message: `${lead(absolute)}sweeping wording makes this hard to defend. Absolute statements invite an examiner to look for the exception.`,
      quotes: [absolute.text],
      question_part_id: null,
      rubric_descriptor_id: null,
      suggestion: "Qualify the claim (e.g. 'often', 'in most States') or support it with evidence.",
      citations: [],
      uncertain: false,
    });
  }
  criteria.push({ code: "EVIDENCE", band: evidenceBand, descriptor_id: `EVIDENCE.${evidenceBand}`, rationale: `Specific evidence markers found: ${ev}.` });

  // ---------- Structure ----------
  const paras = f.paragraphs;
  const introOk = paras.length >= 2 && paras[0].text.split(/\s+/).length <= Math.max(60, f.words * 0.35) && questionOverlap(paras[0].text, input.question.text) >= 0.08;
  const lastPara = paras[paras.length - 1];
  const conclusionOk = paras.length >= 2 && !!lastPara && (MARKERS.judgement.test(lastPara.text) || MARKERS.forward.test(lastPara.text));
  const flowOk = paras.length >= 3 || f.bulletLines >= 3;
  const structureBand = Math.min(4, Number(introOk) + Number(conclusionOk) + Number(flowOk) + Number(paras.length >= 4 || f.bulletLines >= 3));
  if (!introOk && first) {
    comments.push({
      criterion_code: "STRUCTURE",
      skill_tag: "STRUCTURE.weak_intro",
      kind: "structure",
      severity: "minor",
      message: `${lead(first)}the opening does not frame the question — it does not set up the key term or issue before the body begins.`,
      quotes: [first.text],
      question_part_id: null,
      rubric_descriptor_id: "STRUCTURE.2",
      suggestion: "Open with one or two sentences that define the issue in the question's own terms.",
      citations: [],
      uncertain: false,
    });
  }
  if (!conclusionOk && last && !(allMoves.has("judgement") && !hasJudgement)) {
    comments.push({
      criterion_code: "STRUCTURE",
      skill_tag: "STRUCTURE.weak_conclusion",
      kind: "structure",
      severity: "moderate",
      message: `${lead(last)}the answer stops rather than concludes; this final sentence does not synthesise the argument or look forward.`,
      quotes: [last.text],
      question_part_id: null,
      rubric_descriptor_id: "STRUCTURE.2",
      suggestion: "Close with a short synthesis and a forward-looking line (a reform, a condition or a way forward).",
      citations: [],
      uncertain: false,
    });
  }
  if (!flowOk && first && f.words > 80) {
    comments.push({
      criterion_code: "STRUCTURE",
      skill_tag: "STRUCTURE.poor_flow",
      kind: "structure",
      severity: "minor",
      message: `${lead(first)}the answer is written as one or two dense blocks, which makes its progression hard to follow.`,
      quotes: [first.text],
      question_part_id: null,
      rubric_descriptor_id: "STRUCTURE.1",
      suggestion: "Break the body into short paragraphs or sub-headings, one idea each.",
      citations: [],
      uncertain: false,
    });
  }
  criteria.push({ code: "STRUCTURE", band: structureBand, descriptor_id: `STRUCTURE.${structureBand}`, rationale: `Paragraphs: ${paras.length}; framing opening: ${introOk ? "yes" : "no"}; concluding synthesis: ${conclusionOk ? "yes" : "no"}.` });

  // ---------- Presentation (handwritten only) ----------
  if (enabled.has("PRESENTATION")) {
    const diagrams = input.transcript.diagrams.length;
    const headings = (text.match(/^[^\n.]{3,50}:?\s*$/gm) || []).length;
    const band = Math.min(4, 2 + Number(diagrams > 0) + Number(headings > 0 || f.bulletLines >= 2));
    if (diagrams === 0) {
      comments.push({
        criterion_code: "PRESENTATION",
        skill_tag: "PRESENTATION.no_visuals",
        kind: "presentation",
        severity: "minor",
        message: "No diagram, flowchart or map was detected on the sheet. A simple visual can carry a mechanism or a framework in very few words.",
        quotes: [],
        question_part_id: null,
        rubric_descriptor_id: `PRESENTATION.${band}`,
        suggestion: "Where a process or relationship is central, add a small labelled flowchart.",
        citations: [],
        uncertain: false,
      });
    }
    criteria.push({ code: "PRESENTATION", band, descriptor_id: `PRESENTATION.${band}`, rationale: `Diagrams detected: ${diagrams}; headings or bullet structure: ${headings + f.bulletLines > 0 ? "yes" : "no"}.` });
  }

  // ---------- Language ----------
  const lens = f.usableSentences.map((s) => s.text.split(/\s+/).length);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const longOnes = f.usableSentences.filter((s) => s.text.split(/\s+/).length > 40);
  const filler = firstSentenceMatching(f, MARKERS.filler);
  let languageBand = 4 - Number(avg > 30) - Number(!!filler) - Number(longOnes.length >= 2);
  if (input.question.word_limit && f.words > input.question.word_limit * (1 + input.question.word_tolerance_pct / 100)) languageBand -= 1;
  languageBand = Math.max(0, Math.min(4, languageBand));
  if (filler) {
    comments.push({
      criterion_code: "LANGUAGE",
      skill_tag: "LANGUAGE.verbosity",
      kind: "weakness",
      severity: "minor",
      message: `${lead(filler)}this opens with a stock phrase that uses words without adding meaning.`,
      quotes: [filler.text],
      question_part_id: null,
      rubric_descriptor_id: "LANGUAGE.2",
      suggestion: "Cut the stock phrase and start with the substantive point.",
      citations: [],
      uncertain: false,
    });
  } else if (longOnes[0]) {
    comments.push({
      criterion_code: "LANGUAGE",
      skill_tag: "LANGUAGE.verbosity",
      kind: "weakness",
      severity: "minor",
      message: `${lead(longOnes[0])}this sentence runs to ${longOnes[0].text.split(/\s+/).length} words; the point gets lost.`,
      quotes: [longOnes[0].text],
      question_part_id: null,
      rubric_descriptor_id: "LANGUAGE.2",
      suggestion: "Split it into two sentences, one claim each.",
      citations: [],
      uncertain: false,
    });
  }
  criteria.push({ code: "LANGUAGE", band: languageBand, descriptor_id: `LANGUAGE.${languageBand}`, rationale: `Average sentence length ${avg.toFixed(0)} words; stock phrases ${filler ? "present" : "absent"}.` });

  // ---------- Strengths (evidence-anchored) ----------
  const strengthCandidates: [string, string, RegExp, string][] = [
    ["EVIDENCE", "EVIDENCE.no_examples", /\b(articles?\s*\d+|\w+ act\b|(?:19|20)\d{2}|\d+\s*(?:%|per ?cent)|committee|commission|v\.)/i, "Specific, checkable evidence strengthens this point."],
    ["ANALYSIS", "ANALYSIS.mechanism_missing", new RegExp(`${MARKERS.causes.source}|${MARKERS.effects.source}`, "i"), "This sentence explains a causal link rather than just stating a result."],
    ["ANALYSIS", "ANALYSIS.no_judgement", MARKERS.judgement, "A clear judgement that follows from the discussion."],
    ["STRUCTURE", "STRUCTURE.weak_conclusion", MARKERS.forward, "The ending looks forward instead of just stopping — this is what a synthesising conclusion does."],
  ];
  let strengths = 0;
  for (const [crit, tag, re, msg] of strengthCandidates) {
    if (strengths >= 2) break;
    const band = criteria.find((c) => c.code === crit)?.band ?? 0;
    if (band < 3) continue;
    const s = firstSentenceMatching(f, re);
    if (!s) continue;
    comments.push({ criterion_code: crit, skill_tag: tag, kind: "strength", severity: "minor", message: msg, quotes: q(s), question_part_id: null, rubric_descriptor_id: `${crit}.${band}`, suggestion: "Keep doing this.", citations: [], uncertain: false });
    strengths++;
  }

  // Development cap: an answer far below the expected length cannot fully develop the question.
  const limit = input.question.word_limit;
  if (limit && f.words > 0) {
    const ratio = f.words / limit;
    const cap = ratio < 0.4 ? 1 : ratio < 0.6 ? 2 : ratio < 0.8 ? 3 : 4;
    if (cap < 4) {
      for (const c of criteria) {
        const critCap = c.code === "LANGUAGE" || c.code === "STRUCTURE" || c.code === "PRESENTATION" ? Math.min(4, cap + 1) : cap;
        if (c.band > critCap) {
          c.band = critCap;
          c.descriptor_id = `${c.code}.${critCap}`;
          c.rationale += ` Capped at band ${critCap}: ${f.words} words against ~${limit} limits how far the answer can be developed.`;
        }
      }
    }
  }

  // Order criteria as in the rubric and keep only enabled ones.
  const order = input.rubric_version.criteria.map((c) => c.code);
  const finalCriteria = criteria.filter((c) => enabled.has(c.code)).sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));

  const weakest = [...finalCriteria].sort((a, b) => a.band - b.band)[0];
  return {
    criteria: finalCriteria,
    parts,
    directives,
    comments: comments.filter((c) => enabled.has(c.criterion_code)).slice(0, 16),
    factual_checks: [],
    next_action_instruction: weakest
      ? `Rewrite the part of your answer that most affects ${weakest.code.toLowerCase()} without looking at a model answer, then try a fresh related question.`
      : "Rewrite your weakest paragraph, then try a fresh related question.",
  };
}
