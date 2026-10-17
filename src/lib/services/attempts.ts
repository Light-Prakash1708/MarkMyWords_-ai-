import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "../db";
import { parseJson, toJson } from "../db";
import { getEnv } from "../env";
import { applyDecisions, buildTranscript, type BuiltTranscript, type RegionDecision } from "../ocr";
import { rateLimit } from "../security/rate-limit";
import { scanBuffer } from "../security/scan";
import { validateUpload } from "../security/uploads";
import { AppError, invalid, notFound } from "../util/errors";
import { newId, nowIso, randomToken, sha256Hex } from "../util/ids";
import { normalizeText, wordCount } from "../util/text";
import { getPracticableQuestion, getQuestion } from "./questions";
import { enqueue } from "./jobs";
import { assertGuestMayAttempt, GUEST_PLAN } from "./trial";

export type AttemptStatus = "draft" | "submitted" | "awaiting_transcription" | "awaiting_confirmation" | "ready" | "evaluating" | "evaluated" | "failed";

export interface AttemptRow {
  id: string;
  user_id: string;
  question_id: string;
  mode: "typed" | "handwritten";
  status: AttemptStatus;
  attempt_kind: "first" | "rewrite" | "transfer_retest";
  parent_attempt_id: string | null;
  retest_id: string | null;
  timer_mode: "exam" | "untimed";
  draft_text: string;
  started_at: string;
  submitted_at: string | null;
  time_spent_sec: number | null;
  created_at: string;
}

/** Ownership check on every read (row-level isolation enforced in the service layer). */
export async function getOwnedAttempt(db: DB, userId: string, attemptId: string): Promise<AttemptRow> {
  const a = (await db.get("SELECT * FROM attempts WHERE id = ? AND user_id = ?", attemptId, userId)) as AttemptRow | undefined;
  if (!a) throw notFound("Attempt");
  return a;
}

export const CreateAttemptSchema = z.object({
  question_id: z.string().min(1).max(100),
  mode: z.enum(["typed", "handwritten"]),
  timer_mode: z.enum(["exam", "untimed"]).default("exam"),
  attempt_kind: z.enum(["first", "rewrite", "transfer_retest"]).default("first"),
  parent_attempt_id: z.string().max(100).optional(),
  retest_id: z.string().max(100).optional(),
});

export async function createAttempt(db: DB, userId: string, input: unknown): Promise<AttemptRow> {
  const p = CreateAttemptSchema.safeParse(input);
  if (!p.success) throw invalid("Invalid attempt.", p.error.flatten().fieldErrors);
  (await rateLimit(db, `attempt:create:${userId}`, 60, 3600));
  const q = (await getPracticableQuestion(db, p.data.question_id));
  const owner = (await db.get("SELECT plan FROM users WHERE id = ?", userId)) as { plan: string } | undefined;
  if (owner?.plan === GUEST_PLAN) await assertGuestMayAttempt(db, userId, q, p.data.attempt_kind);
  if (!q.input_modes.includes(p.data.mode)) throw invalid(`${q.exam_name} answers are ${q.input_modes.join(" or ")} only.`);
  let parent: AttemptRow | null = null;
  let draft = "";
  if (p.data.attempt_kind === "rewrite") {
    if (!p.data.parent_attempt_id) throw invalid("A rewrite needs the original attempt.");
    parent = (await getOwnedAttempt(db, userId, p.data.parent_attempt_id));
    if (parent.question_id !== q.id) throw invalid("A rewrite must be for the same question.");
    if (parent.status !== "evaluated") throw new AppError("EVALUATION_REQUIRED", "Get feedback on the original attempt before rewriting.");
    const tr = (await latestTranscript(db, parent.id));
    draft = tr?.text ?? "";
  }
  if (p.data.attempt_kind === "transfer_retest") {
    const rt = (await db.get("SELECT * FROM retest_schedule WHERE id = ? AND user_id = ?", p.data.retest_id ?? "", userId)) as
      | { id: string; question_id: string | null; status: string }
      | undefined;
    if (!rt) throw notFound("Retest");
    if (rt.question_id !== q.id) throw invalid("This retest is for a different question.");
    if (rt.status !== "scheduled" && rt.status !== "in_progress") throw invalid("This retest is already complete.");
    (await db.run("UPDATE retest_schedule SET status = 'in_progress' WHERE id = ?", rt.id));
  }
  const id = newId();
  const t = nowIso();
  (await db.run(`INSERT INTO attempts (id, user_id, question_id, mode, status, attempt_kind, parent_attempt_id, retest_id, timer_mode, draft_text, started_at, created_at, updated_at)
     VALUES (?,?,?,?,'draft',?,?,?,?,?,?,?,?)`, id, userId, q.id, p.data.mode, p.data.attempt_kind, parent?.id ?? null, p.data.retest_id ?? null, p.data.timer_mode, draft, t, t, t));
  return getOwnedAttempt(db, userId, id);
}

