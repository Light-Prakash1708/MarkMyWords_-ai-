import type { DB } from "../db";
import { parseJson } from "../db";
import { getEnv } from "../env";
import type { QuestionPart } from "../exam-config";
import { sourceDossier } from "../sources";
import { AppError, notFound } from "../util/errors";
import { istDate, newId, nowIso } from "../util/ids";

export interface QuestionView {
  id: string;
  slug: string;
  text: string;
  parts: QuestionPart[];
  directive_codes: string[];
  syllabus_codes: string[];
  dimensions_expected: string[];
  priority_reasons: string[];
  skill_tags_targeted: string[];
  review_status: "draft" | "pending_human" | "approved" | "retired";
  reviewed_by: string | null;
  dossier_policy: "pre_attempt_allowed" | "post_attempt_only";
  origin: string;
  version: number;
  paper_code: string;
  paper_name: string;
  exam_code: string;
  exam_name: string;
  exam_status: string;
  exam_stage: "live" | "preview";
  exam_short_name: string;
  question_type_code: string;
  marks: number;
  word_limit: number | null;
  time_budget_min: number;
  word_tolerance_pct: number;
  default_input_mode: "typed" | "handwritten";
  input_modes: ("typed" | "handwritten")[];
  ux: { show_handwriting_upload: boolean; show_presentation_feedback: boolean; show_typing_speed: boolean; editor_style: string };
}

const SELECT = `SELECT q.*, p.code AS paper_code, p.name AS paper_name, p.default_input_mode, e.code AS exam_code, e.name AS exam_name,
  e.status AS exam_status, e.stage AS exam_stage, e.short_name AS exam_short_name, e.input_modes, e.ux, qt.code AS question_type_code, qt.marks, qt.word_limit, qt.time_budget_min, qt.word_tolerance_pct
  FROM questions q JOIN papers p ON p.id = q.paper_id JOIN exams e ON e.id = p.exam_id JOIN question_types qt ON qt.id = q.question_type_id`;

type Row = Record<string, unknown> & { parts: string; directive_codes: string; syllabus_codes: string; dimensions_expected: string; priority_reasons: string; skill_tags_targeted: string; input_modes: string; ux: string };

function toView(r: Row): QuestionView {
  return {
    ...(r as unknown as QuestionView),
    parts: parseJson(r.parts, []),
    directive_codes: parseJson(r.directive_codes, []),
    syllabus_codes: parseJson(r.syllabus_codes, []),
    dimensions_expected: parseJson(r.dimensions_expected, []),
    priority_reasons: parseJson(r.priority_reasons, []),
    skill_tags_targeted: parseJson(r.skill_tags_targeted, []),
    input_modes: parseJson(r.input_modes, ["typed"]),
    ux: parseJson(r.ux, { show_handwriting_upload: false, show_presentation_feedback: false, show_typing_speed: false, editor_style: "ruled_sheet" }),
  };
}

/** Which review statuses students may practise. In demo mode, pending questions are shown with a badge. */
export function practisableStatuses(): string[] {
  return getEnv().demoMode ? ["approved", "pending_human"] : ["approved"];
}

