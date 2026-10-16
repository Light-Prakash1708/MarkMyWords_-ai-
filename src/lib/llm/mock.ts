import type { LlmProvider, StructuredRequest, StructuredResponse } from "./types";

/**
 * Deterministic test double. Responses are produced by a handler per task, so tests can return
 * valid, invalid or disagreeing outputs. Never used in production unless MMW_ALLOW_MOCK=true.
 */
export type MockHandler = (req: StructuredRequest<unknown>, callIndex: number) => unknown;

export class MockProvider implements LlmProvider {
  readonly name = "mock" as const;
  readonly calls: StructuredRequest<unknown>[] = [];
  constructor(private readonly handlers: Partial<Record<StructuredRequest<unknown>["task"], MockHandler>>) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const handler = this.handlers[req.task];
    if (!handler) throw new Error(`MockProvider: no handler for task ${req.task}`);
    const idx = this.calls.filter((c) => c.task === req.task).length;
    this.calls.push(req as StructuredRequest<unknown>);
    const raw = handler(req as StructuredRequest<unknown>, idx);
    const output = req.schema.parse(raw);
    const inputChars = req.content.reduce((s, b) => s + (b.type === "text" ? b.text.length : 2000), req.system.length);
    return { output, usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(JSON.stringify(raw).length / 4) }, model: "mock-model" };
  }
}