export async function saveDraft(db: DB, userId: string, attemptId: string, text: unknown) {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.status !== "draft") throw new AppError("CONFLICT", "This attempt was already submitted.");
  const s = z.string().max(20000).parse(text);
  (await db.run("UPDATE attempts SET draft_text = ?, updated_at = ? WHERE id = ?", normalizeText(s), nowIso(), a.id));
}

export async function latestTranscript(db: DB, attemptId: string) {
  const r = (await db.get("SELECT * FROM transcripts WHERE attempt_id = ? ORDER BY version DESC LIMIT 1", attemptId)) as
    | { id: string; version: number; text: string; source: "typed" | "ocr_confirmed" | "student_transcribed"; uncertain_spans: string; diagrams: string; confirmed_by_student_at: string | null }
    | undefined;
  if (!r) return null;
  return {
    ...r,
    uncertain_spans: parseJson<{ start: number; end: number; reason: string }[]>(r.uncertain_spans, []),
    diagrams: parseJson<{ page: number; description: string; student_caption?: string }[]>(r.diagrams, []),
  };
}

async function insertTranscript(db: DB, attemptId: string, text: string, source: "typed" | "ocr_confirmed" | "student_transcribed", extra: { ocrRunId?: string; uncertain?: unknown[]; diagrams?: unknown[] } = {}) {
  const v = (((await db.get("SELECT MAX(version) AS v FROM transcripts WHERE attempt_id = ?", attemptId)) as { v: number | null }).v ?? 0) + 1;
  (await db.run("INSERT INTO transcripts (id, attempt_id, version, text, source, ocr_run_id, uncertain_spans, diagrams, confirmed_by_student_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", newId(), attemptId, v, text, source, extra.ocrRunId ?? null, toJson(extra.uncertain ?? []), toJson(extra.diagrams ?? []), source === "typed" ? null : nowIso(), nowIso()));
  return v;
}

export const SubmitTypedSchema = z.object({ text: z.string().max(20000), time_spent_sec: z.number().int().min(0).max(36000).optional() });

export async function submitTyped(db: DB, userId: string, attemptId: string, input: unknown): Promise<AttemptRow> {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.mode !== "typed") throw invalid("This attempt is handwritten — upload your pages instead.");
  if (a.status !== "draft") throw new AppError("CONFLICT", "This attempt was already submitted.");
  const p = SubmitTypedSchema.safeParse(input);
  if (!p.success) throw invalid("Invalid submission.");
  const text = normalizeText(p.data.text).trim();
  if (wordCount(text) < 15) throw invalid("Write at least a few sentences (15+ words) before submitting.");
  const t = nowIso();
  await db.transaction(async (db) => {
    (await insertTranscript(db, a.id, text, "typed"));
    (await db.run("UPDATE attempts SET status = 'ready', draft_text = ?, submitted_at = ?, time_spent_sec = ?, updated_at = ? WHERE id = ?", text, t, p.data.time_spent_sec ?? null, t, a.id));
  });
  return getOwnedAttempt(db, userId, a.id);
}