export async function listQuestions(db: DB, opts: { examCode?: string | null; paperCode?: string; includeAll?: boolean } = {}): Promise<QuestionView[]> {
  const where: string[] = ["e.status = 'active'", "p.status = 'active'"];
  const args: unknown[] = [];
  if (!opts.includeAll) where.push(`q.review_status IN (${practisableStatuses().map(() => "?").join(",")})`), args.push(...practisableStatuses());
  if (opts.examCode) where.push("e.code = ?"), args.push(opts.examCode);
  if (opts.paperCode) where.push("p.code = ?"), args.push(opts.paperCode);
  return ((await db.all(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY p.code, q.created_at`, ...args)) as Row[]).map(toView);
}

export async function listAllQuestionsForReview(db: DB): Promise<QuestionView[]> {
  return ((await db.all(`${SELECT} ORDER BY CASE q.review_status WHEN 'pending_human' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, q.created_at DESC`)) as Row[]).map(toView);
}

export async function getQuestion(db: DB, id: string): Promise<QuestionView> {
  const r = (await db.get(`${SELECT} WHERE q.id = ? OR q.slug = ?`, id, id)) as Row | undefined;
  if (!r) throw notFound("Question");
  return toView(r);
}

export async function getPracticableQuestion(db: DB, id: string): Promise<QuestionView> {
  const q = (await getQuestion(db, id));
  if (!practisableStatuses().includes(q.review_status) || q.exam_status !== "active") throw notFound("Question");
  return q;
}

export async function hasSubmittedAttempt(db: DB, userId: string, questionId: string): Promise<boolean> {
  return !!(await db.get("SELECT 1 FROM attempts WHERE user_id = ? AND question_id = ? AND submitted_at IS NOT NULL LIMIT 1", userId, questionId));
}

/**
 * P1: no model answer / outline / exemplar before the student's own submitted attempt.
 * Throws ATTEMPT_REQUIRED (HTTP 403).
 */
export async function assertAttemptedBefore(db: DB, userId: string, questionId: string): Promise<void> {
  if (!(await hasSubmittedAttempt(db, userId, questionId))) {
    throw new AppError("ATTEMPT_REQUIRED", "Write and submit your own answer first. Guidance unlocks after your attempt.");
  }
}

export async function getDossier(db: DB, userId: string, questionId: string) {
  const q = (await getQuestion(db, questionId));
  const attempted = (await hasSubmittedAttempt(db, userId, q.id));
  if (q.dossier_policy === "post_attempt_only" && !attempted) return { locked: true as const, items: [] };
  return { locked: false as const, items: (await sourceDossier(db, q.id)) };
}

/** Question of the day: the scheduled one, else a deterministic pick (approved first; pending in demo mode). */
export async function getQotd(db: DB, examCode: string | null, date = istDate()): Promise<QuestionView | null> {
  const exam = examCode ?? ((await db.get("SELECT code FROM exams WHERE status='active' ORDER BY code LIMIT 1")) as { code: string } | undefined)?.code;
  if (!exam) return null;
  const sched = (await db.get("SELECT question_id FROM qotd WHERE date = ? AND exam_code = ?", date, exam)) as { question_id: string } | undefined;
  if (sched) return getQuestion(db, sched.question_id);
  const approved = (await listQuestions(db, { examCode: exam })).filter((q) => q.review_status === "approved");
  const pool = approved.length ? approved : (await listQuestions(db, { examCode: exam }));
  if (!pool.length) return null;
  let h = 0;
  for (const ch of `${date}:${exam}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

export async function scheduleQotd(db: DB, adminId: string, examCode: string, date: string, questionId: string) {
  const q = (await getQuestion(db, questionId));
  if (q.review_status !== "approved") throw new AppError("VALIDATION", "Only human-approved questions can be scheduled as the question of the day.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("VALIDATION", "Date must be YYYY-MM-DD.");
  (await db.run(`INSERT INTO qotd (id, date, exam_code, question_id, approved_by, published_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(date, exam_code) DO UPDATE SET question_id = excluded.question_id, approved_by = excluded.approved_by, published_at = excluded.published_at`, newId(), date, examCode, q.id, adminId, nowIso()));
}

export async function paperSummaries(db: DB, examCode: string | null) {
  return (await db.all(`SELECT p.code, p.name, p.subtitle, p.total_marks, p.duration_min, p.verification_status, p.fact_source_url, p.verified_on, p.status AS paper_status, e.code AS exam_code, e.status AS exam_status, e.stage AS exam_stage, e.short_name
       FROM papers p JOIN exams e ON e.id = p.exam_id ${examCode ? "WHERE e.code = ?" : ""} ORDER BY e.status, p.code`, ...(examCode ? [examCode] : []))) as {
    code: string;
    name: string;
    subtitle: string | null;
    total_marks: number | null;
    duration_min: number | null;
    verification_status: string;
    fact_source_url: string;
    verified_on: string;
    paper_status: string;
    exam_code: string;
    exam_status: string;
    exam_stage: string;
    short_name: string;
  }[];
}

export async function listExams(db: DB) {
  return (await db.all("SELECT code, name, short_name, status, stage, input_modes FROM exams ORDER BY status, stage, code")) as {
    code: string;
    name: string;
    short_name: string;
    status: string;
    stage: string;
    input_modes: string;
  }[];
}

export async function syllabusTitles(db: DB, codes: string[]): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const rows = (await db.all(`SELECT code, title FROM syllabus_nodes WHERE code IN (${codes.map(() => "?").join(",")})`, ...codes)) as { code: string; title: string }[];
  return Object.fromEntries(rows.map((r) => [r.code, r.title]));
}

export async function directivesFor(db: DB, codes: string[]) {
  if (!codes.length) return [];
  return ((await db.all(`SELECT * FROM directives WHERE code IN (${codes.map(() => "?").join(",")})`, ...codes)) as {
    code: string;
    label: string;
    demand: string;
    expected_moves: string;
  }[]).map((d) => ({ ...d, expected_moves: parseJson<string[]>(d.expected_moves, []) }));
}
