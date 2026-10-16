import { findBanned, stripBanned } from "../copy/banned";
import { EvaluationResultSchema, type EvaluationInput, type EvaluationResult } from "../schemas/evaluation";
import { contentWords, overlaps } from "../util/text";

export interface Violation {
  rule: string;
  where: string;
  detail: string;
}

const MAX_SUGGESTION_WORDS = 40;

/**
 * Strict validation of a finished EvaluationResult against its input. Returns every violation;
 * used by tests, benchmarks and as the final gate before persisting.
 */
export function validateResult(result: EvaluationResult, input: EvaluationInput): Violation[] {
  const v: Violation[] = [];
  const parsed = EvaluationResultSchema.safeParse(result);
  if (!parsed.success) v.push({ rule: "schema", where: "result", detail: parsed.error.message.slice(0, 300) });
  if ((result as { score_kind: string }).score_kind !== "ai_estimate") v.push({ rule: "score_kind", where: "result", detail: "score_kind must be ai_estimate" });
  const text = input.transcript.text;
  const checkSpan = (s: { start: number; end: number; quote: string }, where: string) => {
    if (s.start < 0 || s.end > text.length || s.start >= s.end || text.slice(s.start, s.end) !== s.quote) {
      v.push({ rule: "span_exact", where, detail: `span ${s.start}-${s.end} does not match transcript` });
    }
  };
  const chunkText = new Map(input.context.retrieved_sources.map((s) => [s.source_chunk_id, s.text]));
  const checkCitation = (c: { source_chunk_id: string; quote: string }, where: string) => {
    const t = chunkText.get(c.source_chunk_id);
    if (t === undefined) v.push({ rule: "citation_retrieved", where, detail: `chunk ${c.source_chunk_id} was not retrieved` });
    else if (!t.includes(c.quote)) v.push({ rule: "citation_substring", where, detail: "citation quote is not in the chunk" });
  };
  const rubricCodes = new Map(input.rubric_version.criteria.map((c) => [c.code, c]));
  for (const c of result.criteria) {
    const rc = rubricCodes.get(c.code);
    if (!rc) v.push({ rule: "criterion_code", where: c.code, detail: "unknown criterion" });
    if (c.band < 0 || c.band > input.rubric_version.max_band) v.push({ rule: "band_range", where: c.code, detail: `band ${c.band}` });
    if (rc && !rc.input_modes.includes(input.transcript.input_mode)) v.push({ rule: "criterion_mode", where: c.code, detail: "criterion not enabled for this input mode" });
  }
  const sum = result.criteria.reduce((s, c) => s + c.marks_awarded, 0);
  if (Math.abs(sum - result.total.point_estimate) > 0.01) v.push({ rule: "total_consistency", where: "total", detail: `criteria sum ${sum} ≠ total ${result.total.point_estimate}` });
  if (result.total.point_estimate > result.total.max + 1e-9) v.push({ rule: "total_max", where: "total", detail: "total exceeds max" });
  if (!(result.total.range.low <= result.total.point_estimate && result.total.point_estimate <= result.total.range.high)) {
    v.push({ rule: "range", where: "total", detail: "point estimate outside range" });
  }
  for (const c of result.comments) {
    const where = `comment ${c.id}`;
    c.evidence.answer_spans.forEach((s) => checkSpan(s, where));
    c.evidence.citations.forEach((ci) => checkCitation(ci, where));
    const hasEvidence =
      c.evidence.answer_spans.length > 0 ||
      ((c.kind === "missing_dimension" || c.kind === "presentation") && (!!c.evidence.question_part_id || !!c.evidence.rubric_descriptor_id));
    if (!hasEvidence) v.push({ rule: "evidence_required", where, detail: "comment has no evidence" });
    if (c.kind === "factual_error" && c.evidence.citations.length === 0 && !c.uncertain) {
      v.push({ rule: "factual_citation", where, detail: "factual_error without citation must be uncertain" });
    }
    if (c.suggestion.trim().split(/\s+/).length > MAX_SUGGESTION_WORDS + 1) v.push({ rule: "suggestion_length", where, detail: "suggestion exceeds 40 words" });
    for (const s of [c.message, c.suggestion]) for (const b of findBanned(s)) v.push({ rule: "banned_phrase", where, detail: b });
    if (!rubricCodes.has(c.criterion_code)) v.push({ rule: "criterion_code", where, detail: c.criterion_code });
    for (const u of input.transcript.uncertain_spans) {
      if (c.evidence.answer_spans.some((s) => overlaps(s, u)) && !c.uncertain) v.push({ rule: "ocr_uncertain", where, detail: "comment relies on uncertain transcription but is not marked uncertain" });
    }
  }
  for (const [i, fc] of result.factual_checks.entries()) {
    checkSpan(fc.claim_span, `factual_check ${i}`);
    fc.citations.forEach((ci) => checkCitation(ci, `factual_check ${i}`));
    if ((fc.verdict === "contradicted" || fc.verdict === "outdated") && fc.citations.length === 0) {
      v.push({ rule: "factual_citation", where: `factual_check ${i}`, detail: `${fc.verdict} without citation` });
    }
  }
  for (const p of result.question_demand_analysis.parts) p.evidence_spans.forEach((s) => checkSpan(s, `part ${p.part_id}`));
  for (const d of result.question_demand_analysis.directive_compliance) d.evidence_spans.forEach((s) => checkSpan(s, `directive ${d.directive}`));
  for (const b of findBanned(result.next_action.instruction)) v.push({ rule: "banned_phrase", where: "next_action", detail: b });
  return v;
}

/** Genericity: a weakness should share vocabulary with its own evidence or with the question. */
export function isGeneric(message: string, evidenceText: string, questionText: string): boolean {
  const m = new Set(contentWords(message));
  const ref = new Set([...contentWords(evidenceText), ...contentWords(questionText)]);
  for (const w of m) if (ref.has(w)) return false;
  return true;
}

/** Light repairs applied before strict validation; each repair is counted and noted. */
export function repairText(s: string, notes: string[], label: string): string {
  const { text, removed } = stripBanned(s);
  if (removed) notes.push(`${label}: removed ${removed} sentence(s) with banned phrasing`);
  return text;
}

export function clampSuggestion(s: string, notes: string[], label: string): string {
  const words = s.trim().split(/\s+/);
  if (words.length <= MAX_SUGGESTION_WORDS) return s.trim();
  notes.push(`${label}: suggestion trimmed to ${MAX_SUGGESTION_WORDS} words (answer-writing guard)`);
  return words.slice(0, MAX_SUGGESTION_WORDS).join(" ") + "…";
}