// ---------------- Handwritten ----------------

export async function addUpload(db: DB, userId: string, attemptId: string, buf: Buffer) {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.mode !== "handwritten") throw invalid("This is a typed attempt.");
  if (a.status !== "draft") throw new AppError("CONFLICT", "Pages can only be added before you submit.");
  (await rateLimit(db, `upload:${userId}`, 40, 3600));
  const existing = (await db.get("SELECT COALESCE(SUM(page_count),0) AS n, COUNT(*) AS files FROM uploads WHERE attempt_id = ?", a.id)) as { n: number; files: number };
  const v = await validateUpload(buf, existing.n);
  const scan = await scanBuffer(v.buffer);
  if (scan.status === "infected") throw new AppError("UPLOAD_REJECTED", "This file was flagged by the malware scanner.");
  // Bytes live in the database (re-encoded, metadata stripped), so uploads work on read-only /
  // serverless filesystems. storage_key stays as an opaque per-user label.
  const key = `${userId}/${randomToken(18)}${v.kind === "pdf" ? ".pdf" : ".jpg"}`;
  const id = newId();
  (await db.run(`INSERT INTO uploads (id, attempt_id, user_id, storage_key, data, original_mime, stored_mime, bytes, sha256, page_index, page_count, validation_status, scan_status, exif_stripped, quality, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'accepted',?,?,?,?)`, id, a.id, userId, key, v.buffer, v.originalMime, v.storedMime, v.buffer.length, sha256Hex(v.buffer), existing.files, v.pageCount, scan.status,
    v.kind === "image" ? 1 : 0, v.kind === "image" ? toJson(v.quality) : null, nowIso()));
  return { id, page_index: existing.files, page_count: v.pageCount, quality: v.kind === "image" ? v.quality : null, scan_status: scan.status };
}

export async function listUploads(db: DB, userId: string, attemptId: string) {
  (await getOwnedAttempt(db, userId, attemptId));
  return ((await db.all("SELECT id, stored_mime, page_index, page_count, quality, scan_status FROM uploads WHERE attempt_id = ? ORDER BY page_index", attemptId)) as {
    id: string;
    stored_mime: string;
    page_index: number;
    page_count: number;
    quality: string | null;
    scan_status: string;
  }[]).map((u) => ({ ...u, quality: parseJson(u.quality, null) }));
}

export async function removeUpload(db: DB, userId: string, attemptId: string, uploadId: string) {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.status !== "draft") throw new AppError("CONFLICT", "Pages can only be removed before you submit.");
  const u = (await db.get("SELECT id FROM uploads WHERE id = ? AND attempt_id = ?", uploadId, a.id)) as { id: string } | undefined;
  if (!u) throw notFound("Page");
  await db.transaction(async (db) => {
    await db.run("DELETE FROM uploads WHERE id = ?", uploadId);
    const rest = (await db.all("SELECT id FROM uploads WHERE attempt_id = ? ORDER BY page_index", a.id)) as { id: string }[];
    for (const [i, r] of rest.entries()) await db.run("UPDATE uploads SET page_index = ? WHERE id = ?", i, r.id);
  });
}

export async function reorderUploads(db: DB, userId: string, attemptId: string, order: unknown) {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.status !== "draft") throw new AppError("CONFLICT", "Pages can only be reordered before you submit.");
  const ids = z.array(z.string()).max(20).parse(order);
  const current = ((await db.all("SELECT id FROM uploads WHERE attempt_id = ?", a.id)) as { id: string }[]).map((r) => r.id);
  if (ids.length !== current.length || !ids.every((i) => current.includes(i))) throw invalid("Order must list every page exactly once.");
  await db.transaction(async (db) => {
    for (const [i, id] of ids.entries()) await db.run("UPDATE uploads SET page_index = ? WHERE id = ? AND attempt_id = ?", i, id, a.id);
  });
}

