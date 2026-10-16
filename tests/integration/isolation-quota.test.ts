import sharp from "sharp";
import { describe, expect, it, afterEach } from "vitest";
import { setProviderOverride } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import type { LlmProvider } from "@/lib/llm/types";
import { addUpload, createAttempt, getOwnedAttempt, readUpload, submitTyped } from "@/lib/services/attempts";
import { createDispute, getEvaluationForUser, latestEvaluation, requestEvaluation } from "@/lib/services/evaluations";
import { getLadder } from "@/lib/services/hints";
import { runPendingJobs } from "@/lib/services/jobs";
import { getQuestion } from "@/lib/services/questions";
import { activateRubricVersion, attachCalibrationReport, requireAdmin } from "@/lib/services/admin";
import { newId, nowIso } from "@/lib/util/ids";
import { freshDb, makeUser } from "../helpers";

const TEXT = "Monetary transmission is slow because banks reprice deposits only as they mature. However, external benchmarks helped. Therefore deposit reforms are the way forward for faster transmission.";

describe("row-level isolation between students", async () => {
  const { db } = freshDb();
  const a = await makeUser(db, "A");
  const b = await makeUser(db, "B");
  const q = getQuestion(db, "gs3-monetary-transmission");
  const att = createAttempt(db, a.id, { question_id: q.id, mode: "typed" });
  submitTyped(db, a.id, att.id, { text: TEXT });
  requestEvaluation(db, a.id, att.id);
  await runPendingJobs(db);
  const ev = latestEvaluation(db, att.id)!;
  it("B cannot read A's attempt, evaluation, ladder or dispute A's evaluation", () => {
    expect(() => getOwnedAttempt(db, b.id, att.id)).toThrow(/not found/);
    expect(() => getEvaluationForUser(db, b.id, att.id)).toThrow(/not found/);
    expect(() => getLadder(db, b.id, att.id)).toThrow(/not found/);
    expect(() => createDispute(db, b.id, ev.id, { reason: "not mine but trying" })).toThrow(/not found/);
    expect(() => submitTyped(db, b.id, att.id, { text: TEXT })).toThrow(/not found/);
  });
  it("B cannot read A's uploaded page; a reviewer read is audited", async () => {
    const hw = createAttempt(db, a.id, { question_id: q.id, mode: "handwritten" });
    const img = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#f0ede4" } }).jpeg().toBuffer();
    const up = await addUpload(db, a.id, hw.id, img);
    expect(() => readUpload(db, { id: b.id, role: "student" }, up.id)).toThrow(/not found/);
    expect(readUpload(db, { id: a.id, role: "student" }, up.id).buf.length).toBeGreaterThan(100);
    readUpload(db, { id: b.id, role: "reviewer" }, up.id);
    expect(db.prepare("SELECT 1 FROM audit_log WHERE action = 'read_upload' AND target_id = ?").get(up.id)).toBeTruthy();
  });
});

describe("quotas, spend cap and rubric activation", async () => {
  afterEach(() => setProviderOverride(undefined));
  const { db } = freshDb();
  const u = await makeUser(db);
  const q = getQuestion(db, "gs3-monetary-transmission");
  const fakeAnthropic = (): LlmProvider => {
    const m = new MockProvider({ judge: () => ({ criteria: [], parts: [], directives: [], comments: [], factual_checks: [], next_action_instruction: "x" }) });
    return { name: "anthropic", structured: m.structured.bind(m) } as LlmProvider;
  };
  it("blocks AI evaluations beyond the daily quota", () => {
    process.env.MMW_FREE_EVALS_PER_DAY = "1";
    setProviderOverride(fakeAnthropic());
    const a1 = createAttempt(db, u.id, { question_id: q.id, mode: "typed" });
    submitTyped(db, u.id, a1.id, { text: TEXT });
    requestEvaluation(db, u.id, a1.id);
    const a2 = createAttempt(db, u.id, { question_id: q.id, mode: "typed" });
    submitTyped(db, u.id, a2.id, { text: TEXT });
    expect(() => requestEvaluation(db, u.id, a2.id)).toThrow(/today's 1 AI evaluations/);
    delete process.env.MMW_FREE_EVALS_PER_DAY;
  });
  it("trips the global spend cap", () => {
    setProviderOverride(fakeAnthropic());
    db.prepare("INSERT INTO cost_ledger (id, user_id, operation, provider, model_id, est_cost_inr, created_at) VALUES (?,?,?,?,?,?,?)").run(newId(), null, "evaluation", "anthropic", "m", 1e6, nowIso());
    const u2 = createAttempt(db, u.id, { question_id: q.id, mode: "typed" });
    submitTyped(db, u.id, u2.id, { text: TEXT });
    process.env.MMW_FREE_EVALS_PER_DAY = "100";
    expect(() => requestEvaluation(db, u.id, u2.id)).toThrow(/high demand/);
    delete process.env.MMW_FREE_EVALS_PER_DAY;
  });
  it("refuses to activate a rubric without enough human-reviewed calibration", () => {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
    const admin = requireAdmin({ ...u, role: "admin" });
    const rv = db.prepare("SELECT id FROM rubric_versions LIMIT 1").get() as { id: string };
    expect(() => activateRubricVersion(db, admin, rv.id)).toThrow(/calibration report/);
    attachCalibrationReport(db, admin, rv.id, { note: "pilot" }, 12);
    expect(() => activateRubricVersion(db, admin, rv.id)).toThrow(/at least 50/);
    attachCalibrationReport(db, admin, rv.id, { note: "full" }, 60);
    activateRubricVersion(db, admin, rv.id);
    expect((db.prepare("SELECT status FROM rubric_versions WHERE id = ?").get(rv.id) as { status: string }).status).toBe("active");
  });
});
