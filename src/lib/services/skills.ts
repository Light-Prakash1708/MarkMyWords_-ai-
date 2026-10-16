import type { DB } from "../db";
import { parseJson } from "../db";
import { getEnv } from "../env";
import type { EvaluationResult } from "../schemas/evaluation";
import type { RubricCriterion } from "../schemas/rubric";
import {
  applyDemonstrated,
  applyRepair,
  applyTransfer,
  applyWeakness,
  freshState,
  mastery,
  skillStatus,
  STATUS_LABEL,
  type SkillState,
  type SkillStatus,
} from "../skills/model";
import { newId, nowIso, randomToken, sha256Hex } from "../util/ids";
import type { AttemptRow } from "./attempts";
import { listQuestions, type QuestionView } from "./questions";

function loadState(db: DB, userId: string, tag: string, paper: string): SkillState {
  const r = db.prepare("SELECT * FROM skill_states WHERE user_id = ? AND skill_tag = ? AND paper_scope = ?").get(userId, tag, paper) as SkillState | undefined;
  return r ? { ...r } : freshState();
}

function saveState(db: DB, userId: string, tag: string, paper: string, s: SkillState) {
  db.prepare(
    `INSERT INTO skill_states (user_id, skill_tag, paper_scope, alpha, beta, occurrences, repair_count, transfer_success_count, transfer_attempt_count, last_transfer_result, last_updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, skill_tag, paper_scope) DO UPDATE SET alpha=excluded.alpha, beta=excluded.beta, occurrences=excluded.occurrences,
       repair_count=excluded.repair_count, transfer_success_count=excluded.transfer_success_count, transfer_attempt_count=excluded.transfer_attempt_count,
       last_transfer_result=excluded.last_transfer_result, last_updated=excluded.last_updated`,
  ).run(userId, tag, paper, s.alpha, s.beta, s.occurrences, s.repair_count, s.transfer_success_count, s.transfer_attempt_count, s.last_transfer_result, nowIso());
}

const isWeakness = (c: EvaluationResult["comments"][number]) => c.kind !== "strength" && !c.uncertain;