/** Owner (or audited reviewer) can read an upload's bytes. */
export async function readUpload(db: DB, viewer: { id: string; role: string }, uploadId: string): Promise<{ buf: Buffer; mime: string }> {
  const u = (await db.get("SELECT user_id, data, stored_mime, attempt_id FROM uploads WHERE id = ?", uploadId)) as { user_id: string; data: Buffer | null; stored_mime: string; attempt_id: string } | undefined;
  if (!u) throw notFound("Upload");
  if (u.user_id !== viewer.id) {
    if (viewer.role !== "admin" && viewer.role !== "reviewer") throw notFound("Upload");
    (await db.run("INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)", newId(), viewer.id, "read_upload", "upload", uploadId, "dispute review", nowIso()));
  }
  if (!u.data) throw notFound("Upload");
  return { buf: Buffer.from(u.data), mime: u.stored_mime };
}

export async function submitHandwritten(db: DB, userId: string, attemptId: string, input: unknown): Promise<AttemptRow> {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.mode !== "handwritten") throw invalid("This is a typed attempt.");
  if (a.status !== "draft") throw new AppError("CONFLICT", "This attempt was already submitted.");
  const pages = ((await db.get("SELECT COUNT(*) AS n FROM uploads WHERE attempt_id = ?", a.id)) as { n: number }).n;
  if (pages === 0) throw invalid("Upload at least one page of your answer.");
  const p = z.object({ time_spent_sec: z.number().int().min(0).max(36000).optional() }).parse(input ?? {});
  const t = nowIso();
  (await db.run("UPDATE attempts SET status = 'awaiting_transcription', submitted_at = ?, time_spent_sec = ?, updated_at = ? WHERE id = ?", t, p.time_spent_sec ?? null, t, a.id));
  if (getEnv().ocrProvider !== "manual") {
    (await enqueue(db, "ocr", { attempt_id: a.id, user_id: userId }));
  }
  return getOwnedAttempt(db, userId, a.id);
}

/** Manual transcription path (no OCR provider): the student types what they wrote. */
export async function submitManualTranscript(db: DB, userId: string, attemptId: string, input: unknown): Promise<AttemptRow> {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.mode !== "handwritten" || (a.status !== "awaiting_transcription" && a.status !== "awaiting_confirmation")) {
    throw new AppError("CONFLICT", "This attempt is not waiting for a transcript.");
  }
  const p = z.object({ text: z.string().max(20000), diagrams: z.array(z.string().max(300)).max(6).default([]) }).parse(input);
  const text = normalizeText(p.text).trim();
  if (wordCount(text) < 15) throw invalid("Type out what you wrote (15+ words).");
  await db.transaction(async (db) => {
    (await insertTranscript(db, a.id, text, "student_transcribed", { diagrams: p.diagrams.map((d) => ({ page: 0, description: d, student_caption: d })) }));
    (await db.run("UPDATE attempts SET status = 'ready', updated_at = ? WHERE id = ?", nowIso(), a.id));
  });
  return getOwnedAttempt(db, userId, a.id);
}

export async function latestOcr(db: DB, attemptId: string): Promise<{ id: string; status: string; built: BuiltTranscript | null; error: string | null } | null> {
  const r = (await db.get("SELECT id, status, pages, error FROM ocr_runs WHERE attempt_id = ? ORDER BY created_at DESC LIMIT 1", attemptId)) as
    | { id: string; status: string; pages: string; error: string | null }
    | undefined;
  if (!r) return null;
  return { id: r.id, status: r.status, built: parseJson<BuiltTranscript | null>(r.pages, null), error: r.error };
}

