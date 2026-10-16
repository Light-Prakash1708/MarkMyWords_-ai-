import type { DB } from "../db";
import { parseJson, toJson } from "../db";
import { getEnv } from "../env";
import { newId, nowIso } from "../util/ids";

/**
 * Minimal durable job queue in SQLite (single-node). Jobs are kicked immediately in-process and
 * also picked up by a periodic sweep (see src/instrumentation.ts), so a restart does not lose work.
 */
export type JobKind = "evaluate" | "ocr";

export function enqueue(db: DB, kind: JobKind, payload: Record<string, unknown>, opts: { kick?: boolean } = {}): string {
  const id = newId();
  const t = nowIso();
  db.prepare("INSERT INTO jobs (id, kind, payload, status, attempts, run_after, created_at, updated_at) VALUES (?,?,?,'queued',0,?,?,?)").run(
    id, kind, toJson(payload), t, t, t,
  );
  const kick = opts.kick ?? !getEnv().isTest;
  if (kick) setImmediate(() => void runPendingJobs(db));
  return id;
}

type G = typeof globalThis & { __mmwJobsRunning?: boolean };

export async function runPendingJobs(db: DB, max = 20): Promise<number> {
  const g = globalThis as G;
  if (g.__mmwJobsRunning) return 0;
  g.__mmwJobsRunning = true;
  let done = 0;
  try {
    for (let i = 0; i < max; i++) {
      const job = db
        .prepare(
          `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
           WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at LIMIT 1)
           RETURNING id, kind, payload, attempts`,
        )
        .get(nowIso(), nowIso()) as { id: string; kind: JobKind; payload: string; attempts: number } | undefined;
      if (!job) break;
      const payload = parseJson<Record<string, string>>(job.payload, {});
      try {
        if (job.kind === "evaluate") {
          const { runEvaluationJob } = await import("./evaluations");
          await runEvaluationJob(db, payload.evaluation_id);
        } else if (job.kind === "ocr") {
          const { runOcrJob } = await import("./ocr-jobs");
          await runOcrJob(db, payload.attempt_id);
        }
        db.prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 500) ?? "error";
        const retryable = !(e as { permanent?: boolean }).permanent && job.attempts < 3;
        if (retryable) {
          const delay = 5000 * 2 ** (job.attempts - 1);
          db.prepare("UPDATE jobs SET status = 'queued', run_after = ?, last_error = ?, updated_at = ? WHERE id = ?").run(
            new Date(Date.now() + delay).toISOString(), msg, nowIso(), job.id,
          );
        } else {
          db.prepare("UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(msg, nowIso(), job.id);
          if (job.kind === "evaluate") {
            const { markEvaluationFailed } = await import("./evaluations");
            markEvaluationFailed(db, payload.evaluation_id, msg);
          } else if (job.kind === "ocr") {
            const { markOcrFailed } = await import("./ocr-jobs");
            markOcrFailed(db, payload.attempt_id, msg);
          }
        }
      }
      done++;
    }
  } finally {
    g.__mmwJobsRunning = false;
  }
  return done;
}
