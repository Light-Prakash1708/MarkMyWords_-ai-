import { describe, expect, it } from "vitest";
import { evaluateAnswer } from "@/lib/eval-engine";
import { LlmJudge } from "@/lib/eval-engine/judges/llm";
import { validateResult } from "@/lib/eval-engine/validate";
import { MockProvider } from "@/lib/llm/mock";
import { allHeuristicChecks } from "@/lib/sources";
import type { EvaluationInput, RawJudgement } from "@/lib/schemas/evaluation";
import { freshDb, inputFor } from "../helpers";

const ANSWER = `Monetary policy transmission is how repo rate changes reach lending rates.

Transmission is slow because banks reprice deposits only as they mature, so their cost of funds falls with a lag. Lending rates stay high.

The RBI introduced external benchmark linked lending in 2019.

Therefore, deposit-side reforms are the way forward.`;

function raw(input: EvaluationInput, band = 3, extra: Partial<RawJudgement> = {}): RawJudgement {
  const enabled = input.rubric_version.criteria.filter((c) => c.input_modes.includes(input.transcript.input_mode));
  return {
    criteria: enabled.map((c) => ({ code: c.code, band, descriptor_id: `${c.code}.${band}`, rationale: `Band ${band} rationale for ${c.name}.` })),
    parts: input.question.parts.map((p) => ({ part_id: p.id, addressed: "fully" as const, quotes: ["Transmission is slow because banks reprice deposits only as they mature"] })),
    directives: input.question.directives.map((d) => ({ directive: d.code, met: true, explanation: "Performed.", quotes: [] })),
    comments: [
      {
        criterion_code: "ANALYSIS",
        skill_tag: "ANALYSIS.mechanism_missing",
        kind: "weakness",
        severity: "moderate",
        message: "“Lending rates stay high” states the outcome without explaining why lending rates stay high.",
        quotes: ["Lending rates stay high."],
        question_part_id: "p1",
        rubric_descriptor_id: "ANALYSIS.2",
        suggestion: "Explain the step between deposit repricing and lending rates.",
        citations: [],
        uncertain: false,
      },
    ],
    factual_checks: [],
    next_action_instruction: "Rewrite the analysis paragraph.",
    ...extra,
  };
}