export async function confirmTranscript(db: DB, userId: string, attemptId: string, input: unknown): Promise<AttemptRow> {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.status !== "awaiting_confirmation") throw new AppError("CONFLICT", "Nothing to confirm for this attempt.");
  const ocr = (await latestOcr(db, a.id));
  if (!ocr?.built) throw new AppError("CONFLICT", "Transcription is not ready yet.");
  const decisions = z
    .object({
      decisions: z.array(z.object({ region_id: z.string(), action: z.enum(["confirm", "correct", "leave_uncertain"]), text: z.string().max(400).optional() })).max(400),
      diagram_captions: z.array(z.string().max(300)).max(6).optional(),
    })
    .parse(input);
  const res = applyDecisions(ocr.built, decisions.decisions as RegionDecision[]);
  if (!res.ok) throw new AppError("VALIDATION", "Please confirm, correct or mark every highlighted line before continuing.", { details: { missing: res.missing } });
  const diagrams = ocr.built.diagrams.map((d, i) => ({ ...d, student_caption: decisions.diagram_captions?.[i] }));
  await db.transaction(async (db) => {
    (await insertTranscript(db, a.id, normalizeText(res.text), "ocr_confirmed", { ocrRunId: ocr.id, uncertain: res.uncertain, diagrams }));
    (await db.run("UPDATE attempts SET status = 'ready', updated_at = ? WHERE id = ?", nowIso(), a.id));
  });
  return getOwnedAttempt(db, userId, a.id);
}

export const SelfAssessmentSchema = z.object({
  ratings: z.array(z.object({ criterion_code: z.string().max(40), band: z.number().int().min(0).max(10) })).max(12),
  confidence: z.enum(["low", "medium", "high"]),
});

export async function saveSelfAssessment(db: DB, userId: string, attemptId: string, input: unknown) {
  const a = (await getOwnedAttempt(db, userId, attemptId));
  if (a.status === "evaluated" || a.status === "evaluating") throw new AppError("CONFLICT", "Self-assessment must be done before seeing feedback.");
  if (!a.submitted_at) throw new AppError("ATTEMPT_REQUIRED", "Submit your answer first.");
  const p = SelfAssessmentSchema.parse(input);
  (await db.run(`INSERT INTO self_assessments (id, attempt_id, ratings, confidence, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(attempt_id) DO UPDATE SET ratings = excluded.ratings, confidence = excluded.confidence`, newId(), a.id, toJson(p.ratings), p.confidence, nowIso()));
}

export async function getSelfAssessment(db: DB, attemptId: string) {
  const r = (await db.get("SELECT ratings, confidence FROM self_assessments WHERE attempt_id = ?", attemptId)) as { ratings: string; confidence: string } | undefined;
  return r ? { ratings: parseJson<{ criterion_code: string; band: number }[]>(r.ratings, []), confidence: r.confidence } : null;
}

export async function listAttempts(db: DB, userId: string, limit = 50) {
  return (await db.all(`SELECT a.id, a.status, a.mode, a.attempt_kind, a.created_at, a.submitted_at, q.id AS question_id, q.text AS question_text, p.code AS paper_code,
        (SELECT point_estimate FROM evaluations e WHERE e.attempt_id = a.id AND e.status = 'completed' ORDER BY created_at DESC LIMIT 1) AS score,
        (SELECT max_marks FROM evaluations e WHERE e.attempt_id = a.id AND e.status = 'completed' ORDER BY created_at DESC LIMIT 1) AS max_marks
       FROM attempts a JOIN questions q ON q.id = a.question_id JOIN papers p ON p.id = q.paper_id
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT ?`, userId, limit)) as {
    id: string;
    status: AttemptStatus;
    mode: string;
    attempt_kind: string;
    created_at: string;
    submitted_at: string | null;
    question_id: string;
    question_text: string;
    paper_code: string;
    score: number | null;
    max_marks: number | null;
  }[];
}

export function questionForAttempt(db: DB, a: AttemptRow) {
  return getQuestion(db, a.question_id);
}