/** Update error ledger, skill posteriors, repair/transfer outcomes and schedule retests. */
export function applyEvaluationToSkills(db: DB, a: AttemptRow, evaluationId: string, r: EvaluationResult) {
  const paper = (db.prepare("SELECT p.code FROM questions q JOIN papers p ON p.id = q.paper_id WHERE q.id = ?").get(a.question_id) as { code: string }).code;
  const t = nowIso();
  const weak = r.comments.filter(isWeakness);
  const weakTags = new Set(weak.map((c) => c.skill_tag));

  for (const c of weak) {
    db.prepare(
      "INSERT INTO error_ledger (id, user_id, skill_tag, paper_code, attempt_id, evaluation_id, comment_id, severity, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(newId(), a.user_id, c.skill_tag, paper, a.id, evaluationId, c.id, c.severity, t);
    saveState(db, a.user_id, c.skill_tag, paper, applyWeakness(loadState(db, a.user_id, c.skill_tag, paper), c.severity));
  }

  // Demonstrated skills: criteria at band ≥ 3 with no weakness for that skill in this answer.
  const rv = db.prepare("SELECT criteria FROM rubric_versions WHERE id = ?").get(r.rubric.version_id) as { criteria: string } | undefined;
  const crit = parseJson<RubricCriterion[]>(rv?.criteria, []);
  for (const c of r.criteria) {
    if (c.band < 3) continue;
    for (const tag of crit.find((x) => x.code === c.code)?.skill_tags ?? []) {
      if (weakTags.has(tag)) continue;
      // Only reinforce skills the student has struggled with before (keeps the profile focused).
      const s = loadState(db, a.user_id, tag, paper);
      if (s.occurrences > 0) saveState(db, a.user_id, tag, paper, applyDemonstrated(s));
    }
  }

  // Repair: rewrite fixes prior issues.
  if (a.attempt_kind === "rewrite" && a.parent_attempt_id && r.rewrite_delta) {
    for (const d of r.rewrite_delta) {
      if (d.status !== "resolved") continue;
      const rows = db
        .prepare("UPDATE error_ledger SET resolved_in_rewrite = 1 WHERE attempt_id = ? AND comment_id = ? AND user_id = ? RETURNING skill_tag")
        .all(a.parent_attempt_id, d.prior_comment_id, a.user_id) as { skill_tag: string }[];
      for (const row of rows) saveState(db, a.user_id, row.skill_tag, paper, applyRepair(loadState(db, a.user_id, row.skill_tag, paper)));
    }
  }

  // Transfer: a fresh question after a delay, with no hints before submission.
  if (a.attempt_kind === "transfer_retest" && a.retest_id) {
    const rt = db.prepare("SELECT * FROM retest_schedule WHERE id = ? AND user_id = ?").get(a.retest_id, a.user_id) as
      | { id: string; skill_tag: string; source_attempt_id: string; paper_code: string }
      | undefined;
    if (rt) {
      const passed = !weakTags.has(rt.skill_tag);
      db.prepare("UPDATE retest_schedule SET status = ?, completed_attempt_id = ? WHERE id = ?").run(passed ? "passed" : "failed", a.id, rt.id);
      db.prepare("UPDATE error_ledger SET absent_in_transfer = ? WHERE user_id = ? AND attempt_id = ? AND skill_tag = ?").run(passed ? 1 : 0, a.user_id, rt.source_attempt_id, rt.skill_tag);
      saveState(db, a.user_id, rt.skill_tag, rt.paper_code, applyTransfer(loadState(db, a.user_id, rt.skill_tag, rt.paper_code), passed));
    }
  }

  // Schedule transfer retests for this answer's top weaknesses (first attempts only).
  if (a.attempt_kind === "first") {
    const topTags = Array.from(new Set(r.top_priorities.map((p) => r.comments.find((c) => c.id === p.comment_id)?.skill_tag).filter((x): x is string => !!x))).slice(0, 2);
    const due = new Date(Date.now() + getEnv().retestDelayHours * 3600_000).toISOString();
    for (const tag of topTags) {
      const open = db.prepare("SELECT 1 FROM retest_schedule WHERE user_id = ? AND skill_tag = ? AND status IN ('scheduled','in_progress')").get(a.user_id, tag);
      if (open) continue;
      const q = pickTransferQuestion(db, a.user_id, a.question_id, tag);
      db.prepare(
        "INSERT INTO retest_schedule (id, user_id, skill_tag, paper_code, source_attempt_id, question_id, due_at, status, created_at) VALUES (?,?,?,?,?,?,?,'scheduled',?)",
      ).run(newId(), a.user_id, tag, paper, a.id, q?.id ?? null, due, t);
    }
  }
}

function attemptedQuestionIds(db: DB, userId: string): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT question_id FROM attempts WHERE user_id = ?").all(userId) as { question_id: string }[]).map((r) => r.question_id));
}

export function pickTransferQuestion(db: DB, userId: string, sourceQuestionId: string, tag: string): QuestionView | null {
  const user = db.prepare("SELECT target_exam_code FROM users WHERE id = ?").get(userId) as { target_exam_code: string | null } | undefined;
  const all = listQuestions(db, { examCode: user?.target_exam_code ?? null });
  const done = attemptedQuestionIds(db, userId);
  const reserved = new Set(
    (db.prepare("SELECT question_id FROM retest_schedule WHERE user_id = ? AND status IN ('scheduled','in_progress') AND question_id IS NOT NULL").all(userId) as { question_id: string }[]).map(
      (r) => r.question_id,
    ),
  );
  const fresh = all.filter((q) => q.id !== sourceQuestionId && !done.has(q.id) && !reserved.has(q.id));
  return fresh.find((q) => q.skill_tags_targeted.includes(tag)) ?? fresh[0] ?? null;
}

