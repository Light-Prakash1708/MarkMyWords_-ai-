import { after } from "next/server";
import type { DB } from "../db";
import { parseJson, toJson } from "../db";
import { getEnv } from "../env";
import { withDeadline } from "../util/deadline";
import { newId, nowIso } from "../util/ids";

/**
 * Minimal durable job queue in the database. Jobs are claimed atomically (UPDATE … RETURNING), so
 * several processes or serverless instances can drain the same queue safely.
 *
 * How jobs get run:
 *  - inside a request (route handler, server component), via `after()`, so serverless platforms
 *    keep the function alive until the work finishes;
 *  - outside a request (scripts, a long-running Node server), via setImmediate; plus
 *  - a periodic sweep on long-running servers (src/instrumentation.ts), and a re-kick whenever the
 *    attempt page polls while work is pending. Jobs stuck in "running" (instance killed mid-job)
 *    are re-queued after STALE_MS.
 */
export type JobKind = "evaluate" | "ocr";

export async function enqueue(db: DB, kind: JobKind, payload: Record<string, unknown>, opts: { kick?: boolean } = {}): Promise<string> {
  const id = newId();
  const t = nowIso();
  (await db.run("INSERT INTO jobs (id, kind, payload, status, attempts, run_after, created_at, updated_at) VALUES (?,?,?,'queued',0,?,?,?)", id, kind, toJson(payload), t, t, t));
  const kick = opts.kick ?? !getEnv().isTest;
  if (kick) kickJobs(db);
  return id;
}

/** Run pending jobs after the current response (or soon, when not inside a request). */
export function kickJobs(db: DB) {
  const run = () => runPendingJobs(db).catch((e) => console.error("[mmw] job runner:", (e as Error)?.message ?? e));
  try {
    after(run);
  } catch {
    setImmediate(() => void run());
  }
}

/** True when this attempt has queued or running work (used to re-kick while the page polls). */
export async function hasPendingJobs(db: DB): Promise<boolean> {
  return !!(await db.get("SELECT 1 AS x FROM jobs WHERE status IN ('queued','running') LIMIT 1"));
}

export const DETAIL_SEP = "\n\nTechnical details: ";

/** Provider error text with anything that looks like a credential removed. */
export function scrubDetail(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/(key|token|secret|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .slice(0, 300);
}

/** What a student sees when background work fails (details stay in jobs.last_error and logs). */
export function studentFacingError(kind: JobKind, message: string): string {
  const what = kind === "evaluate" ? "The AI evaluator" : "Handwriting reading";
  if (/time budget|did not respond within|timed out|408/i.test(message)) return `${what} took too long to respond. Your work is saved — please try again in a minute.`;
  if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(message)) return `${what} is at its usage limit right now. Your work is saved — please try again later.`;
  if (/API key|PERMISSION_DENIED|\b40[13]\b/i.test(message)) return `${what} is not available because of a configuration problem on our side. Your work is saved.`;
  return `${what} could not finish this time. Your work is saved — please try again.`;
}

type G = typeof globalThis & { __mmwJobsRunning?: boolean; __mmwJobsRerun?: boolean };

export async function runPendingJobs(db: DB, max?: number): Promise<number> {
  const env = getEnv();
  // On serverless, one invocation handles one job so it stays inside the function time limit;
  // every request (and the attempt page while it polls) kicks the queue again.
  const limit = max ?? (env.onVercel ? 1 : 20);
  const staleMs = env.jobBudgetMs + 90_000;
  const g = globalThis as G;
  // A per-process lock only helps on a long-running server. Serverless instances serve several
  // requests at once, and the atomic claim below already prevents double work.
  if (!env.onVercel && g.__mmwJobsRunning) {
    // Another runner in this process is draining the queue; ask it to look once more before stopping.
    g.__mmwJobsRerun = true;
    return 0;
  }
  g.__mmwJobsRunning = true;
  let done = 0;
  try {
    await db.run(
      "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running' AND updated_at < ?",
      nowIso(),
      new Date(Date.now() - staleMs).toISOString(),
    );
    for (let i = 0; i < limit; i++) {
      g.__mmwJobsRerun = false;
      const job = (await db.get(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
           WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at LIMIT 1)
           RETURNING id, kind, payload, attempts`, nowIso(), nowIso())) as { id: string; kind: JobKind; payload: string; attempts: number } | undefined;
      if (!job) {
        if (g.__mmwJobsRerun && !env.onVercel) continue;
        break;
      }
      const payload = parseJson<Record<string, string>>(job.payload, {});
      try {
        const started = Date.now();
        await withDeadline(env.jobBudgetMs, async () => {
          if (job.kind === "evaluate") {
            const { runEvaluationJob } = await import("./evaluations");
            await runEvaluationJob(db, payload.evaluation_id);
          } else if (job.kind === "ocr") {
            const { runOcrJob } = await import("./ocr-jobs");
            await runOcrJob(db, payload.attempt_id);
          }
        });
        console.info(`[mmw] job ${job.kind} done in ${Date.now() - started}ms (attempt ${job.attempts})`);
        (await db.run("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?", nowIso(), job.id));
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 500) ?? "error";
        console.error(`[mmw] job ${job.kind} failed (attempt ${job.attempts}): ${msg}`);
        // Timeouts get one retry; other transient errors up to three attempts.
        const timedOut = /time budget|did not respond within|timed out/i.test(msg);
        const retryable = !(e as { permanent?: boolean }).permanent && job.attempts < (timedOut ? 2 : 3);
        if (retryable) {
          const delay = 5000 * 2 ** (job.attempts - 1);
          (await db.run("UPDATE jobs SET status = 'queued', run_after = ?, last_error = ?, updated_at = ? WHERE id = ?", new Date(Date.now() + delay).toISOString(), msg, nowIso(), job.id));
        } else {
          (await db.run("UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", msg, nowIso(), job.id));
          if (job.kind === "evaluate") {
            const { markEvaluationFailed } = await import("./evaluations");
            (await markEvaluationFailed(db, payload.evaluation_id, studentFacingError("evaluate", msg) + DETAIL_SEP + scrubDetail(msg)));
          } else if (job.kind === "ocr") {
            const { markOcrFailed } = await import("./ocr-jobs");
            (await markOcrFailed(db, payload.attempt_id, studentFacingError("ocr", msg) + DETAIL_SEP + scrubDetail(msg)));
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
