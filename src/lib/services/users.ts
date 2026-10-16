import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "../db";
import { parseJson } from "../db";
import { getEnv } from "../env";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password";
import { createSession, destroyAllSessions, type SessionUser } from "../auth/session";
import { rateLimit } from "../security/rate-limit";
import { AppError, invalid } from "../util/errors";
import { newId, nowIso } from "../util/ids";

export const CONSENT_POLICY_VERSION = "p-2026-10-1";
export const CONSENT_PURPOSES = ["benchmark_use", "model_improvement", "public_example"] as const;

export const SignupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  display_name: z.string().trim().min(1).max(60),
  target_exam_code: z.string().max(40).optional(),
});

export async function signup(db: DB, input: unknown, ip: string): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  rateLimit(db, `signup:ip:${ip}`, 10, 3600);
  const parsed = SignupSchema.safeParse(input);
  if (!parsed.success) throw invalid("Please check your details.", parsed.error.flatten().fieldErrors);
  const { email, password, display_name } = parsed.data;
  const problem = passwordProblem(password);
  if (problem) throw invalid(problem, { password: [problem] });
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    throw new AppError("CONFLICT", "An account with this email already exists. Try logging in.");
  }
  const exams = db.prepare("SELECT code FROM exams WHERE status = 'active'").all() as { code: string }[];
  const target = parsed.data.target_exam_code && exams.some((e) => e.code === parsed.data.target_exam_code) ? parsed.data.target_exam_code : exams[0]?.code ?? null;
  const env = getEnv();
  const role = env.adminEmails.includes(email) ? "admin" : "student";
  const id = newId();
  const t = nowIso();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, role, target_exam_code, plan, created_at, updated_at) VALUES (?,?,?,?,?,?,'free',?,?)",
  ).run(id, email, await hashPassword(password), display_name, role, target, t, t);
  for (const purpose of CONSENT_PURPOSES) {
    db.prepare("INSERT INTO consents (id, user_id, purpose, granted, policy_version, created_at, updated_at) VALUES (?,?,?,0,?,?,?)").run(
      newId(), id, purpose, CONSENT_POLICY_VERSION, t, t,
    );
  }
  const session = createSession(db, id);
  return { user: { id, email, display_name, role, target_exam_code: target, plan: "free" }, ...session };
}

export async function login(db: DB, input: unknown, ip: string) {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).safeParse(input);
  if (!parsed.success) throw invalid("Enter your email and password.");
  rateLimit(db, `login:ip:${ip}`, 30, 900);
  rateLimit(db, `login:email:${parsed.data.email}`, 8, 900);
  const row = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(parsed.data.email) as { id: string; password_hash: string } | undefined;
  // Constant-ish work for unknown emails to limit account enumeration via timing.
  const ok = row ? await verifyPassword(parsed.data.password, row.password_hash) : (await hashPassword("timing-equaliser"), false);
  if (!row || !ok) throw new AppError("UNAUTHENTICATED", "Email or password is incorrect.");
  const env = getEnv();
  if (env.adminEmails.includes(parsed.data.email)) db.prepare("UPDATE users SET role='admin' WHERE id = ? AND role != 'admin'").run(row.id);
  return createSession(db, row.id);
}

export function getConsents(db: DB, userId: string) {
  return db.prepare("SELECT purpose, granted, granted_at, revoked_at, policy_version FROM consents WHERE user_id = ? ORDER BY purpose").all(userId) as {
    purpose: string;
    granted: number;
    granted_at: string | null;
    revoked_at: string | null;
    policy_version: string;
  }[];
}

