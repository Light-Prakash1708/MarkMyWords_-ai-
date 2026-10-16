import { getEnv } from "../env";
import { type LlmProvider, ProviderError, type StructuredRequest, type StructuredResponse } from "./types";

/**
 * Anthropic Messages API adapter using forced tool use for structured output.
 * No SDK dependency: plain fetch with timeouts and bounded retries on 429/5xx.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = getEnv().anthropicBaseUrl,
    private readonly timeoutMs = 120_000,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const body = {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.2,
      system: req.system,
      tools: [{ name: req.toolName, description: req.toolDescription, input_schema: req.jsonSchema }],
      tool_choice: { type: "tool", name: req.toolName },
      messages: [
        {
          role: "user",
          content: req.content.map((b) => {
            if (b.type === "text") return { type: "text", text: b.text };
            if (b.type === "image") return { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.dataBase64 } };
            return { type: "document", source: { type: "base64", media_type: b.mediaType, data: b.dataBase64 } };
          }),
        },
      ],
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const retryable = res.status === 429 || res.status >= 500;
          throw new ProviderError(`Anthropic API ${res.status}: ${text.slice(0, 300)}`, retryable, res.status);
        }
        const json = (await res.json()) as {
          model: string;
          content: { type: string; name?: string; input?: unknown }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const tool = json.content.find((c) => c.type === "tool_use" && c.name === req.toolName);
        if (!tool) throw new ProviderError("Model did not return structured output", true);
        const parsed = req.schema.safeParse(tool.input);
        if (!parsed.success) throw new ProviderError(`Structured output failed validation: ${parsed.error.message.slice(0, 400)}`, true);
        return {
          output: parsed.data,
          usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
          model: json.model,
        };
      } catch (e) {
        lastErr = e;
        const retryable = e instanceof ProviderError ? e.retryable : (e as Error).name === "AbortError" || e instanceof TypeError;
        if (!retryable || attempt === 2) break;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 300));
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastErr instanceof ProviderError) throw lastErr;
    throw new ProviderError(`Provider request failed: ${(lastErr as Error)?.message ?? "unknown"}`, false);
  }
}
