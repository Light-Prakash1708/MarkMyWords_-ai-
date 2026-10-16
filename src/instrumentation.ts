/** Starts the in-process job sweeper (evaluation + OCR jobs) when the Node server boots. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./lib/db");
  const { runPendingJobs } = await import("./lib/services/jobs");
  const db = getDb();
  // Reset jobs that were running when the process died.
  db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run();
  const timer = setInterval(() => void runPendingJobs(db).catch(() => undefined), 4000);
  timer.unref?.();
}
