import { describe, expect, it } from "vitest";
import { applyDecisions, buildTranscript, mockOcr, RawOcrSchema } from "@/lib/ocr";

describe("handwriting transcript handling (no silent guessing)", () => {
  const built = buildTranscript(mockOcr(1));
  it("builds a transcript with exact region offsets", () => {
    for (const r of built.regions) expect(built.text.slice(r.start, r.end)).toBe(r.text);
    expect(RawOcrSchema.safeParse(mockOcr(2)).success).toBe(true);
  });
  it("flags low-confidence lines even if the model said ok", () => {
    const b = buildTranscript({ pages: [{ page_index: 0, lines: [{ text: "Faint line here", confidence: 0.5, alternatives: [], flag: "ok" }], diagrams: [] }] });
    expect(b.regions[0].flag).toBe("uncertain");
  });
  it("refuses to proceed until every uncertain region has a decision", () => {
    const r = applyDecisions(built, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.length).toBe(built.regions.filter((x) => x.flag !== "ok").length);
  });
  it("applies corrections and keeps explicitly-uncertain spans", () => {
    const unc = built.regions.find((x) => x.flag !== "ok")!;
    const corrected = applyDecisions(built, [{ region_id: unc.id, action: "correct", text: "Small savings rates compete with deposits." }]);
    expect(corrected.ok && corrected.text.includes("Small savings rates compete with deposits.")).toBe(true);
    expect(corrected.ok && corrected.uncertain.length).toBe(0);
    const left = applyDecisions(built, [{ region_id: unc.id, action: "leave_uncertain" }]);
    expect(left.ok).toBe(true);
    if (left.ok) {
      expect(left.uncertain).toHaveLength(1);
      expect(left.text.slice(left.uncertain[0].start, left.uncertain[0].end)).toBe(unc.text);
    }
  });
  it("multi-page: illegible pages produce illegible regions", () => {
    const b = buildTranscript(mockOcr(2));
    expect(b.regions.some((r) => r.flag === "illegible" && r.page === 1)).toBe(true);
  });
});
