import { z } from "zod";
import type { DB } from "../db";
import { parseJson, toJson } from "../db";
import { getEnv } from "../env";
import { evaluateAnswer } from "../eval-engine";
import { HeuristicJudge } from "../eval-engine/judges/heuristic";
import { LlmJudge } from "../eval-engine/judges/llm";
import { getProvider, providerLabel } from "../llm";
import { assertSpendCapNotReached, recordCost } from "../llm/cost";
import type { RubricCriterion, RubricVersion } from "../schemas/rubric";
import { ENGINE_VERSION, EvaluationResultSchema, type EvaluationInput, type EvaluationResult } from "../schemas/evaluation";
import { rateLimit } from "../security/rate-limit";
import { allHeuristicChecks, retrieveForQuestion } from "../sources";
import { AppError, notFound } from "../util/errors";
import { istDayStartIso, newId, nowIso, traceId } from "../util/ids";
import { wordCount } from "../util/text";
import { getOwnedAttempt, getSelfAssessment, latestTranscript, type AttemptRow } from "./attempts";
import { enqueue } from "./jobs";
import { directivesFor, getQuestion, type QuestionView } from "./questions";
import { applyEvaluationToSkills } from "./skills";

export interface RubricVersionRow {
  id: string;
  rubric_code: string;
  version: string;
  status: "draft" | "calibrating" | "active" | "retired";
  max_band: number;
  disclaimer: string;
  criteria: RubricCriterion[];
  calibration_report_id: string | null;
}

/** Pick the rubric for a question: active version preferred, else the newest calibrating one. */
export function rubricForQuestion(db: DB, q: QuestionView): RubricVersionRow {
  const rows = db
    .prepare(
      `SELECT rv.*, r.code AS rubric_code, r.paper_codes FROM rubric_versions rv JOIN rubrics r ON r.id = rv.rubric_id
       WHERE r.exam_code = ? AND r.question_type_code = ? AND rv.status IN ('active','calibrating')
       ORDER BY CASE rv.status WHEN 'active' THEN 0 ELSE 1 END, rv.created_at DESC`,
    )
    .all(q.exam_code, q.question_type_code) as (Omit<RubricVersionRow, "criteria"> & { criteria: string; paper_codes: string })[];
  const row = rows.find((r) => parseJson<string[]>(r.paper_codes, []).includes(q.paper_code));
  if (!row) throw new AppError("INTERNAL", `No rubric configured for ${q.exam_code}/${q.paper_code}/${q.question_type_code}`);
  return { ...row, criteria: parseJson(row.criteria, []) };
}

export function getRubricVersion(db: DB, id: string): RubricVersionRow {
  const row = db.prepare(`SELECT rv.*, r.code AS rubric_code FROM rubric_versions rv JOIN rubrics r ON r.id = rv.rubric_id WHERE rv.id = ?`).get(id) as
    | (Omit<RubricVersionRow, "criteria"> & { criteria: string })
    | undefined;
  if (!row) throw notFound("Rubric version");
  return { ...row, criteria: parseJson(row.criteria, []) };
}

export function enabledCriteria(rv: RubricVersionRow, mode: "typed" | "handwritten") {
  return rv.criteria.filter((c) => c.input_modes.includes(mode));
}

