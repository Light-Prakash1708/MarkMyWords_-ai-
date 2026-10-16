import type { DB } from "../db";
import { newId, nowIso, randomToken, sha256Hex } from "../util/ids";

export const SESSION_COOKIE = "mmw_session";
export const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  role: "student" | "reviewer" | "admin";
  target_exam_code: string | null;
  plan: string;
}

export function createSession(db: DB, userId: string): { token: string; expiresAt: Date } {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  db.prepare("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)").run(
    newId(),
    userId,
    sha256Hex(token),
    nowIso(now),
    nowIso(expiresAt),
    nowIso(now),
  );
  return { token, expiresAt };
}

export function userForToken(db: DB, token: string | undefined | null): SessionUser | null {
  if (!token || token.length > 200) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role, u.target_exam_code, u.plan, s.id AS sid, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256Hex(token)) as (SessionUser & { sid: string; expires_at: string; last_seen_at: string }) | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.sid);
    return null;
  }
  // Touch at most every 10 minutes to limit writes.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 600_000) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.sid);
  }
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    target_exam_code: row.target_exam_code,
    plan: row.plan,
  };
}

export function destroySession(db: DB, token: string | undefined | null): void {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
}

export function destroyAllSessions(db: DB, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
