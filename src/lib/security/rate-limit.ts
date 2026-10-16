import type { DB } from "../db";
import { AppError } from "../util/errors";

/**
 * Fixed-window rate limiter stored in SQLite (single-node deployments). Returns remaining budget;
 * throws RATE_LIMITED when exceeded. Keys should be namespaced, e.g. `login:ip:1.2.3.4`.
 */
export function rateLimit(db: DB, key: string, limit: number, windowSec: number, now = Date.now()): { remaining: number } {
  const windowStart = Math.floor(now / 1000 / windowSec) * windowSec;
  const row = db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .get(key, windowStart) as { count: number };
  if (row.count > limit) {
    const retryAfterSec = windowStart + windowSec - Math.floor(now / 1000);
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait and try again.", { retryAfterSec });
  }
  // Opportunistic cleanup of old windows.
  if (Math.random() < 0.02) db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(Math.floor(now / 1000) - 86400 * 2);
  return { remaining: limit - row.count };
}
