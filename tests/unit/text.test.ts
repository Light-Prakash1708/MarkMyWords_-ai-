import { describe, expect, it } from "vitest";
import { locateQuote, paragraphs, sentences, wordCount, jaccard } from "@/lib/util/text";

describe("text utilities", () => {
  const text = "First sentence here.  Second   sentence,\nwith a break! Third: “quoted” bit?";
  it("locates exact quotes", () => {
    const l = locateQuote(text, "First sentence here.")!;
    expect(text.slice(l.start, l.end)).toBe("First sentence here.");
  });
  it("locates whitespace- and quote-normalised quotes and returns ORIGINAL offsets", () => {
    const l = locateQuote(text, "Second sentence, with a break!")!;
    expect(l).not.toBeNull();
    expect(text.slice(l.start, l.end)).toBe("Second   sentence,\nwith a break!");
    const q = locateQuote(text, 'Third: "quoted" bit?')!;
    expect(text.slice(q.start, q.end)).toBe("Third: “quoted” bit?");
  });
  it("returns null for invented quotes (never fabricates a span)", () => {
    expect(locateQuote(text, "This sentence was never written")).toBeNull();
    expect(locateQuote(text, "ab")).toBeNull();
  });
  it("splits sentences with exact offsets", () => {
    for (const s of sentences(text)) expect(text.slice(s.start, s.end)).toBe(s.text);
    // a line break also ends a sentence (handwritten lines)
    expect(sentences(text).length).toBe(4);
  });
  it("splits paragraphs with exact offsets", () => {
    const t = "Para one.\nStill one.\n\nPara two.\n\n\nPara three.";
    const ps = paragraphs(t);
    expect(ps.map((p) => p.text)).toEqual(["Para one.\nStill one.", "Para two.", "Para three."]);
    for (const p of ps) expect(t.slice(p.start, p.end)).toBe(p.text);
  });
  it("counts words including figures and hyphenated terms", () => {
    expect(wordCount("The 4% target, set in 2016, is CPI-based.")).toBe(8);
    expect(wordCount("   ")).toBe(0);
  });
  it("jaccard similarity", () => {
    expect(jaccard("monetary policy transmission", "monetary policy transmission")).toBe(1);
    expect(jaccard("monetary policy", "climate finance")).toBe(0);
  });
});
