import type { DB } from "../db";
import { getEnv } from "../env";
import { AppError } from "../util/errors";
import { istDayStartIso, newId, nowIso } from "../util/ids";
import type { Usage } from "./types";

export function estimateCostInr(usage: Usage): number {
  const env = getEnv();
  return (usage.inputTokens / 1e6) * env.priceInputPerMTokInr + (usage.outputTokens / 1e6) * env.priceOutputPerMTokInr;
}

export function recordCost(
  db: DB,
  entry: { userId: string | null; operation: string; provider: string; model: string; usage: Usage; traceId?: string },
): number {
  const cost = entry.provider === "anthropic" ? estimateCostInr(entry.usage) : 0;
  db.prepare(
    "INSERT INTO cost_ledger (id, user_id, operation, provider, model_id, input_tokens, output_tokens, est_cost_inr, trace_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(newId(), entry.userId, entry.operation, entry.provider, entry.model, entry.usage.inputTokens, entry.usage.outputTokens, cost, entry.traceId ?? null, nowIso());
  return cost;
}

export function spendToday(db: DB): number {
  const row = db.prepare("SELECT COALESCE(SUM(est_cost_inr), 0) AS s FROM cost_ledger WHERE created_at >= ?").get(istDayStartIso()) as { s: number };
  return row.s;
}

/** Global circuit breaker: refuse new paid model work once today's estimated spend hits the cap. */
export function assertSpendCapNotReached(db: DB): void {
  const cap = getEnv().dailySpendCapInr;
  if (cap > 0 && spendToday(db) >= cap) {
    throw new AppError(
      "SPEND_CAP",
      "MarkMyWords is handling high demand right now. Your answer is saved — evaluation will be available again soon.",
    );
  }
}
