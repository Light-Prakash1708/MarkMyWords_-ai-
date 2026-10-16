import type { CheckWithSource } from "../sources";
import { sentences } from "../util/text";

export interface PatternFinding {
  checkId: string;
  claimStart: number;
  claimEnd: number;
  claimQuote: string;
  found: string;
  verdict: "supported" | "contradicted";
  note: string;
  sourceChunkId: string;
  sourceQuote: string;
}

/**
 * Deterministic factual checks: regex patterns attached to corpus sources. They only fire on
 * sentences that make a specific, checkable claim (e.g. "GST was rolled out in 2016") and always
 * cite the corpus chunk. Conservative by design: a sentence that does not match is not checked.
 */
export function runPatternChecks(text: string, checks: CheckWithSource[]): PatternFinding[] {
  const out: PatternFinding[] = [];
  const sents = sentences(text);
  for (const { check, source } of checks) {
    // Context (e.g. "this answer is about NFSA") is judged over the whole answer: students often
    // name the scheme once and then write "it covers …".
    if (check.context_pattern && !new RegExp(check.context_pattern, "i").test(text)) continue;
    const claimRe = new RegExp(check.claim_pattern, "i");
    const expectedRe = new RegExp(check.expected_pattern);
    const exclRe = check.exclude_pattern ? new RegExp(check.exclude_pattern, "i") : null;
    for (const s of sents) {
      if (exclRe && exclRe.test(s.text)) continue;
      const m = s.text.match(claimRe);
      if (!m) continue;
      const found = m.slice(1).find((g) => g !== undefined);
      if (!found) continue;
      const ok = expectedRe.test(found.toUpperCase()) || expectedRe.test(found);
      out.push({
        checkId: check.id,
        claimStart: s.start,
        claimEnd: s.end,
        claimQuote: s.text,
        found,
        verdict: ok ? "supported" : "contradicted",
        note: ok ? `Matches the cited source. ${check.note}` : `You wrote "${found}". ${check.note}`,
        sourceChunkId: source.source_chunk_id,
        sourceQuote: check.quote,
      });
      break;
    }
  }
  return out;
}