export interface Recommendation {
  question: QuestionView;
  reason: string;
  kind: "retest" | "weakness" | "coverage";
  retest_id?: string;
  skill_tag?: string;
}

export function dueRetests(db: DB, userId: string, now = new Date()) {
  return db
    .prepare(
      `SELECT r.*, s.name AS skill_name FROM retest_schedule r JOIN skill_tags s ON s.code = r.skill_tag
       WHERE r.user_id = ? AND r.status IN ('scheduled','in_progress') ORDER BY r.due_at`,
    )
    .all(userId)
    .map((r) => {
      const row = r as { id: string; skill_tag: string; skill_name: string; question_id: string | null; due_at: string; status: string; source_attempt_id: string };
      return { ...row, is_due: new Date(row.due_at).getTime() <= now.getTime() };
    });
}

export function recommendNext(db: DB, userId: string, limit = 3): Recommendation[] {
  const user = db.prepare("SELECT target_exam_code FROM users WHERE id = ?").get(userId) as { target_exam_code: string | null } | undefined;
  const all = listQuestions(db, { examCode: user?.target_exam_code ?? null });
  const byId = new Map(all.map((q) => [q.id, q]));
  const done = attemptedQuestionIds(db, userId);
  const out: Recommendation[] = [];
  for (const r of dueRetests(db, userId)) {
    if (!r.is_due) continue;
    let q = r.question_id ? byId.get(r.question_id) : undefined;
    if (!q) {
      q = pickTransferQuestion(db, userId, "", r.skill_tag) ?? undefined;
      if (q) db.prepare("UPDATE retest_schedule SET question_id = ? WHERE id = ?").run(q.id, r.id);
    }
    if (q) out.push({ question: q, kind: "retest", retest_id: r.id, skill_tag: r.skill_tag, reason: `Transfer check for “${r.skill_name}”: you worked on this before — does it hold on a fresh question, with no hints?` });
    if (out.length >= limit) return out;
  }
  // Weak skills, most frequent recently.
  const recent = db
    .prepare(
      `SELECT l.skill_tag, s.name, COUNT(*) AS n,
        (SELECT COUNT(DISTINCT attempt_id) FROM (SELECT attempt_id FROM error_ledger WHERE user_id = ? GROUP BY attempt_id ORDER BY MAX(occurred_at) DESC LIMIT 6)) AS window
       FROM error_ledger l JOIN skill_tags s ON s.code = l.skill_tag
       WHERE l.user_id = ? AND l.attempt_id IN (SELECT attempt_id FROM error_ledger WHERE user_id = ? GROUP BY attempt_id ORDER BY MAX(occurred_at) DESC LIMIT 6)
       GROUP BY l.skill_tag ORDER BY n DESC LIMIT 3`,
    )
    .all(userId, userId, userId) as { skill_tag: string; name: string; n: number; window: number }[];
  const used = new Set(out.map((o) => o.question.id));
  for (const w of recent) {
    const q = all.find((x) => !done.has(x.id) && !used.has(x.id) && x.skill_tags_targeted.includes(w.skill_tag));
    if (!q) continue;
    used.add(q.id);
    out.push({ question: q, kind: "weakness", skill_tag: w.skill_tag, reason: `Chosen because “${w.name}” came up in ${w.n} of your last ${w.window} evaluated answers.` });
    if (out.length >= limit) return out;
  }
  // Syllabus coverage: unseen syllabus areas.
  const seenSyllabus = new Set(all.filter((q) => done.has(q.id)).flatMap((q) => q.syllabus_codes));
  for (const q of all) {
    if (out.length >= limit) break;
    if (done.has(q.id) || used.has(q.id)) continue;
    if (q.syllabus_codes.some((s) => !seenSyllabus.has(s))) {
      used.add(q.id);
      out.push({ question: q, kind: "coverage", reason: `Covers a syllabus area you have not practised yet.` });
    }
  }
  return out;
}