describe("evaluation engine with a model judge (mock provider)", async () => {
  const { db } = freshDb();
  const { input } = await inputFor(db, "gs3-monetary-transmission", ANSWER);
  const run = (handler: (i: number) => unknown, samples = 3) => {
    const p = new MockProvider({ judge: (_r, i) => handler(i) });
    return evaluateAnswer({ ...structuredClone(input), engine: { ...input.engine, samples } }, new LlmJudge(p, "mock"), { isAi: true, providerName: "mock", providerLabel: "mock", patternChecks: allHeuristicChecks(db) });
  };

  it("computes totals in code from median bands and passes strict validation", async () => {
    const r = await run(() => raw(input, 3));
    expect(r.violations).toEqual([]);
    expect(r.result.score_kind).toBe("ai_estimate");
    const sum = r.result.criteria.reduce((s, c) => s + c.marks_awarded, 0);
    expect(r.result.total.point_estimate).toBeCloseTo(sum, 2);
    expect(r.result.total.point_estimate).toBeCloseTo(15 * 0.75, 1);
    expect(r.result.total.confidence).not.toBe("low");
    expect(r.result.total.confidence_reasons).not.toContain("sample_disagreement");
  });

  it("disables handwritten-only criteria for typed answers and renormalises weights", async () => {
    const r = await run(() => raw(input, 4));
    expect(r.result.criteria.find((c) => c.code === "PRESENTATION")).toBeUndefined();
    expect(r.result.total.point_estimate).toBeCloseTo(15, 1);
  });

  it("takes the median across disagreeing samples and lowers confidence", async () => {
    const r = await run((i) => raw(input, [1, 3, 4][i]));
    expect(r.result.criteria.every((c) => c.band === 3)).toBe(true);
    expect(r.result.total.confidence).toBe("low");
    expect(r.result.total.confidence_reasons).toContain("sample_disagreement");
    expect(r.result.total.range.low).toBeLessThan(r.result.total.point_estimate);
    expect(r.result.total.range.high).toBeGreaterThan(r.result.total.point_estimate);
  });

  it("discards quotes that are not in the answer and drops evidence-less comments", async () => {
    const r = await run(() =>
      raw(input, 3, {
        comments: [
          { ...raw(input).comments[0], quotes: ["This sentence does not exist in the answer at all."] },
          { ...raw(input).comments[0], skill_tag: "EVIDENCE.no_examples", criterion_code: "EVIDENCE", quotes: ["The RBI introduced external benchmark linked lending in 2019."], message: "“The RBI introduced external benchmark” — give the scope of loans covered." },
        ],
      }),
    );
    expect(r.result.comments.some((c) => c.skill_tag === "ANALYSIS.mechanism_missing")).toBe(false);
    expect(r.result.comments.some((c) => c.skill_tag === "EVIDENCE.no_examples")).toBe(true);
    expect(r.result.diagnostics.validator_repairs).toBeGreaterThan(0);
    expect(r.violations).toEqual([]);
  });

  it("drops fabricated citations and downgrades unsupported factual verdicts", async () => {
    const chunk = input.context.retrieved_sources[0];
    const r = await run(() =>
      raw(input, 3, {
        comments: [
          {
            criterion_code: "EVIDENCE",
            skill_tag: "EVIDENCE.factual_error",
            kind: "factual_error",
            severity: "major",
            message: "“external benchmark linked lending in 2019” — the year is wrong per the source.",
            quotes: ["The RBI introduced external benchmark linked lending in 2019."],
            suggestion: "Check the year.",
            citations: [{ source_chunk_id: chunk.source_chunk_id, quote: "this quote is invented and not in the chunk" }, { source_chunk_id: "not-a-real-chunk", quote: "x y z w" }],
            uncertain: false,
          },
        ],
        factual_checks: [{ claim_quote: "The RBI introduced external benchmark linked lending in 2019.", verdict: "contradicted", citations: [{ source_chunk_id: "fake", quote: "fake quote here" }], note: "Wrong." }],
      }),
    );
    const fe = r.result.comments.find((c) => c.kind === "factual_error")!;
    expect(fe.evidence.citations).toEqual([]);
    expect(fe.uncertain).toBe(true);
    expect(fe.uncertainty_reason).toBe("no_supporting_source");
    expect(r.result.factual_checks[0].verdict).toBe("unverifiable");
    expect(r.violations).toEqual([]);
  });

  it("keeps a verified citation", async () => {
    const chunk = input.context.retrieved_sources.find((s) => s.text.includes("external benchmark"))!;
    const quote = "external benchmark such as the policy repo rate from October 2019";
    const r = await run(() =>
      raw(input, 3, {
        factual_checks: [{ claim_quote: "The RBI introduced external benchmark linked lending in 2019.", verdict: "supported", citations: [{ source_chunk_id: chunk.source_chunk_id, quote }], note: "Matches." }],
      }),
    );
    expect(r.result.factual_checks[0].verdict).toBe("supported");
    expect(r.result.factual_checks[0].citations[0].quote).toBe(quote);
    expect(r.result.factual_checks[0].citations[0].verification_status).toBe("unverified");
  });

  it("strips banned phrasing and trims answer-like suggestions", async () => {
    const long = Array.from({ length: 48 }, (_, i) => `w${i}`).join(" ");
    const r = await run(() =>
      raw(input, 3, { comments: [{ ...raw(input).comments[0], message: "“Lending rates stay high” lacks a mechanism. You are guaranteed full marks if you fix it.", suggestion: long }] }),
    );
    const c = r.result.comments.find((x) => x.skill_tag === "ANALYSIS.mechanism_missing")!;
    expect(c.message).not.toMatch(/guaranteed/i);
    expect(c.suggestion.split(/\s+/).length).toBeLessThanOrEqual(41);
    expect(r.violations).toEqual([]);
  });

  it("marks comments supported by a minority of samples as uncertain", async () => {
    const r = await run((i) => (i === 0 ? raw(input, 3) : raw(input, 3, { comments: [] })));
    const c = r.result.comments.find((x) => x.skill_tag === "ANALYSIS.mechanism_missing")!;
    expect(c.uncertain).toBe(true);
    expect(c.uncertainty_reason).toMatch(/low_sample_agreement/);
  });

  it("survives a failing sample and reports it", async () => {
    let k = 0;
    const p = new MockProvider({ judge: () => { k++; if (k === 2) throw new Error("boom"); return raw(input, 3); } });
    const r = await evaluateAnswer(structuredClone(input), new LlmJudge(p, "mock"), { isAi: true, providerName: "mock", providerLabel: "mock" });
    expect(r.result.diagnostics.samples_run).toBe(2);
    expect(r.result.total.confidence_reasons).toContain("some_samples_failed");
  });
});

describe("strict validator catches tampering", async () => {
  const { db } = freshDb();
  const { input } = await inputFor(db, "gs3-monetary-transmission", ANSWER);
  const p = new MockProvider({ judge: () => raw(input, 3) });
  const base = (await evaluateAnswer(structuredClone(input), new LlmJudge(p, "mock"), { isAi: true, providerName: "mock", providerLabel: "mock" })).result;
  const tamper = (f: (r: typeof base) => void) => {
    const r = structuredClone(base);
    f(r);
    return validateResult(r, input).map((v) => v.rule);
  };
  it("baseline is valid", () => expect(validateResult(base, input)).toEqual([]));
  it("score_kind", () => expect(tamper((r) => ((r as { score_kind: string }).score_kind = "official"))).toContain("score_kind"));
  it("span mismatch", () => expect(tamper((r) => (r.comments[0].evidence.answer_spans[0].quote = "invented"))).toContain("span_exact"));
  it("citation not retrieved", () =>
    expect(tamper((r) => r.comments[0].evidence.citations.push({ source_chunk_id: "x", source_title: "t", source_url: "https://x", published_on: null, quote: "q", text_kind: "our_summary", verification_status: "unverified", may_be_outdated: false }))).toContain("citation_retrieved"));
  it("evidence-less comment", () => expect(tamper((r) => (r.comments[0].evidence.answer_spans = []))).toContain("evidence_required"));
  it("long suggestion", () => expect(tamper((r) => (r.comments[0].suggestion = "word ".repeat(60)))).toContain("suggestion_length"));
  it("banned phrase", () => expect(tamper((r) => (r.comments[0].message += " This is your official score."))).toContain("banned_phrase"));
  it("band range", () => expect(tamper((r) => (r.criteria[0].band = 9))).toContain("band_range"));
  it("total consistency", () => expect(tamper((r) => (r.total.point_estimate += 2))).toContain("total_consistency"));
  it("factual without citation", () => expect(tamper((r) => { r.comments[0].kind = "factual_error"; r.comments[0].uncertain = false; r.comments[0].evidence.citations = []; })).toContain("factual_citation"));
});
