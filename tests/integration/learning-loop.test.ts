import { describe, expect, it } from "vitest";
import { createAttempt, submitTyped, saveSelfAssessment } from "@/lib/services/attempts";
import { createDispute, latestEvaluation, requestEvaluation } from "@/lib/services/evaluations";
import { getLadder, revealRung } from "@/lib/services/hints";
import { runPendingJobs } from "@/lib/services/jobs";
import { assertAttemptedBefore, getDossier, getQuestion } from "@/lib/services/questions";
import { getProgress, recommendNext } from "@/lib/services/skills";
import { baseAnswers, freshDb, joinParas, makeUser } from "../helpers";

describe("full learning loop: attempt → diagnose → repair → transfer", async () => {
  const { db } = (await freshDb());
  const u = await makeUser(db, "Asha");
  const b02 = baseAnswers().find((b) => b.id === "b02")!;
  const q = (await getQuestion(db, b02.question_slug));

  it("P1: guidance is locked before an attempt", async () => {
    await expect((async () => assertAttemptedBefore(db, u.id, q.id))()).rejects.toThrow(/submit your own answer/i);
    expect((await getDossier(db, u.id, q.id)).locked).toBe(false); // this question allows a pre-attempt background dossier
    const locked = (await getQuestion(db, "gs3-inflation-targeting"));
    expect((await getDossier(db, u.id, locked.id)).locked).toBe(true);
  });

  let attemptId = "";
  it("submits, self-assesses and evaluates a weak typed answer", async () => {
    const a = (await createAttempt(db, u.id, { question_id: q.id, mode: "typed" }));
    attemptId = a.id;
    await expect(revealRung(db, u.id, a.id, { rung: 0 })).rejects.toThrow(/submit your own answer/i);
    (await submitTyped(db, u.id, a.id, { text: joinParas(b02.paragraphs), time_spent_sec: 400 }));
    (await saveSelfAssessment(db, u.id, a.id, { ratings: [{ criterion_code: "ANALYSIS", band: 4 }, { criterion_code: "EVIDENCE", band: 3 }], confidence: "high" }));
    (await requestEvaluation(db, u.id, a.id));
    await runPendingJobs(db);
    const ev = (await latestEvaluation(db, a.id))!;
    expect(ev.status).toBe("completed");
    const r = ev.result!;
    expect(r.score_kind).toBe("ai_estimate");
    expect(r.self_assessment_gap?.length).toBe(2);
    expect(r.top_priorities.length).toBeGreaterThan(0);
    expect((await db.get("SELECT COUNT(*) AS n FROM error_ledger WHERE user_id = ?", u.id))).toMatchObject({ n: expect.any(Number) });
    expect(((await db.get("SELECT COUNT(*) AS n FROM retest_schedule WHERE user_id = ?", u.id)) as { n: number }).n).toBeGreaterThan(0);
  });

  it("P1 now satisfied; hint ladder opens in order and blocks skipping", async () => {
    await assertAttemptedBefore(db, u.id, q.id); // resolves without throwing
    await expect(revealRung(db, u.id, attemptId, { rung: 2 })).rejects.toThrow(/first/);
    await revealRung(db, u.id, attemptId, { rung: 0 });
    const h1 = await revealRung(db, u.id, attemptId, { rung: 1 });
    expect((h1.content as { hints: unknown[] }).hints.length).toBeGreaterThan(0);
    await expect(revealRung(db, u.id, attemptId, { rung: 5, confirm: true })).rejects.toThrow();
    await revealRung(db, u.id, attemptId, { rung: 2 });
    await revealRung(db, u.id, attemptId, { rung: 3 });
    await expect(revealRung(db, u.id, attemptId, { rung: 5 })).rejects.toThrow(/Confirm/);
    const r5 = await revealRung(db, u.id, attemptId, { rung: 5, confirm: true });
    expect((r5.content as { unavailable?: boolean }).unavailable).toBe(true); // no AI provider: never fabricated
    expect((await db.get("SELECT 1 FROM audit_log WHERE action = 'full_sample_revealed' AND target_id = ?", attemptId))).toBeTruthy();
    expect((await getLadder(db, u.id, attemptId)).state.maxRungRevealed).toBe(5);
  });

  it("a rewrite produces a rewrite delta and records repair", async () => {
    const b01 = baseAnswers().find((b) => b.id === "b01")!;
    const rw = (await createAttempt(db, u.id, { question_id: q.id, mode: "typed", attempt_kind: "rewrite", parent_attempt_id: attemptId }));
    expect(rw.draft_text.length).toBeGreaterThan(10); // prefilled with the original
    (await submitTyped(db, u.id, rw.id, { text: joinParas(b01.paragraphs) }));
    (await requestEvaluation(db, u.id, rw.id));
    await runPendingJobs(db);
    const r = (await latestEvaluation(db, rw.id))!.result!;
    expect(r.rewrite_delta && r.rewrite_delta.length).toBeGreaterThan(0);
    expect(r.rewrite_delta!.some((d) => d.status === "resolved")).toBe(true);
    const repaired = (await db.get("SELECT COUNT(*) AS n FROM error_ledger WHERE attempt_id = ? AND resolved_in_rewrite = 1", attemptId)) as { n: number };
    expect(repaired.n).toBeGreaterThan(0);
  });

  it("a due transfer retest updates transfer counters", async () => {
    (await db.run("UPDATE retest_schedule SET due_at = ? WHERE user_id = ?", new Date(Date.now() - 1000).toISOString(), u.id));
    const rec = (await recommendNext(db, u.id)).find((r) => r.kind === "retest")!;
    expect(rec).toBeTruthy();
    const t = (await createAttempt(db, u.id, { question_id: rec.question.id, mode: "typed", attempt_kind: "transfer_retest", retest_id: rec.retest_id }));
    const strong = baseAnswers().find((b) => b.question_slug === rec.question.slug);
    (await submitTyped(db, u.id, t.id, { text: strong ? joinParas(strong.paragraphs) : "This is a reasonably developed answer about the question. Because institutions matter, outcomes follow. However, limits remain. Therefore reforms are needed going forward." }));
    (await requestEvaluation(db, u.id, t.id));
    await runPendingJobs(db);
    const row = (await db.get("SELECT status FROM retest_schedule WHERE id = ?", rec.retest_id)) as { status: string };
    expect(["passed", "failed"]).toContain(row.status);
    const prog = (await getProgress(db, u.id));
    expect(prog.skills.some((s) => s.transfer_attempt_count > 0)).toBe(true);
  });

  it("disputes go to the review queue", async () => {
    const ev = (await latestEvaluation(db, attemptId))!;
    (await createDispute(db, u.id, ev.id, { comment_id: ev.result!.comments[0].id, reason: "My second paragraph does explain this." }));
    expect(((await db.get("SELECT human_review_status FROM evaluations WHERE id = ?", ev.id)) as { human_review_status: string }).human_review_status).toBe("queued");
  });
});
