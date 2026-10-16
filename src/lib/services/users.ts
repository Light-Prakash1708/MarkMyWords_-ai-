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
  (await rateLimit(db, `signup:ip:${ip}`, 10, 3600));
  const parsed = SignupSchema.safeParse(input);
  if (!parsed.success) throw invalid("Please check your details.", parsed.error.flatten().fieldErrors);
  const { email, password, display_name } = parsed.data;
  const problem = passwordProblem(password);
  if (problem) throw invalid(problem, { password: [problem] });
  if ((await db.get("SELECT 1 FROM users WHERE email = ?", email))) {
    throw new AppError("CONFLICT", "An account with this email already exists. Try logging in.");
  }
  const exams = (await db.all("SELECT code FROM exams WHERE status = 'active'")) as { code: string }[];
  const target = parsed.data.target_exam_code && exams.some((e) => e.code === parsed.data.target_exam_code) ? parsed.data.target_exam_code : exams[0]?.code ?? null;
  const env = getEnv();
  const role = env.adminEmails.includes(email) ? "admin" : "student";
  const id = newId();
  const t = nowIso();
  (await db.run("INSERT INTO users (id, email, password_hash, display_name, role, target_exam_code, plan, created_at, updated_at) VALUES (?,?,?,?,?,?,'free',?,?)", id, email, await hashPassword(password), display_name, role, target, t, t));
  for (const purpose of CONSENT_PURPOSES) {
    (await db.run("INSERT INTO consents (id, user_id, purpose, granted, policy_version, created_at, updated_at) VALUES (?,?,?,0,?,?,?)", newId(), id, purpose, CONSENT_POLICY_VERSION, t, t));
  }
  const session = (await createSession(db, id));
  return { user: { id, email, display_name, role, target_exam_code: target, plan: "free" }, ...session };
}

export async function login(db: DB, input: unknown, ip: string) {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).safeParse(input);
  if (!parsed.success) throw invalid("Enter your email and password.");
  (await rateLimit(db, `login:ip:${ip}`, 30, 900));
  (await rateLimit(db, `login:email:${parsed.data.email}`, 8, 900));
  const row = (await db.get("SELECT id, password_hash FROM users WHERE email = ?", parsed.data.email)) as { id: string; password_hash: string } | undefined;
  // Constant-ish work for unknown emails to limit account enumeration via timing.
  const ok = row ? await verifyPassword(parsed.data.password, row.password_hash) : (await hashPassword("timing-equaliser"), false);
  if (!row || !ok) throw new AppError("UNAUTHENTICATED", "Email or password is incorrect.");
  const env = getEnv();
  if (env.adminEmails.includes(parsed.data.email)) (await db.run("UPDATE users SET role='admin' WHERE id = ? AND role != 'admin'", row.id));
  return createSession(db, row.id);
}

export async function getConsents(db: DB, userId: string) {
  return (await db.all("SELECT purpose, granted, granted_at, revoked_at, policy_version FROM consents WHERE user_id = ? ORDER BY purpose", userId)) as {
    purpose: string;
    granted: number;
    granted_at: string | null;
    revoked_at: string | null;
    policy_version: string;
  }[];
}

export async function setConsent(db: DB, userId: string, purpose: string, granted: boolean) {
  if (!(CONSENT_PURPOSES as readonly string[]).includes(purpose)) throw invalid("Unknown consent purpose.");
  const t = nowIso();
  (await db.run(`INSERT INTO consents (id, user_id, purpose, granted, granted_at, revoked_at, policy_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, purpose) DO UPDATE SET granted = excluded.granted,
       granted_at = CASE WHEN excluded.granted = 1 THEN excluded.granted_at ELSE consents.granted_at END,
       revoked_at = CASE WHEN excluded.granted = 0 THEN excluded.revoked_at ELSE NULL END,
       policy_version = excluded.policy_version, updated_at = excluded.updated_at`, newId(), userId, purpose, granted ? 1 : 0, granted ? t : null, granted ? null : t, CONSENT_POLICY_VERSION, t, t));
}

