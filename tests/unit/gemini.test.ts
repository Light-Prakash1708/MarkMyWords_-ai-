import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { extractJson, GeminiProvider, toGeminiSchema } from "@/lib/llm/gemini";
import { getProvider, providerLabel, setProviderOverride } from "@/lib/llm";
import { estimateCostInr } from "@/lib/llm/cost";
import type { StructuredRequest } from "@/lib/llm/types";

const schema = z.object({ verdict: z.enum(["good", "weak"]), points: z.array(z.string()).min(1) });
const req = (over: Partial<StructuredRequest<z.infer<typeof schema>>> = {}): StructuredRequest<z.infer<typeof schema>> => ({
  task: "judge",
  model: "gemini-3.8-flash",
  system: "Judge it.",
  content: [{ type: "text", text: "An answer" }, { type: "image", mediaType: "image/jpeg", dataBase64: "AAAA" }],
  schema,
  jsonSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", ...z.toJSONSchema(schema) } as Record<string, unknown>,
  toolName: "record_judgement",
  toolDescription: "Record the judgement.",
  maxTokens: 1000,
  ...over,
});

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
function stub(responses: (Response | ((c: Call) => Response))[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const c = { url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> };
    calls.push(c);
    const r = responses.shift();
    if (!r) throw new Error("unexpected call");
    return typeof r === "function" ? r(c) : r;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const ok = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 10 }, modelVersion: "gemini-3.8-flash-001", ...extra }), { status: 200, headers: { "content-type": "application/json" } });
const err = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

describe("Gemini provider", () => {
  it("sends a JSON-mode request with a sanitised schema, inline images and the key in a header", async () => {
    const { calls, fetchImpl } = stub([ok('{"verdict":"good","points":["clear intro"]}')]);
    const p = new GeminiProvider("test-key", { fetchImpl, sleep: noSleep });
    const r = await p.structured(req());
    expect(r.output).toEqual({ verdict: "good", points: ["clear intro"] });
    expect(r.model).toBe("gemini-3.8-flash-001");
    expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 40 }); // thinking tokens are billed as output
    const c = calls[0];
    expect(c.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(c.url).not.toContain("key=");
    expect(c.headers["x-goog-api-key"]).toBe("test-key");
    const gc = c.body.generationConfig as Record<string, unknown>;
    expect(gc.responseMimeType).toBe("application/json");
    expect(JSON.stringify(gc.responseJsonSchema)).not.toContain("$schema");
    const parts = (c.body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "AAAA" } });
  });

  it("falls back to schema-in-prompt when the API rejects the schema field", async () => {
    const { calls, fetchImpl } = stub([err(400, { error: { message: 'Invalid JSON payload received. Unknown name "responseJsonSchema"' } }), ok('```json\n{"verdict":"weak","points":["no data"]}\n```')]);
    const r = await new GeminiProvider("k", { fetchImpl, sleep: noSleep }).structured(req());
    expect(r.output.verdict).toBe("weak");
    expect((calls[1].body.generationConfig as Record<string, unknown>).responseJsonSchema).toBeUndefined();
    expect(JSON.stringify(calls[1].body.systemInstruction)).toContain("JSON Schema");
  });

  it("moves to the next model when one is unknown or out of daily quota", async () => {
    const { calls, fetchImpl } = stub([
      err(404, { error: { message: "models/gemini-3.8-flash is not found" } }),
      err(429, { error: { message: "quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { retryDelay: "3600s" }] } }),
      ok('{"verdict":"good","points":["a"]}', { modelVersion: undefined }),
    ]);
    const r = await new GeminiProvider("k", { fetchImpl, sleep: noSleep, fallbackModels: ["gemini-3.6-flash", "gemini-flash-latest"] }).structured(req());
    expect(calls.map((c) => c.url.split("/models/")[1])).toEqual(["gemini-3.8-flash:generateContent", "gemini-3.6-flash:generateContent", "gemini-flash-latest:generateContent"]);
    expect(r.model).toBe("gemini-flash-latest");
  });

  it("waits and retries on a short per-minute 429", async () => {
    const waits: number[] = [];
    const { fetchImpl } = stub([err(429, { error: { details: [{ retryDelay: "2s" }] } }), ok('{"verdict":"good","points":["a"]}')]);
    await new GeminiProvider("k", { fetchImpl, sleep: async (ms) => void waits.push(ms) }).structured(req());
    expect(waits).toEqual([2000]);
  });

  it("feeds validation errors back once and accepts the repaired reply", async () => {
    const { calls, fetchImpl } = stub([ok('{"verdict":"excellent","points":[]}'), ok('{"verdict":"good","points":["x"]}')]);
    const r = await new GeminiProvider("k", { fetchImpl, sleep: noSleep }).structured(req());
    expect(r.output.points).toEqual(["x"]);
    expect(JSON.stringify(calls[1].body.systemInstruction)).toContain("did not match the schema");
  });

  it("does not retry a blocked prompt or a bad key", async () => {
    const { calls, fetchImpl } = stub([err(400, { error: { message: "API key not valid. Please pass a valid API key." } })]);
    await expect(new GeminiProvider("bad", { fetchImpl, sleep: noSleep }).structured(req())).rejects.toThrow(/400/);
    expect(calls.length).toBe(1);
  });

  it("reduces schemas to the documented subset", () => {
    const s = toGeminiSchema({ type: "object", properties: { a: { type: "string", minLength: 3, pattern: "x", const: "k" }, b: { oneOf: [{ type: "string" }, { type: "null" }] } }, required: ["a"], additionalProperties: false, $schema: "x" }) as Record<string, unknown>;
    expect(s).toEqual({ type: "object", properties: { a: { type: "string", enum: ["k"] }, b: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["a"], additionalProperties: false });
    expect(extractJson('Here you go: {"a":1} thanks')).toEqual({ a: 1 });
  });
});

describe("environment detection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setProviderOverride(undefined);
  });

  it("finds a Gemini key under any casing and makes Gemini the evaluator and OCR provider", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MMW_PROVIDER;
    delete process.env.MMW_OCR_PROVIDER;
    delete process.env.MMW_JUDGE_MODEL;
    process.env.Gemini_API_Key = "abc123";
    const env = getEnv();
    expect(env.geminiKey).toBe("abc123");
    expect(env.provider).toBe("gemini");
    expect(env.ocrProvider).toBe("gemini");
    expect(env.judgeModel).toMatch(/^gemini-/);
    expect(env.visionModel).toMatch(/^gemini-/);
    setProviderOverride(undefined);
    const p = getProvider();
    expect(p?.name).toBe("gemini");
    expect(providerLabel(p).label).toContain("Gemini");
    expect(estimateCostInr({ inputTokens: 1e6, outputTokens: 1e6 }, "gemini")).toBe(env.geminiPriceInputPerMTokInr + env.geminiPriceOutputPerMTokInr);
  });

  it("ignores a Claude model override when Gemini is the provider", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MMW_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "k";
    process.env.MMW_JUDGE_MODEL = "claude-sonnet-5-5";
    expect(getEnv().judgeModel).toBe("gemini-3.8-flash");
  });

  it("reads Turso credentials, including a custom Vercel prefix", () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.STORAGE_TURSO_DATABASE_URL = "libsql://db-example.turso.io";
    process.env.STORAGE_TURSO_AUTH_TOKEN = "tok";
    const env = getEnv();
    expect(env.dbUrl).toBe("libsql://db-example.turso.io");
    expect(env.dbAuthToken).toBe("tok");
    expect(env.ephemeralStorage).toBe(false);
  });
});
