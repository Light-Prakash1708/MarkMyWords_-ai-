import type { z } from "zod";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp"; dataBase64: string }
  | { type: "document"; mediaType: "application/pdf"; dataBase64: string };

export interface StructuredRequest<T> {
  task: "judge" | "ocr" | "hint" | "outline" | "exemplar" | "sample_answer" | "question_generation";
  model: string;
  system: string;
  content: ContentBlock[];
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  toolName: string;
  toolDescription: string;
  maxTokens: number;
  temperature?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResponse<T> {
  output: T;
  usage: Usage;
  model: string;
}

/** A model provider that can return schema-validated structured output. */
export interface LlmProvider {
  readonly name: "anthropic" | "gemini" | "mock";
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export class ProviderError extends Error {
  /** Server-suggested wait before retrying (e.g. Gemini RetryInfo). */
  retryAfterMs?: number;
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}