export function requestEvaluation(db: DB, userId: string, attemptId: string) {
  const a = getOwnedAttempt(db, userId, attemptId);
  if (!a.submitted_at) throw new AppError("ATTEMPT_REQUIRED", "Submit your answer first.");
  if (a.status === "evaluating" || a.status === "evaluated") {
    const ev = latestEvaluation(db, a.id);
    if (ev) return ev;
  }
  if (a.status !== "ready") throw new AppError("CONFLICT", "Confirm your transcript before evaluation.");
  const env = getEnv();
  const provider = getProvider();
  rateLimit(db, `evaluate:burst:${userId}`, 20, 3600);
  if (provider?.name === "anthropic") {
    const used = (db.prepare(
      "SELECT COUNT(*) AS n FROM evaluations e JOIN attempts a ON a.id = e.attempt_id WHERE a.user_id = ? AND e.provider = 'anthropic' AND e.created_at >= ?",
    ).get(userId, istDayStartIso()) as { n: number }).n;
    if (used >= env.freeEvalsPerDay) {
      throw new AppError("QUOTA_EXCEEDED", `You have used today's ${env.freeEvalsPerDay} AI evaluations. Your answer is saved — evaluate it tomorrow.`);
    }
    assertSpendCapNotReached(db);
  }
  const q = getQuestion(db, a.question_id);
  const rv = rubricForQuestion(db, q);
  const tr = latestTranscript(db, a.id);
  if (!tr) throw new AppError("CONFLICT", "No transcript found for this attempt.");
  const label = providerLabel(provider);
  const id = newId();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO evaluations (id, attempt_id, transcript_version, rubric_version_id, engine_version, prompt_version, provider, status, trace_id, max_marks, created_at)
       VALUES (?,?,?,?,?,?,?,'queued',?,?,?)`,
    ).run(id, a.id, tr.version, rv.id, ENGINE_VERSION, "pending", label.provider, traceId(), q.marks, nowIso());
    db.prepare("UPDATE attempts SET status = 'evaluating', updated_at = ? WHERE id = ?").run(nowIso(), a.id);
  })();
  enqueue(db, "evaluate", { evaluation_id: id });
  return latestEvaluation(db, a.id)!;
}

export function buildEvaluationInput(db: DB, a: AttemptRow, rubricVersionId: string, samples = getEnv().evalSamples): EvaluationInput {
  const q = getQuestion(db, a.question_id);
  const rv = getRubricVersion(db, rubricVersionId);
  const tr = latestTranscript(db, a.id);
  if (!tr) throw new Error("No transcript");
  const directives = directivesFor(db, q.directive_codes);
  const retrieved = retrieveForQuestion(db, q.id, `${q.text} ${q.parts.map((p) => p.demand).join(" ")} ${tr.text.slice(0, 1500)}`);
  let prior: EvaluationInput["context"]["prior_evaluation_summary"] = null;
  if (a.attempt_kind === "rewrite" && a.parent_attempt_id) {
    const pe = latestEvaluation(db, a.parent_attempt_id);
    if (pe?.result) {
      prior = {
        comments: pe.result.comments
          .filter((c) => c.kind !== "strength" && !c.uncertain)
          .map((c) => ({ id: c.id, skill_tag: c.skill_tag, severity: c.severity, message: c.message, kind: c.kind })),
      };
    }
  }
  const sa = getSelfAssessment(db, a.id);
  const skillTags = (db.prepare("SELECT code FROM skill_tags ORDER BY code").all() as { code: string }[]).map((r) => r.code);
  const rubric: RubricVersion = {
    id: rv.id,
    rubric_code: rv.rubric_code,
    version: rv.version,
    status: rv.status,
    max_band: rv.max_band,
    disclaimer: rv.disclaimer,
    criteria: rv.criteria,
  };
  const examRow = db.prepare("SELECT config_version FROM exams WHERE code = ?").get(q.exam_code) as { config_version: string };
  return {
    attempt_id: a.id,
    exam: { code: q.exam_code, config_version: examRow.config_version },
    paper: { code: q.paper_code, name: q.paper_name },
    question: {
      id: q.id,
      version: q.version,
      text: q.text,
      parts: q.parts,
      directive_codes: q.directive_codes,
      directives,
      marks: q.marks,
      word_limit: q.word_limit,
      word_tolerance_pct: q.word_tolerance_pct,
      syllabus_codes: q.syllabus_codes,
      dimensions_expected: q.dimensions_expected,
    },
    rubric_version: rubric,
    transcript: {
      version: tr.version,
      text: tr.text,
      source: tr.source,
      input_mode: a.mode,
      uncertain_spans: tr.uncertain_spans,
      diagrams: tr.diagrams.map((d) => ({ page: d.page, description: d.description, student_caption: d.student_caption })),
      word_count: wordCount(tr.text),
    },
    context: {
      retrieved_sources: retrieved,
      heuristic_checks: [],
      time_spent_sec: a.time_spent_sec,
      timer_mode: a.timer_mode,
      attempt_kind: a.attempt_kind,
      prior_evaluation_summary: prior,
      skill_tags: skillTags,
      self_assessment: sa?.ratings ?? null,
    },
    engine: { engine_version: ENGINE_VERSION, prompt_version: "pending", samples },
  };
}

export async function runEvaluationJob(db: DB, evaluationId: string) {
  const ev = db.prepare("SELECT * FROM evaluations WHERE id = ?").get(evaluationId) as
    | { id: string; attempt_id: string; status: string; rubric_version_id: string; trace_id: string }
    | undefined;
  if (!ev || ev.status === "completed") return;
  const a = db.prepare("SELECT * FROM attempts WHERE id = ?").get(ev.attempt_id) as AttemptRow;
  db.prepare("UPDATE evaluations SET status = 'running' WHERE id = ?").run(ev.id);
  const provider = getProvider();
  const label = providerLabel(provider);
  if (provider?.name === "anthropic") assertSpendCapNotReached(db);
  const input = buildEvaluationInput(db, a, ev.rubric_version_id);
  const judge = provider ? new LlmJudge(provider) : new HeuristicJudge();
  input.engine.prompt_version = judge.promptVersion;
  const run = await evaluateAnswer(input, judge, {
    patternChecks: allHeuristicChecks(db),
    isAi: label.isAi,
    providerName: label.provider,
    providerLabel: label.label,
  });
  const parsed = EvaluationResultSchema.safeParse(run.result);
  if (!parsed.success) throw Object.assign(new Error(`Result failed schema validation: ${parsed.error.message.slice(0, 300)}`), { permanent: false });
  const cost = recordCost(db, {
    userId: a.user_id,
    operation: "evaluation",
    provider: label.provider,
    model: run.models.join(",") || "rules-v1",
    usage: run.usage,
    traceId: ev.trace_id,
  });
  const r = run.result;
  if (run.violations.length) {
    r.diagnostics.validator_notes.push(...run.violations.slice(0, 10).map((v) => `post-check ${v.rule}: ${v.where} — ${v.detail}`));
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE evaluations SET status = 'completed', result_json = ?, point_estimate = ?, max_marks = ?, confidence = ?, model_ids = ?, prompt_version = ?,
       est_cost_inr = ?, completed_at = ? WHERE id = ?`,
    ).run(toJson(r), r.total.point_estimate, r.total.max, r.total.confidence, toJson(run.models), judge.promptVersion, cost, nowIso(), ev.id);
    db.prepare("DELETE FROM evaluation_comments WHERE evaluation_id = ?").run(ev.id);
    db.prepare("DELETE FROM citations WHERE evaluation_id = ?").run(ev.id);
    for (const c of r.comments) {
      const s = c.evidence.answer_spans[0];
      db.prepare(
        "INSERT INTO evaluation_comments (id, evaluation_id, comment_id, criterion_code, skill_tag, kind, severity, span_start, span_end, uncertain) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(newId(), ev.id, c.id, c.criterion_code, c.skill_tag, c.kind, c.severity, s?.start ?? null, s?.end ?? null, c.uncertain ? 1 : 0);
      for (const ci of c.evidence.citations) {
        db.prepare("INSERT INTO citations (id, evaluation_id, comment_id, source_chunk_id, quote, verified, verification_method) VALUES (?,?,?,?,?,1,'exact_substring')").run(
          newId(), ev.id, c.id, ci.source_chunk_id, ci.quote,
        );
      }
    }
    for (const fc of r.factual_checks) {
      for (const ci of fc.citations) {
        db.prepare("INSERT INTO citations (id, evaluation_id, comment_id, source_chunk_id, quote, verified, verification_method) VALUES (?,?,?,?,?,1,'exact_substring')").run(
          newId(), ev.id, null, ci.source_chunk_id, ci.quote,
        );
      }
    }
    db.prepare("UPDATE attempts SET status = 'evaluated', updated_at = ? WHERE id = ?").run(nowIso(), a.id);
    applyEvaluationToSkills(db, a, ev.id, r);
  })();
}