export interface SkillRow {
  skill_tag: string;
  name: string;
  group: string;
  mastery: number;
  occurrences: number;
  recent: number;
  repair_count: number;
  transfer_success_count: number;
  transfer_attempt_count: number;
  status: SkillStatus;
  status_label: string;
}

export function getProgress(db: DB, userId: string) {
  const states = db
    .prepare(
      `SELECT ss.skill_tag, st.name, st.grp, SUM(ss.alpha) AS alpha, SUM(ss.beta) AS beta, SUM(ss.occurrences) AS occurrences, SUM(ss.repair_count) AS repair_count,
        SUM(ss.transfer_success_count) AS transfer_success_count, SUM(ss.transfer_attempt_count) AS transfer_attempt_count,
        (SELECT last_transfer_result FROM skill_states x WHERE x.user_id = ss.user_id AND x.skill_tag = ss.skill_tag ORDER BY last_updated DESC LIMIT 1) AS last_transfer_result
       FROM skill_states ss JOIN skill_tags st ON st.code = ss.skill_tag WHERE ss.user_id = ? GROUP BY ss.skill_tag`,
    )
    .all(userId) as (SkillState & { skill_tag: string; name: string; grp: string })[];
  const recentAttempts = (db.prepare("SELECT id FROM attempts WHERE user_id = ? AND status = 'evaluated' ORDER BY created_at DESC LIMIT 6").all(userId) as { id: string }[]).map((r) => r.id);
  const recentCounts = new Map<string, number>();
  if (recentAttempts.length) {
    const rows = db
      .prepare(`SELECT skill_tag, COUNT(DISTINCT attempt_id) AS n FROM error_ledger WHERE user_id = ? AND attempt_id IN (${recentAttempts.map(() => "?").join(",")}) GROUP BY skill_tag`)
      .all(userId, ...recentAttempts) as { skill_tag: string; n: number }[];
    for (const r of rows) recentCounts.set(r.skill_tag, r.n);
  }
  const skills: SkillRow[] = states
    .map((s) => {
      const st = skillStatus(s, recentCounts.get(s.skill_tag) ?? 0);
      return {
        skill_tag: s.skill_tag,
        name: s.name,
        group: s.grp,
        mastery: mastery(s),
        occurrences: s.occurrences,
        recent: recentCounts.get(s.skill_tag) ?? 0,
        repair_count: s.repair_count,
        transfer_success_count: s.transfer_success_count,
        transfer_attempt_count: s.transfer_attempt_count,
        status: st,
        status_label: STATUS_LABEL[st],
      };
    })
    .sort((a, b) => a.mastery - b.mastery);

  const timeline = db
    .prepare(
      `SELECT a.id AS attempt_id, a.attempt_kind, a.created_at, q.text AS question_text, p.code AS paper_code, e.point_estimate, e.max_marks, e.confidence, e.result_json, e.provider
       FROM attempts a JOIN evaluations e ON e.attempt_id = a.id AND e.status = 'completed' JOIN questions q ON q.id = a.question_id JOIN papers p ON p.id = q.paper_id
       WHERE a.user_id = ? ORDER BY a.created_at`,
    )
    .all(userId) as {
    attempt_id: string;
    attempt_kind: string;
    created_at: string;
    question_text: string;
    paper_code: string;
    point_estimate: number;
    max_marks: number;
    confidence: string;
    result_json: string;
    provider: string;
  }[];
  const points = timeline.map((t) => {
    const r = parseJson<EvaluationResult | null>(t.result_json, null);
    const gap = r?.self_assessment_gap?.length ? r.self_assessment_gap.reduce((s, g) => s + Math.abs(g.self_band - g.ai_band), 0) / r.self_assessment_gap.length : null;
    return {
      attempt_id: t.attempt_id,
      attempt_kind: t.attempt_kind,
      created_at: t.created_at,
      question_text: t.question_text,
      paper_code: t.paper_code,
      pct: t.max_marks ? t.point_estimate / t.max_marks : 0,
      score: t.point_estimate,
      max: t.max_marks,
      confidence: t.confidence,
      provider: t.provider,
      self_gap: gap,
    };
  });
  const ledger = db
    .prepare(
      `SELECT l.skill_tag, s.name, COUNT(*) AS total, SUM(CASE WHEN l.resolved_in_rewrite = 1 THEN 1 ELSE 0 END) AS repaired,
        SUM(CASE WHEN l.absent_in_transfer = 1 THEN 1 ELSE 0 END) AS transferred, SUM(CASE WHEN l.absent_in_transfer = 0 THEN 1 ELSE 0 END) AS transfer_failed
       FROM error_ledger l JOIN skill_tags s ON s.code = l.skill_tag WHERE l.user_id = ? GROUP BY l.skill_tag ORDER BY total DESC`,
    )
    .all(userId) as { skill_tag: string; name: string; total: number; repaired: number; transferred: number; transfer_failed: number }[];
  return { skills, timeline: points, ledger, retests: dueRetests(db, userId) };
}

