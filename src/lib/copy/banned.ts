/**
 * Phrases that must never appear in UI copy or generated feedback (principles P3 and P9).
 * Checked by tests/unit/copy-lint.test.ts over source files and by the output validator over
 * every generated string.
 */
export const BANNED_PHRASES: RegExp[] = [
  /\bofficial (?:score|marks?|result)\b/i,
  /\bupsc marks\b/i,
  /\brbi marks\b/i,
  /\bguarantee(?:d|s)?\s+(?:\d+|full|high|top|good|you|your|a)?\s*(?:marks?|scores?|results?|selection|success|rank)\b/i,
  /\bexact marks\b/i,
  /\bpredicted question\b/i,
  /\bwill (?:definitely |surely )?(?:come|appear|be asked) in (?:the )?(?:exam|mains|paper)\b/i,
  /\bsure[- ]shot\b/i,
  /\btopper(?:'s)? answer\b/i,
];

const NEGATION = /\b(?:not|never|no|nor|without|isn't|aren't|cannot|can't)\b[^.!?]{0,30}$/i;

/**
 * Returns banned phrases found in the text. A phrase that is explicitly negated just before it
 * ("not official marks", "never 'will come in the exam'") is allowed — that is honest copy.
 */
export function findBanned(text: string): string[] {
  const hits: string[] = [];
  for (const re of BANNED_PHRASES) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (!NEGATION.test(before)) hits.push(m[0]);
    }
  }
  return hits;
}

/** Remove sentences containing banned phrases from generated text. */
export function stripBanned(text: string): { text: string; removed: number } {
  let removed = 0;
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((p) => {
    const bad = findBanned(p).length > 0;
    if (bad) removed++;
    return !bad;
  });
  return { text: kept.join(" ").trim(), removed };
}