export async function updateProfile(db: DB, userId: string, input: unknown) {
  const p = z.object({ display_name: z.string().trim().min(1).max(60).optional(), target_exam_code: z.string().max(40).optional() }).parse(input);
  if (p.target_exam_code && !(await db.get("SELECT 1 FROM exams WHERE code = ? AND status = 'active'", p.target_exam_code))) {
    throw invalid("That exam is not available yet.");
  }
  (await db.run("UPDATE users SET display_name = COALESCE(?, display_name), target_exam_code = COALESCE(?, target_exam_code), updated_at = ? WHERE id = ?", p.display_name ?? null, p.target_exam_code ?? null, nowIso(), userId));
}

/** Everything we hold about a user, as JSON (data portability). */
export async function exportUserData(db: DB, userId: string) {
  const user = (await db.get("SELECT id, email, display_name, role, target_exam_code, plan, created_at FROM users WHERE id = ?", userId));
  const attempts = (await db.all("SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at", userId)) as { id: string }[];
  const ids = attempts.map((a) => a.id);
  const inList = async (tbl: string, col = "attempt_id") =>
    ids.length ? (await db.all(`SELECT * FROM ${tbl} WHERE ${col} IN (${ids.map(() => "?").join(",")})`, ...ids)) : [];
  const evaluations = ((await inList("evaluations")) as { result_json: string | null }[]).map((e) => ({ ...e, result_json: parseJson(e.result_json, null) }));
  return {
    exported_at: nowIso(),
    user,
    consents: (await getConsents(db, userId)),
    attempts,
    transcripts: (await inList("transcripts")),
    self_assessments: (await inList("self_assessments")),
    evaluations,
    uploads: ((await inList("uploads")) as Record<string, unknown>[]).map((u) => ({ ...u, note: "file bytes are not included; download individually from the app" })),
    hint_ladder: (await inList("hint_ladder_state")),
    disputes: (await db.all("SELECT * FROM disputes WHERE user_id = ?", userId)),
    skill_states: (await db.all("SELECT * FROM skill_states WHERE user_id = ?", userId)),
    error_ledger: (await db.all("SELECT * FROM error_ledger WHERE user_id = ?", userId)),
    retests: (await db.all("SELECT * FROM retest_schedule WHERE user_id = ?", userId)),
  };
}

/** Hard delete of every row belonging to the user, including uploaded page bytes. */
export async function deleteAccount(db: DB, userId: string, confirmEmail: string) {
  const u = (await db.get("SELECT email FROM users WHERE id = ?", userId)) as { email: string } | undefined;
  if (!u) throw new AppError("NOT_FOUND", "Account not found");
  if (u.email !== confirmEmail.trim().toLowerCase()) throw invalid("Type your email exactly to confirm deletion.");
  await db.transaction(async (db) => {
    (await destroyAllSessions(db, userId));
    // Explicit deletes (do not rely on FK cascades, which depend on per-connection PRAGMAs).
    const evals = "SELECT e.id FROM evaluations e JOIN attempts a ON a.id = e.attempt_id WHERE a.user_id = ?";
    const atts = "SELECT id FROM attempts WHERE user_id = ?";
    for (const t of ["evaluation_comments", "citations"]) await db.run(`DELETE FROM ${t} WHERE evaluation_id IN (${evals})`, userId);
    for (const t of ["disputes", "error_ledger", "retest_schedule"]) await db.run(`DELETE FROM ${t} WHERE user_id = ?`, userId);
    for (const t of ["uploads", "ocr_runs", "transcripts", "self_assessments", "hint_ladder_state", "hint_content", "evaluations"])
      await db.run(`DELETE FROM ${t} WHERE attempt_id IN (${atts})`, userId);
    await db.run("UPDATE attempts SET parent_attempt_id = NULL WHERE user_id = ?", userId);
    for (const t of ["attempts", "skill_states", "share_links", "consents", "sessions"]) await db.run(`DELETE FROM ${t} WHERE user_id = ?`, userId);
    (await db.run("DELETE FROM users WHERE id = ?", userId));
    (await db.run("DELETE FROM cost_ledger WHERE user_id = ?", userId));
    (await db.run("INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)", newId(), null, "account_deleted", "user", null, "user-initiated hard delete", nowIso()));
  });
}
