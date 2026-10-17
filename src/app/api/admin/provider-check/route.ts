import { z } from "zod";
import { route } from "@/lib/http";
import { getEnv } from "@/lib/env";
import { getProvider } from "@/lib/llm";
import { recordCost } from "@/lib/llm/cost";
import { requireAdmin } from "@/lib/services/admin";

/** Admin-only live check: one tiny structured call to the configured AI provider. */
export const POST = route(async (ctx) => {
  const admin = requireAdmin(ctx.user);
  const env = getEnv();
  const provider = getProvider();
  if (!provider) return { ok: false, provider: env.provider, message: "No AI provider is configured; the rule-based demo evaluator is in use." };
  const schema = z.object({ ok: z.boolean(), word: z.string() });
  const started = Date.now();
  try {
    const res = await provider.structured({
      task: "hint",
      model: env.fastModel,
      system: "You are a connectivity check. Reply exactly as instructed.",
      content: [{ type: "text", text: 'Return ok=true and word="ready".' }],
      schema,
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" }, word: { type: "string" } }, required: ["ok", "word"], additionalProperties: false },
      toolName: "connectivity_check",
      toolDescription: "Confirms the model can return structured output.",
      maxTokens: 50,
      temperature: 0,
    });
    await recordCost(ctx.db, { userId: admin.id, operation: "provider_check", provider: provider.name, model: res.model, usage: res.usage });
    return { ok: res.output.ok, provider: provider.name, model: res.model, latency_ms: Date.now() - started };
  } catch (e) {
    // The provider's error text never contains our key; trim it anyway.
    return { ok: false, provider: provider.name, model: env.fastModel, message: (e as Error).message.slice(0, 400) };
  }
});

export const maxDuration = 60;
