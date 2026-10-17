import type { DB } from "../db";
import { hashPassword } from "../auth/password";
import { createSession, type SessionUser } from "../auth/session";
import { loadTrialConfig, type TrialConfig } from "../exam-config";
import { rateLimit } from "../security/rate-limit";
import { AppError } from "../util/errors";
import { istDayStartIso, newId, nowIso, randomToken } from "../util/ids";
import { getQuestion, listExams, type QuestionView } from "./questions";
import { CONSENT_POLICY_VERSION, CONSENT_PURPOSES, purgeUserRows } from "./users";

/**
 * Guest trial: a visitor can answer a small set of questions without creating an account.
 * A guest is an ordinary user row with plan = 'guest', an unusable password and an address under
 * the reserved .invalid domain, so every existing ownership check applies unchanged. Signing up
 * from a guest session converts that same row into a normal account and keeps the work.
 */
export const GUEST_PLAN = "guest";
export const isGuest = (u: Pick<SessionUser, "plan"> | null | undefined) => u?.plan === GUEST_PLAN;

let cached: { at: number; cfg: TrialConfig } | null = null;
export function trialConfig(): TrialConfig {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), cfg: loadTrialConfig() };
  return cached.cfg;
}

export interface TrialExam {
  code: string;
  name: string;
  short_name: string;
  stage: string;
  limit: number;
  used: number;
  questions: (QuestionView & { attempt_id: string | null; attempt_status: string | null })[];
}

/** The trial question sets, with this guest's progress (if any). Missing slugs are skipped. */
export async function trialOverview(db: DB, user: SessionUser | null): Promise<TrialExam[]> {
  const cfg = trialConfig();
  const exams = (await listExams(db)).filter((e) => e.status === "active");
  const out: TrialExam[] = [];
  for (const e of exams) {
    const slugs = cfg.questions[e.code] ?? [];
    const qs: TrialExam["questions"] = [];
    for (const slug of slugs) {
      let q: QuestionView;
      try {
        q = await getQuestion(db, slug);
      } catch {
        continue;
      }
      if (q.exam_code !== e.code || q.exam_status !== "active" || q.review_status === "retired") continue;
      const att = user
        ? ((await db.get(
            "SELECT id, status FROM attempts WHERE user_id = ? AND question_id = ? ORDER BY created_at DESC LIMIT 1",
            user.id,
            q.id,
          )) as { id: string; status: string } | undefined)
        : undefined;
      qs.push({ ...q, attempt_id: att?.id ?? null, attempt_status: att?.status ?? null });
    }
    if (!qs.length) continue;
    out.push({ code: e.code, name: e.name, short_name: e.short_name, stage: e.stage, limit: cfg.answers_per_exam, used: qs.filter((q) => q.attempt_id).length, questions: qs });
  }
  return out;
}

/** Create a guest account + session. Rate-limited per IP and globally. */
export async function startGuest(db: DB, ip: string, targetExamCode?: string | null): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const cfg = trialConfig();
  await rateLimit(db, `guest:new:ip:${ip}`, cfg.max_new_guests_per_ip_per_day, 86400);
  const today = ((await db.get("SELECT COUNT(*) AS n FROM users WHERE plan = ? AND created_at >= ?", GUEST_PLAN, istDayStartIso())) as { n: number }).n;
  if (today >= cfg.max_new_guests_per_day) {
    throw new AppError("QUOTA_EXCEEDED", "The free trial is very busy today. Create a free account to keep practising.");
  }
  if (Math.random() < 0.05) await purgeStaleGuests(db).catch(() => undefined);
  const id = newId();
  const t = nowIso();
  const exams = (await listExams(db)).filter((e) => e.status === "active");
  const target = exams.find((e) => e.code === targetExamCode)?.code ?? exams[0]?.code ?? null;
  await db.transaction(async (db) => {
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, role, target_exam_code, plan, created_at, updated_at) VALUES (?,?,?,?,'student',?,?,?,?)",
      id,
      `guest-${id}@guest.invalid`,
      await hashPassword(randomToken(24)),
      "Guest",
      target,
      GUEST_PLAN,
      t,
      t,
    );
    for (const purpose of CONSENT_PURPOSES) {
      await db.run("INSERT INTO consents (id, user_id, purpose, granted, policy_version, created_at, updated_at) VALUES (?,?,?,0,?,?,?)", newId(), id, purpose, CONSENT_POLICY_VERSION, t, t);
    }
  });
  const session = await createSession(db, id, cfg.guest_session_days);
  return { user: { id, email: `guest-${id}@guest.invalid`, display_name: "Guest", role: "student", target_exam_code: target, plan: GUEST_PLAN }, ...session };
}

