/**
 * Honest score reporting (principle P3). Every score display requires a Disclaimer.
 * Wording deliberately avoids the banned phrases in banned.ts.
 */
export interface Disclaimer {
  version: string;
  short: string;
  long: string;
}

export const DISCLAIMER: Disclaimer = {
  version: "d-2026-10-1",
  short: "AI estimate · not a mark from UPSC, RBI or any examining body",
  long:
    "This is an estimate produced against MarkMyWords' own exam-aligned rubric. UPSC and RBI do not publish a criterion-wise " +
    "marking scheme for answers, so no tool can reproduce examiner marks. The rubric is still being calibrated against human " +
    "evaluators. Use the score to compare your own attempts over time; use the evidence-linked comments to improve.",
};

export const HEURISTIC_NOTICE =
  "Demo evaluator: rule-based checks only (no AI model is configured). Feedback is limited to what simple rules can detect. Add an ANTHROPIC_API_KEY to enable the AI evaluator.";