export function setConsent(db: DB, userId: string, purpose: string, granted: boolean) {
  if (!(CONSENT_PURPOSES as readonly string[]).includes(purpose)) throw invalid("Unknown consent purpose.");
  const t = nowIso();
  db.prepare(
    `INSERT INTO consents (id, user_id, purpose, granted, granted_at, revoked_at, policy_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, purpose) DO UPDATE SET granted = excluded.granted,
       granted_at = CASE WHEN excluded.granted = 1 THEN excluded.granted_at ELSE consents.granted_at END,
       revoked_at = CASE WHEN excluded.granted = 0 THEN excluded.revoked_at ELSE NULL END,
       policy_version = excluded.policy_version, updated_at = excluded.updated_at`,
  ).run(newId(), userId, purpose, granted ? 1 : 0, granted ? t : null, granted ? null : t, CONSENT_POLICY_VERSION, t, t);
}

export function updateProfile(db: DB, userId: string, input: unknown) {
  const p = z.object({ display_name: z.string().trim().min(1).max(60).optional(), target_exam_code: z.string().max(40).optional() }).parse(input);
  if (p.target_exam_code && !db.prepare("SELECT 1 FROM exams WHERE code = ? AND status = 'active'").get(p.target_exam_code)) {
    throw invalid("That exam is not available yet.");
  }
  db.prepare("UPDATE users SET display_name = COALESCE(?, display_name), target_exam_code = COALESCE(?, target_exam_code), updated_at = ? WHERE id = ?").run(
    p.display_name ?? null, p.target_exam_code ?? null, nowIso(), userId,
  );
}

/** Everything we hold about a user, as JSON (data portability). */
export function exportUserData(db: DB, userId: string) {
  const user = db.prepare("SELECT id, email, display_name, role, target_exam_code, plan, created_at FROM users WHERE id = ?").get(userId);
  const attempts = db.prepare("SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at").all(userId) as { id: string }[];
  const ids = attempts.map((a) => a.id);
  const inList = (tbl: string, col = "attempt_id") =>
    ids.length ? db.prepare(`SELECT * FROM ${tbl} WHERE ${col} IN (${ids.map(() => "?").join(",")})`).all(...ids) : [];
  const evaluations = (inList("evaluations") as { result_json: string | null }[]).map((e) => ({ ...e, result_json: parseJson(e.result_json, null) }));
  return {
    exported_at: nowIso(),
    user,
    consents: getConsents(db, userId),
    attempts,
    transcripts: inList("transcripts"),
    self_assessments: inList("self_assessments"),
    evaluations,
    uploads: (inList("uploads") as Record<string, unknown>[]).map((u) => ({ ...u, note: "file bytes are not included; download individually from the app" })),
    hint_ladder: inList("hint_ladder_state"),
    disputes: db.prepare("SELECT * FROM disputes WHERE user_id = ?").all(userId),
    skill_states: db.prepare("SELECT * FROM skill_states WHERE user_id = ?").all(userId),
    error_ledger: db.prepare("SELECT * FROM error_ledger WHERE user_id = ?").all(userId),
    retests: db.prepare("SELECT * FROM retest_schedule WHERE user_id = ?").all(userId),
  };
}

/** Hard delete: rows (via cascades) and uploaded files. */
export function deleteAccount(db: DB, userId: string, confirmEmail: string) {
  const u = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string } | undefined;
  if (!u) throw new AppError("NOT_FOUND", "Account not found");
  if (u.email !== confirmEmail.trim().toLowerCase()) throw invalid("Type your email exactly to confirm deletion.");
  const files = db.prepare("SELECT storage_key FROM uploads WHERE user_id = ?").all(userId) as { storage_key: string }[];
  const dir = getEnv().uploadDir;
  for (const f of files) {
    const p = path.join(dir, f.storage_key);
    if (p.startsWith(dir)) fs.rmSync(p, { force: true });
  }
  fs.rmSync(path.join(dir, userId), { recursive: true, force: true });
  db.transaction(() => {
    destroyAllSessions(db, userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    db.prepare("DELETE FROM cost_ledger WHERE user_id = ?").run(userId);
    db.prepare("INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)").run(
      newId(), null, "account_deleted", "user", null, "user-initiated hard delete", nowIso(),
    );
  })();
}
