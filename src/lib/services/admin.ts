import { z } from "zod";
import type { DB } from "../db";
import { parseJson, toJson } from "../db";
import type { SessionUser } from "../auth/session";
import { findBanned } from "../copy/banned";
import { getEnv } from "../env";
import { getProvider } from "../llm";
import { assertSpendCapNotReached, recordCost, spendToday } from "../llm/cost";
import type { EvaluationResult } from "../schemas/evaluation";
import { AppError, invalid, notFound } from "../util/errors";
import { newId, nowIso } from "../util/ids";
import { jaccard } from "../util/text";
import { getQuestion, listAllQuestionsForReview } from "./questions";

export function requireStaff(user: SessionUser | null): SessionUser {
  if (!user) throw new AppError("UNAUTHENTICATED", "Log in first.");
  if (user.role !== "admin" && user.role !== "reviewer") throw new AppError("FORBIDDEN", "Reviewer access required.");
  return user;
}
export function requireAdmin(user: SessionUser | null): SessionUser {
  const u = requireStaff(user);
  if (u.role !== "admin") throw new AppError("FORBIDDEN", "Admin access required.");
  return u;
}

async function audit(db: DB, actor: string, action: string, targetType: string, targetId: string | null, reason: string | null) {
  (await db.run("INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)", newId(), actor, action, targetType, targetId, reason, nowIso()));
}

// ---------------- Question review ----------------

export async function reviewQueue(db: DB) {
  const qs = await listAllQuestionsForReview(db);
  const out = [];
  for (const q of qs) out.push({ ...q, checks: await automatedQuestionChecks(db, q.id) });
  return out;
}

/** Automated checks run before any human review: banned phrasing, duplicates, syllabus fit, config fit. */
export async function automatedQuestionChecks(db: DB, questionId: string) {
  const q = (await getQuestion(db, questionId));
  const issues: string[] = [];
  const banned = findBanned([q.text, ...q.priority_reasons].join(" "));
  if (banned.length) issues.push(`Banned phrasing: ${banned.join(", ")}`);
  if (/\b(will (?:come|appear)|expected (?:in|this year))\b/i.test(q.priority_reasons.join(" "))) issues.push("Priority reasons imply a prediction.");
  const others = (await db.all("SELECT id, text FROM questions WHERE id != ? AND review_status != 'retired'", q.id)) as { id: string; text: string }[];
  const dup = others.map((o) => ({ id: o.id, sim: jaccard(o.text, q.text) })).sort((a, b) => b.sim - a.sim)[0];
  if (dup && dup.sim >= 0.6) issues.push(`Possible duplicate of question ${dup.id} (similarity ${dup.sim.toFixed(2)}).`);
  if (!q.syllabus_codes.length) issues.push("Not mapped to any syllabus node.");
  if (!q.parts.length) issues.push("No question parts defined.");
  if (q.parts.some((p) => p.cues.length === 0)) issues.push("Some parts have no cue words (rule-based checks will be weaker).");
  return { ok: issues.length === 0, issues, nearest_duplicate: dup ?? null };
}

export async function reviewQuestion(db: DB, actor: SessionUser, questionId: string, input: unknown) {
  const p = z
    .object({
      decision: z.enum(["approve", "reject", "retire", "reopen"]),
      note: z.string().max(500).optional(),
      edits: z.object({ text: z.string().min(20).max(2000).optional(), priority_reasons: z.array(z.string().max(200)).max(5).optional() }).optional(),
    })
    .parse(input);
  const q = (await getQuestion(db, questionId));
  if (p.edits?.text || p.edits?.priority_reasons) {
    (await db.run("UPDATE questions SET text = COALESCE(?, text), priority_reasons = COALESCE(?, priority_reasons), version = version + 1, updated_at = ? WHERE id = ?", p.edits.text ?? null, p.edits.priority_reasons ? toJson(p.edits.priority_reasons) : null, nowIso(), q.id));
  }
  const status = { approve: "approved", reject: "draft", retire: "retired", reopen: "pending_human" }[p.decision];
  if (p.decision === "approve") {
    const checks = (await automatedQuestionChecks(db, q.id));
    if (checks.issues.some((i) => i.startsWith("Banned"))) throw invalid("Fix the flagged phrasing before approving.");
  }
  (await db.run("UPDATE questions SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_checks = ?, updated_at = ? WHERE id = ?", status, actor.id, nowIso(), toJson({ note: p.note ?? null }), nowIso(), q.id));
  (await audit(db, actor.id, `question_${p.decision}`, "question", q.id, p.note ?? null));
}

// ---------------- Question generation from a source (QOTD pipeline) ----------------

const GeneratedQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string().min(30).max(600),
        question_type: z.string(),
        directive_codes: z.array(z.string()).min(1).max(2),
        syllabus_codes: z.array(z.string()).min(1).max(3),
        parts: z.array(z.object({ id: z.string(), demand: z.string().max(200), cues: z.array(z.string().max(40)).max(8) })).min(1).max(4),
        dimensions_expected: z.array(z.string()).max(5),
        priority_reasons: z.array(z.string().max(200)).min(1).max(3),
        skill_tags_targeted: z.array(z.string()).max(3),
      }),
    )
    .min(1)
    .max(4),
});

export async function generateQuestionsFromSource(db: DB, actor: SessionUser, input: unknown) {
  const p = z.object({ source_id: z.string(), paper_code: z.string(), count: z.number().int().min(1).max(4).default(2) }).parse(input);
  const provider = getProvider();
  if (!provider) throw new AppError("PROVIDER_UNAVAILABLE", "Question generation needs an AI provider (set ANTHROPIC_API_KEY). You can still add questions as JSON in content/questions.");
  (await assertSpendCapNotReached(db));
  const src = (await db.get("SELECT id, title, url FROM sources WHERE id = ?", p.source_id)) as { id: string; title: string; url: string } | undefined;
  if (!src) throw notFound("Source");
  const chunks = ((await db.all("SELECT text FROM source_chunks WHERE source_id = ? ORDER BY ordinal", src.id)) as { text: string }[]).map((c) => c.text).join("\n");
  const paper = (await db.get("SELECT p.id, p.code, p.name, e.code AS exam_code FROM papers p JOIN exams e ON e.id = p.exam_id WHERE p.code = ?", p.paper_code)) as
    | { id: string; code: string; name: string; exam_code: string }
    | undefined;
  if (!paper) throw notFound("Paper");
  const qts = (await db.all("SELECT id, code, marks, word_limit FROM question_types WHERE paper_id = ?", paper.id)) as { id: string; code: string; marks: number; word_limit: number | null }[];
  const syl = (await db.all("SELECT code, title FROM syllabus_nodes WHERE paper_id = ?", paper.id)) as { code: string; title: string }[];
  const dirs = (await db.all("SELECT code, label FROM directives")) as { code: string; label: string }[];
  const skills = ((await db.all("SELECT code FROM skill_tags")) as { code: string }[]).map((s) => s.code);
  const jsonSchema = z.toJSONSchema(GeneratedQuestionsSchema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const res = await provider.structured({
    task: "question_generation",
    model: getEnv().judgeModel,
    system:
      "You draft practice questions for a specific exam paper from a source document. Questions must fit the paper's syllabus and format, test analysis rather than recall, and use varied directive words. Priority reasons explain why the topic matters (syllabus centrality, related past themes, current relevance) — never predict that it will appear in the exam. Drafts go to a human reviewer.",
    content: [
      {
        type: "text",
        text: [
          `PAPER: ${paper.code} — ${paper.name} (exam ${paper.exam_code})`,
          `QUESTION TYPES: ${qts.map((q) => `${q.code} (${q.marks} marks, ${q.word_limit ?? "no"} words)`).join("; ")}`,
          `SYLLABUS NODES: ${syl.map((s) => `${s.code}: ${s.title}`).join("; ")}`,
          `DIRECTIVES: ${dirs.map((d) => d.code).join(", ")}`,
          `SKILL TAGS: ${skills.join(", ")}`,
          `DIMENSIONS: constitutional, legal, economic, social, environmental, international, governance, technological, security`,
          `SOURCE: ${src.title} (${src.url})`,
          chunks,
          `Draft ${p.count} distinct questions.`,
        ].join("\n"),
      },
    ],
    schema: GeneratedQuestionsSchema,
    jsonSchema,
    toolName: "submit_questions",
    toolDescription: "Submit draft questions for human review.",
    maxTokens: 3000,
    temperature: 0.6,
  });
  (await recordCost(db, { userId: actor.id, operation: "question_generation", provider: provider.name, model: res.model, usage: res.usage }));
  const created: { id: string; checks: Awaited<ReturnType<typeof automatedQuestionChecks>> }[] = [];
  const t = nowIso();
  for (const g of res.output.questions) {
    const qt = qts.find((x) => x.code === g.question_type) ?? qts[0];
    const sylCodes = g.syllabus_codes.filter((c) => syl.some((s) => s.code === c));
    const dirCodes = g.directive_codes.filter((c) => dirs.some((d) => d.code === c));
    if (!sylCodes.length || !dirCodes.length) continue;
    const id = newId();
    (await db.run(`INSERT INTO questions (id, slug, paper_id, question_type_id, text, parts, directive_codes, syllabus_codes, dimensions_expected, origin, priority_reasons, skill_tags_targeted, review_status, dossier_policy, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'ca_generated',?,?,'pending_human','pre_attempt_allowed',?,?,?)`, id, `gen-${id.slice(0, 8)}`, paper.id, qt.id, g.text, toJson(g.parts), toJson(dirCodes), toJson(sylCodes), toJson(g.dimensions_expected),
      toJson(g.priority_reasons), toJson(g.skill_tags_targeted.filter((s) => skills.includes(s))), actor.id, t, t));
    (await db.run("INSERT OR IGNORE INTO question_sources (question_id, source_id, relation) VALUES (?,?,'fact_basis')", id, src.id));
    const checks = (await automatedQuestionChecks(db, id));
    (await db.run("UPDATE questions SET review_checks = ? WHERE id = ?", toJson(checks), id));
    created.push({ id, checks });
  }
  (await audit(db, actor.id, "questions_generated", "source", src.id, `${created.length} drafts`));
  return created;
}

// ---------------- Disputes ----------------

export async function listDisputes(db: DB) {
  return (await db.all(`SELECT d.*, u.display_name AS student_name, e.attempt_id FROM disputes d JOIN users u ON u.id = d.user_id JOIN evaluations e ON e.id = d.evaluation_id
       ORDER BY CASE d.status WHEN 'open' THEN 0 ELSE 1 END, d.created_at DESC LIMIT 200`)) as { id: string; evaluation_id: string; comment_id: string | null; reason: string; status: string; resolution: string | null; student_name: string; attempt_id: string; created_at: string }[];
}

/** Reading student content for a dispute is audited. */
export async function disputeDetail(db: DB, actor: SessionUser, disputeId: string) {
  const d = (await db.get("SELECT * FROM disputes WHERE id = ?", disputeId)) as { id: string; evaluation_id: string; comment_id: string | null; reason: string; status: string } | undefined;
  if (!d) throw notFound("Dispute");
  const ev = (await db.get("SELECT attempt_id, result_json FROM evaluations WHERE id = ?", d.evaluation_id)) as { attempt_id: string; result_json: string };
  const tr = (await db.get("SELECT text FROM transcripts WHERE attempt_id = ? ORDER BY version DESC LIMIT 1", ev.attempt_id)) as { text: string } | undefined;
  const q = (await db.get("SELECT q.text FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.id = ?", ev.attempt_id)) as { text: string };
  (await audit(db, actor.id, "read_student_answer", "dispute", d.id, "dispute review"));
  const result = parseJson<EvaluationResult | null>(ev.result_json, null);
  return { dispute: d, question: q.text, answer: tr?.text ?? "", comment: result?.comments.find((c) => c.id === d.comment_id) ?? null, result };
}

export async function resolveDispute(db: DB, actor: SessionUser, disputeId: string, input: unknown) {
  const p = z.object({ status: z.enum(["upheld", "overturned", "partially_upheld"]), resolution: z.string().trim().min(5).max(1000) }).parse(input);
  const d = (await db.get("SELECT evaluation_id FROM disputes WHERE id = ?", disputeId)) as { evaluation_id: string } | undefined;
  if (!d) throw notFound("Dispute");
  (await db.run("UPDATE disputes SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", p.status, p.resolution, actor.id, nowIso(), disputeId));
  const open = (await db.get("SELECT 1 FROM disputes WHERE evaluation_id = ? AND status = 'open'", d.evaluation_id));
  if (!open) (await db.run("UPDATE evaluations SET human_review_status = 'reviewed' WHERE id = ?", d.evaluation_id));
  (await audit(db, actor.id, `dispute_${p.status}`, "dispute", disputeId, null));
}

// ---------------- Costs & quality ----------------

function percentile(xs: number[], p: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export async function costDashboard(db: DB) {
  const evs = ((await db.all("SELECT est_cost_inr, provider FROM evaluations WHERE status = 'completed'")) as { est_cost_inr: number; provider: string }[]);
  const ai = evs.filter((e) => e.provider === "anthropic" || e.provider === "gemini").map((e) => e.est_cost_inr);
  const byOp = (await db.all("SELECT operation, COUNT(*) AS n, SUM(est_cost_inr) AS inr, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout FROM cost_ledger GROUP BY operation")) as {
    operation: string;
    n: number;
    inr: number;
    tin: number;
    tout: number;
  }[];
  const disputes = (await db.all("SELECT status, COUNT(*) AS n FROM disputes GROUP BY status")) as { status: string; n: number }[];
  const env = getEnv();
  return {
    today_inr: (await spendToday(db)),
    cap_inr: env.dailySpendCapInr,
    evaluations_total: evs.length,
    evaluations_ai: ai.length,
    per_eval_p50: percentile(ai, 50),
    per_eval_p95: percentile(ai, 95),
    by_operation: byOp,
    disputes,
    pricing_note: "Costs use MMW_PRICE_* placeholders — set them from your provider's current price list.",
  };
}

// ---------------- Rubric versions ----------------

export async function listRubricVersions(db: DB) {
  return (await db.all(`SELECT rv.id, r.code, rv.version, rv.status, rv.calibration_report_id, rv.activated_at, rv.created_at,
        (SELECT human_reviewed_cases FROM calibration_reports c WHERE c.id = rv.calibration_report_id) AS human_cases
       FROM rubric_versions rv JOIN rubrics r ON r.id = rv.rubric_id ORDER BY r.code, rv.created_at DESC`)) as { id: string; code: string; version: string; status: string; calibration_report_id: string | null; activated_at: string | null; human_cases: number | null }[];
}

export const MIN_HUMAN_CASES_FOR_ACTIVATION = 50;

export async function attachCalibrationReport(db: DB, actor: SessionUser, rubricVersionId: string, report: unknown, humanReviewedCases: number) {
  requireAdmin(actor);
  const id = newId();
  (await db.run("INSERT INTO calibration_reports (id, rubric_version_id, report, human_reviewed_cases, created_by, created_at) VALUES (?,?,?,?,?,?)", id, rubricVersionId, toJson(report), humanReviewedCases, actor.id, nowIso()));
  (await db.run("UPDATE rubric_versions SET calibration_report_id = ?, updated_at = ? WHERE id = ?", id, nowIso(), rubricVersionId));
  (await audit(db, actor.id, "calibration_report_attached", "rubric_version", rubricVersionId, `${humanReviewedCases} human-reviewed cases`));
  return id;
}

/** A rubric version becomes active only with a calibration report on enough human-reviewed cases. */
export async function activateRubricVersion(db: DB, actor: SessionUser, rubricVersionId: string) {
  requireAdmin(actor);
  const rv = (await db.get("SELECT rv.id, rv.rubric_id, rv.calibration_report_id, c.human_reviewed_cases FROM rubric_versions rv LEFT JOIN calibration_reports c ON c.id = rv.calibration_report_id WHERE rv.id = ?", rubricVersionId)) as
    | { id: string; rubric_id: string; calibration_report_id: string | null; human_reviewed_cases: number | null }
    | undefined;
  if (!rv) throw notFound("Rubric version");
  if (!rv.calibration_report_id) throw invalid("Attach a calibration report before activating this rubric version.");
  if ((rv.human_reviewed_cases ?? 0) < MIN_HUMAN_CASES_FOR_ACTIVATION) {
    throw invalid(`The calibration report covers ${rv.human_reviewed_cases ?? 0} human-reviewed cases; at least ${MIN_HUMAN_CASES_FOR_ACTIVATION} are required.`);
  }
  await db.transaction(async (db) => {
    (await db.run("UPDATE rubric_versions SET status = 'retired', updated_at = ? WHERE rubric_id = ? AND status = 'active'", nowIso(), rv.rubric_id));
    (await db.run("UPDATE rubric_versions SET status = 'active', activated_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), rv.id));
  });
  (await audit(db, actor.id, "rubric_activated", "rubric_version", rv.id, null));
}

export async function listSources(db: DB) {
  return (await db.all("SELECT id, slug, title, publisher, url, text_kind, verification_status, published_on, stale_after_days FROM sources ORDER BY title")) as {
    id: string;
    slug: string;
    title: string;
    publisher: string;
    url: string;
    text_kind: string;
    verification_status: string;
    published_on: string | null;
    stale_after_days: number | null;
  }[];
}

export async function markSourceVerified(db: DB, actor: SessionUser, sourceId: string, input: unknown) {
  const p = z.object({ verified: z.boolean(), url: z.string().url().optional(), note: z.string().max(300).optional() }).parse(input);
  (await db.run("UPDATE sources SET verification_status = ?, verified_by = ?, url = COALESCE(?, url), updated_at = ? WHERE id = ?", p.verified ? "verified" : "unverified", p.verified ? actor.id : null, p.url ?? null, nowIso(), sourceId));
  (await audit(db, actor.id, p.verified ? "source_verified" : "source_unverified", "source", sourceId, p.note ?? null));
}

export async function auditLog(db: DB, limit = 100) {
  return (await db.all("SELECT a.*, u.display_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT ?", limit)) as {
    id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    reason: string | null;
    actor_name: string | null;
    created_at: string;
  }[];
}
