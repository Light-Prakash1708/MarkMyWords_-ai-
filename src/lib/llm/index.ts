import { getEnv } from "../env";
import { AppError } from "../util/errors";
import { AnthropicProvider } from "./anthropic";
import type { LlmProvider } from "./types";

type G = typeof globalThis & { __mmwProviderOverride?: LlmProvider | null };

/** Tests and benchmarks can inject a provider (e.g. MockProvider). */
export function setProviderOverride(p: LlmProvider | null | undefined): void {
  (globalThis as G).__mmwProviderOverride = p ?? undefined;
}

/**
 * Returns the configured model provider, or null when running the rule-based demo evaluator
 * (no API key). Callers must handle null honestly (e.g. "requires an AI provider").
 */
export function getProvider(): LlmProvider | null {
  const override = (globalThis as G).__mmwProviderOverride;
  if (override !== undefined) return override;
  const env = getEnv();
  if (env.provider === "anthropic") {
    if (!env.anthropicKey) throw new AppError("PROVIDER_UNAVAILABLE", "MMW_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
    return new AnthropicProvider(env.anthropicKey);
  }
  return null;
}

export function providerLabel(p: LlmProvider | null): { provider: "anthropic" | "heuristic" | "mock"; isAi: boolean; label: string } {
  if (!p) return { provider: "heuristic", isAi: false, label: "Rule-based demo evaluator (no AI model configured)" };
  if (p.name === "mock") return { provider: "mock", isAi: false, label: "Mock provider (tests only)" };
  return { provider: "anthropic", isAi: true, label: "AI evaluator (Claude)" };
}

export type { LlmProvider } from "./types";
