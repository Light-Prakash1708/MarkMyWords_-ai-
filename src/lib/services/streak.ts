import type { DB } from "../db";
import { istDate } from "../util/ids";

/** Consecutive IST days (ending today or yesterday) with at least one submitted attempt. */
export async function practiceStreak(db: DB, userId: string, now = new Date()): Promise<{ days: number; doneToday: boolean }> {
  const rows = (await db.all("SELECT submitted_at FROM attempts WHERE user_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 400", userId)) as { submitted_at: string }[];
  const days = new Set(rows.map((r) => istDate(new Date(r.submitted_at))));
  const today = istDate(now);
  let cursor = new Date(now);
  if (!days.has(today)) cursor = new Date(now.getTime() - 86400_000);
  let n = 0;
  while (days.has(istDate(cursor))) {
    n++;
    cursor = new Date(cursor.getTime() - 86400_000);
  }
  return { days: n, doneToday: days.has(today) };
}