export function weeklyReport(db: DB, userId: string, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const prog = getProgress(db, userId);
  const week = prog.timeline.filter((t) => t.created_at >= since);
  const gaps = prog.timeline.map((t) => t.self_gap).filter((g): g is number => g !== null);
  const half = Math.floor(gaps.length / 2);
  const calib =
    gaps.length >= 4
      ? { earlier: gaps.slice(0, half).reduce((a, b) => a + b, 0) / half, recent: gaps.slice(half).reduce((a, b) => a + b, 0) / (gaps.length - half) }
      : null;
  const transfers = db
    .prepare("SELECT r.status, s.name FROM retest_schedule r JOIN skill_tags s ON s.code = r.skill_tag WHERE r.user_id = ? AND r.status IN ('passed','failed') AND r.created_at >= ?")
    .all(userId, since) as { status: string; name: string }[];
  return {
    period: { from: since.slice(0, 10), to: now.toISOString().slice(0, 10) },
    attempts: week.length,
    average_pct: week.length ? week.reduce((s, w) => s + w.pct, 0) / week.length : null,
    improved: prog.skills.filter((s) => s.status === "holds_on_new_questions").map((s) => s.name),
    recurring: prog.skills.filter((s) => s.status === "recurring").map((s) => s.name),
    transfers,
    calibration: calib,
    next_focus: prog.skills.filter((s) => s.occurrences > 0).slice(0, 2).map((s) => s.name),
  };
}

/** Share a summary (never answer text) via an expiring token. */
export function createShareLink(db: DB, userId: string) {
  const token = randomToken(18);
  const report = weeklyReport(db, userId);
  const name = (db.prepare("SELECT display_name FROM users WHERE id = ?").get(userId) as { display_name: string }).display_name;
  db.prepare("INSERT INTO share_links (token_hash, user_id, kind, payload, expires_at, created_at) VALUES (?,?,?,?,?,?)").run(
    sha256Hex(token), userId, "weekly_report", JSON.stringify({ name, report }), new Date(Date.now() + 14 * 86400_000).toISOString(), nowIso(),
  );
  return token;
}

export function readShareLink(db: DB, token: string) {
  const r = db.prepare("SELECT payload, expires_at FROM share_links WHERE token_hash = ?").get(sha256Hex(token)) as { payload: string; expires_at: string } | undefined;
  if (!r || new Date(r.expires_at).getTime() < Date.now()) return null;
  return parseJson<{ name: string; report: ReturnType<typeof weeklyReport> }>(r.payload, null as never);
}