/**
 * Guests may only answer the trial questions, at most `answers_per_exam` different questions per
 * exam, plus a limited number of rewrites. Throws a friendly error pointing to sign-up.
 */
export async function assertGuestMayAttempt(db: DB, userId: string, q: QuestionView, kind: string) {
  const cfg = trialConfig();
  const slugs = cfg.questions[q.exam_code] ?? [];
  if (!slugs.includes(q.slug)) {
    throw new AppError("SIGNUP_REQUIRED", "This question is not part of the free trial. Create a free account to practise the full question bank.");
  }
  if (kind === "transfer_retest") throw new AppError("SIGNUP_REQUIRED", "Transfer retests are part of a free account. Sign up to keep your progress.");
  if (kind === "rewrite") {
    const n = ((await db.get("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND question_id = ? AND attempt_kind = 'rewrite'", userId, q.id)) as { n: number }).n;
    if (n >= cfg.rewrites_per_question) throw new AppError("SIGNUP_REQUIRED", "You have used the trial rewrite for this question. Create a free account to keep improving it.");
    return;
  }
  const already = await db.get("SELECT 1 AS x FROM attempts WHERE user_id = ? AND question_id = ? AND attempt_kind = 'first' LIMIT 1", userId, q.id);
  if (already) {
    throw new AppError("SIGNUP_REQUIRED", "You have already tried this question. Open it from the trial page, or create a free account to practise it again.");
  }
  const used = ((await db.get(
    `SELECT COUNT(DISTINCT a.question_id) AS n FROM attempts a JOIN questions qq ON qq.id = a.question_id JOIN papers p ON p.id = qq.paper_id JOIN exams e ON e.id = p.exam_id
     WHERE a.user_id = ? AND e.code = ? AND a.attempt_kind = 'first'`,
    userId,
    q.exam_code,
  )) as { n: number }).n;
  if (used >= cfg.answers_per_exam) {
    throw new AppError("SIGNUP_REQUIRED", `You have used all ${cfg.answers_per_exam} free trial answers for ${q.exam_short_name}. Create a free account to keep going — your work comes with you.`);
  }
}

/** Global ceiling on AI evaluations for guests per day (cost safety). */
export async function assertGuestEvaluationBudget(db: DB) {
  const cfg = trialConfig();
  const n = ((await db.get(
    "SELECT COUNT(*) AS n FROM evaluations e JOIN attempts a ON a.id = e.attempt_id JOIN users u ON u.id = a.user_id WHERE u.plan = ? AND e.created_at >= ?",
    GUEST_PLAN,
    istDayStartIso(),
  )) as { n: number }).n;
  if (n >= cfg.max_guest_evaluations_per_day) {
    throw new AppError("QUOTA_EXCEEDED", "Free trial feedback is at capacity for today. Create a free account to get your feedback now — your answer is saved.");
  }
}

/** Delete guest sessions that were never converted into an account. */
export async function purgeStaleGuests(db: DB, now = Date.now()): Promise<number> {
  const cfg = trialConfig();
  const cutoff = new Date(now - cfg.purge_guests_after_days * 86400_000).toISOString();
  const rows = (await db.all("SELECT id FROM users WHERE plan = ? AND created_at < ? LIMIT 50", GUEST_PLAN, cutoff)) as { id: string }[];
  for (const r of rows) await db.transaction(async (tx) => purgeUserRows(tx, r.id));
  return rows.length;
}
