/** Text utilities shared by the evaluation engine, validators and heuristics. */

export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\r\n?/g, "\n");
}

export function wordCount(s: string): number {
  const m = s.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-./%]*/gu);
  return m ? m.length : 0;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const ABBREV = new Set(["v", "vs", "e.g", "i.e", "etc", "art", "arts", "no", "nos", "dr", "mr", "mrs", "ms", "st", "govt", "approx", "cf", "viz", "sec", "cl", "ch", "fig", "inc", "ltd", "co", "jr", "sr", "rs", "u.s", "u.k", "p", "pp"]);

/**
 * Split into sentences, keeping exact character offsets into the source. A line break also ends a
 * sentence (handwritten lines, bullets). Periods after initials ("S.R."), common abbreviations
 * ("v.", "e.g.", "Art.") and inside numbers ("4.5") do not end a sentence.
 */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const push = (end: number) => {
    let a = start;
    let b = end;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) out.push({ text: text.slice(a, b), start: a, end: b });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      push(i + 1);
      continue;
    }
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    let j = i;
    while (j + 1 < text.length && /[.!?"”’)\]]/.test(text[j + 1])) j++;
    const next = text[j + 1];
    if (next !== undefined && !/\s/.test(next)) continue; // "4.5", "e.g.x"
    if (ch === ".") {
      const before = text.slice(Math.max(start, i - 12), i);
      const tok = (before.match(/([A-Za-z.]+)$/)?.[1] ?? "").toLowerCase();
      if (/^[a-z]$/i.test(tok) && /[A-Z]/.test(before.slice(-1))) continue; // initials: S.R. / A.
      if (ABBREV.has(tok) || ABBREV.has(tok.replace(/\.$/, ""))) continue;
      // Lower-case continuation after a period usually means an abbreviation we don't know.
      const after = text.slice(j + 1).match(/^\s+(\S)/)?.[1];
      if (after && /[a-z]/.test(after) && tok.length <= 4) continue;
    }
    push(j + 1);
    i = j;
  }
  push(text.length);
  return out;
}

export interface Paragraph {
  text: string;
  start: number;
  end: number;
}

export function paragraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.push({ text: trimmed, start: m.index + lead, end: m.index + lead + trimmed.length });
  }
  return out;
}

export interface Located {
  start: number;
  end: number;
}

/**
 * Find a quote inside text. Tries exact match first, then a whitespace/quote-insensitive match,
 * then case-insensitive. Returns offsets into the ORIGINAL text, so text.slice(start,end) is the
 * canonical span quote. Returns null if the quote cannot be found — callers must then drop the
 * evidence or mark the comment uncertain (never invent a span).
 */
export function locateQuote(text: string, quote: string, from = 0): Located | null {
  const q = quote.trim();
  if (q.length < 3) return null;
  const exact = text.indexOf(q, from);
  if (exact >= 0) return { start: exact, end: exact + q.length };

  // Build normalized view with index map.
  const map: number[] = [];
  let norm = "";
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = " ";
      prevSpace = true;
    } else {
      prevSpace = false;
      if (ch === "’" || ch === "‘") ch = "'";
      if (ch === "“" || ch === "”") ch = '"';
      if (ch === "–" || ch === "—") ch = "-";
    }
    norm += ch;
    map.push(i);
  }
  const nq = q
    .replace(/\s+/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
  let idx = norm.indexOf(nq);
  if (idx < 0) idx = norm.toLowerCase().indexOf(nq.toLowerCase());
  if (idx < 0) return null;
  const start = map[idx];
  const endIdx = idx + nq.length - 1;
  const end = map[endIdx] + 1;
  if (start < from) return null;
  return { start, end };
}

const STOP = new Set(
  "the a an and or of to in on for with by is are was were be been being this that these those it its as at from into than then there their them they which who whom whose what when where why how not no but if so such also can could should would may might must will shall do does did has have had more most less least very much many some any each other own same about over under between through during before after above below up down out off again further once here all both few only just".split(
    " ",
  ),
);

export function contentWords(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 4 && !STOP.has(w));
}

export function jaccard(a: string, b: string): number {
  const A = new Set(contentWords(a));
  const B = new Set(contentWords(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function firstWords(s: string, n: number): string {
  const w = s.trim().split(/\s+/);
  return w.length <= n ? s.trim() : w.slice(0, n).join(" ") + "…";
}

export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}
