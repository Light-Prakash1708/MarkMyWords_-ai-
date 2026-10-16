/** Starts the in-process job sweeper (evaluation + OCR jobs) on long-running Node servers. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Serverless platforms freeze instances between requests; there jobs run via after() instead.
  if (process.env.VERCEL) return;
  const { getDb } = await import("./lib/db");
  const { runPendingJobs } = await import("./lib/services/jobs");
  const db = await getDb();
  // Reset jobs that were running when the process died.
  await db.run("UPDATE jobs SET status = 'queued' WHERE status = 'running'");
  const timer = setInterval(() => void runPendingJobs(db).catch(() => undefined), 4000);
  timer.unref?.();
}
