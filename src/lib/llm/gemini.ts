import { type LlmProvider, ProviderError, type StructuredRequest, type StructuredResponse } from "./types";

/**
 * Google Gemini adapter (Generative Language API, v1beta generateContent) returning
 * schema-validated JSON. No SDK dependency.
 *
 * Robustness:
 *  - JSON mode with `responseJsonSchema`; if the API rejects the schema field, falls back to plain
 *    JSON mode with the schema stated in the prompt (output is still validated with Zod).
 *  - Retries 5xx / timeouts with backoff; honours RetryInfo on 429 (short waits only).
 *  - Falls through a model chain when a model is unknown (404) or its quota is exhausted, so a
 *    retired model ID or a free-tier daily limit does not take evaluation down.
 *  - One repair attempt when the output fails validation (the error is fed back to the model).
 */

const ALLOWED_KEYS = new Set([
  "type", "description", "title", "properties", "required", "additionalProperties", "enum", "format",
  "minimum", "maximum", "items", "prefixItems", "minItems", "maxItems", "anyOf", "nullable", "$ref", "$defs",
]);

/** Reduce a Zod-generated JSON Schema to the subset Gemini documents as supported. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "const") {
      out.enum = [v];
      continue;
    }
    if (k === "oneOf") {
      out.anyOf = toGeminiSchema(v);
      continue;
    }
    if (!ALLOWED_KEYS.has(k)) continue;
    if (k === "properties" || k === "$defs") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries((v as Record<string, unknown>) ?? {})) props[pk] = toGeminiSchema(pv);
      out[k] = props;
    } else if (k === "additionalProperties") {
      // Only boolean false is useful here; nested schemas for maps are dropped.
      if (v === false) out[k] = false;
    } else if (k === "format") {
      if (typeof v === "string" && ["date-time", "date", "time"].includes(v)) out[k] = v;
    } else {
      out[k] = toGeminiSchema(v);
    }
  }
  return out;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inline_data?: { mime_type: string; data: string };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
}

/** Pull the JSON object out of a model reply (tolerates code fences and leading prose). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new ProviderError("Model reply was not JSON", true);
  }
}

type FetchLike = typeof fetch;

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;
  constructor(
    private readonly apiKey: string,
    private readonly opts: {
      baseUrl?: string;
      fallbackModels?: string[];
      timeoutMs?: number;
      fetchImpl?: FetchLike;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  private get baseUrl() {
    return (this.opts.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const chain = [req.model, ...(this.opts.fallbackModels ?? [])].filter((m, i, a) => m && a.indexOf(m) === i);
    let lastErr: unknown;
    for (const model of chain) {
      try {
        return await this.withModel(req, model);
      } catch (e) {
        lastErr = e;
        // Try the next model only when this one is unavailable or out of quota.
        if (!(e instanceof ProviderError) || !(e.status === 404 || e.status === 429 || (e.status === 403 && /model/i.test(e.message)))) throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new ProviderError("Gemini request failed", false);
  }

  private async withModel<T>(req: StructuredRequest<T>, model: string): Promise<StructuredResponse<T>> {
    let useSchemaField = true;
    let repairNote: string | null = null;
    const usage = { inputTokens: 0, outputTokens: 0 };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const json = await this.call(model, this.body(req, useSchemaField, repairNote));
        usage.inputTokens += json.usageMetadata?.promptTokenCount ?? 0;
        usage.outputTokens += (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0);
        if (json.promptFeedback?.blockReason) throw new ProviderError(`Gemini blocked the request (${json.promptFeedback.blockReason})`, false, 400);
        const cand = json.candidates?.[0];
        const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
        if (!text) throw new ProviderError(`Gemini returned no content (finish: ${cand?.finishReason ?? "unknown"})`, true);
        const raw = extractJson(text);
        const parsed = req.schema.safeParse(raw);
        if (!parsed.success) {
          repairNote = parsed.error.message.slice(0, 1200);
          throw new ProviderError(`Structured output failed validation: ${repairNote.slice(0, 300)}`, true);
        }
        return { output: parsed.data, usage, model: json.modelVersion || model };
      } catch (e) {
        lastErr = e;
        if (e instanceof ProviderError && e.status === 400 && useSchemaField && /schema|responseJsonSchema|response_json_schema|Unknown name/i.test(e.message)) {
          useSchemaField = false; // older API surface: describe the schema in the prompt instead
          continue;
        }
        const retryable = e instanceof ProviderError ? e.retryable : (e as Error).name === "AbortError" || e instanceof TypeError;
        if (!retryable || attempt === 3) break;
        const wait = e instanceof ProviderError && e.retryAfterMs ? e.retryAfterMs : 800 * 2 ** attempt + Math.random() * 300;
        await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
      }
    }
    throw lastErr instanceof Error ? lastErr : new ProviderError("Gemini request failed", false);
  }

  private body<T>(req: StructuredRequest<T>, useSchemaField: boolean, repairNote: string | null) {
    const schema = toGeminiSchema(req.jsonSchema);
    const instructions = [
      req.system,
      `Respond with a single JSON object for "${req.toolName}": ${req.toolDescription}`,
      useSchemaField ? "" : `The JSON must match this JSON Schema exactly:\n${JSON.stringify(schema)}`,
      repairNote ? `Your previous reply did not match the schema. Fix these problems and reply again:\n${repairNote}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [
        {
          role: "user",
          parts: req.content.map((b) =>
            b.type === "text" ? { text: b.text } : { inline_data: { mime_type: b.mediaType, data: b.dataBase64 } },
          ),
        },
      ],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        // Thinking tokens count against this limit on Gemini, so leave generous headroom.
        maxOutputTokens: req.maxTokens + 8192,
        responseMimeType: "application/json",
        ...(useSchemaField ? { responseJsonSchema: schema } : {}),
      },
    };
  }

  private async call(model: string, body: unknown): Promise<GeminiResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120_000);
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let retryAfterMs: number | undefined;
        let perDay = false;
        try {
          const err = JSON.parse(text) as { error?: { details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[] } };
          for (const d of err.error?.details ?? []) {
            if (d.retryDelay) retryAfterMs = Math.round(parseFloat(d.retryDelay) * 1000);
            if (d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? ""))) perDay = true;
          }
        } catch {
          /* not JSON */
        }
        // 429: wait briefly and retry when the wait is short; otherwise let the caller switch models.
        const shortWait = retryAfterMs !== undefined && retryAfterMs <= 20_000 && !perDay;
        const retryable = res.status >= 500 || (res.status === 429 && shortWait);
        const e = new ProviderError(`Gemini API ${res.status} (${model}): ${text.replace(/\s+/g, " ").slice(0, 300)}`, retryable, res.status);
        if (retryable && retryAfterMs) e.retryAfterMs = retryAfterMs;
        throw e;
      }
      return (await res.json()) as GeminiResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}