export function markEvaluationFailed(db: DB, evaluationId: string, message: string) {
  const ev = db.prepare("SELECT attempt_id FROM evaluations WHERE id = ?").get(evaluationId) as { attempt_id: string } | undefined;
  if (!ev) return;
  db.prepare("UPDATE evaluations SET status = 'failed', error = ? WHERE id = ?").run(message.slice(0, 500), evaluationId);
  db.prepare("UPDATE attempts SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'evaluating'").run(nowIso(), ev.attempt_id);
}

export interface EvaluationView {
  id: string;
  attempt_id: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
  created_at: string;
  completed_at: string | null;
  result: EvaluationResult | null;
  human_review_status: string;
}

export function latestEvaluation(db: DB, attemptId: string): EvaluationView | null {
  const r = db
    .prepare("SELECT id, attempt_id, status, error, created_at, completed_at, result_json, human_review_status FROM evaluations WHERE attempt_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(attemptId) as (Omit<EvaluationView, "result"> & { result_json: string | null }) | undefined;
  if (!r) return null;
  const { result_json, ...rest } = r;
  return { ...rest, result: parseJson<EvaluationResult | null>(result_json, null) };
}

export function getEvaluationForUser(db: DB, userId: string, attemptId: string) {
  getOwnedAttempt(db, userId, attemptId);
  return latestEvaluation(db, attemptId);
}

export function createDispute(db: DB, userId: string, evaluationId: string, input: unknown) {
  const p = z.object({ comment_id: z.string().max(20).nullable().optional(), reason: z.string().trim().min(5).max(1000) }).parse(input);
  const ev = db
    .prepare("SELECT e.id, e.result_json FROM evaluations e JOIN attempts a ON a.id = e.attempt_id WHERE e.id = ? AND a.user_id = ?")
    .get(evaluationId, userId) as { id: string; result_json: string | null } | undefined;
  if (!ev) throw notFound("Evaluation");
  if (p.comment_id) {
    const res = parseJson<EvaluationResult | null>(ev.result_json, null);
    if (!res?.comments.some((c) => c.id === p.comment_id)) throw notFound("Comment");
  }
  rateLimit(db, `dispute:${userId}`, 20, 86400);
  const id = newId();
  db.prepare("INSERT INTO disputes (id, evaluation_id, comment_id, user_id, reason, status, created_at) VALUES (?,?,?,?,?,'open',?)").run(
    id, ev.id, p.comment_id ?? null, userId, p.reason, nowIso(),
  );
  db.prepare("UPDATE evaluations SET human_review_status = 'queued' WHERE id = ?").run(ev.id);
  return { id };
}

export function listDisputesForUser(db: DB, userId: string, evaluationId: string) {
  return db.prepare("SELECT id, comment_id, reason, status, resolution, created_at FROM disputes WHERE user_id = ? AND evaluation_id = ? ORDER BY created_at").all(userId, evaluationId) as {
    id: string;
    comment_id: string | null;
    reason: string;
    status: string;
    resolution: string | null;
    created_at: string;
  }[];
}
