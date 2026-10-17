import { describe, expect, it } from "vitest";
import { createAttempt, getOwnedAttempt, listAttempts, submitTyped } from "@/lib/services/attempts";
import { latestEvaluation, requestEvaluation } from "@/lib/services/evaluations";
import { runPendingJobs } from "@/lib/services/jobs";
import { getQuestion } from "@/lib/services/questions";
import { purgeStaleGuests, startGuest, trialConfig, trialOverview } from "@/lib/services/trial";
import { signup } from "@/lib/services/users";
import { freshDb } from "../helpers";

const RBI_ANSWER = `Herzberg's two-factor theory separates hygiene factors such as pay, job security and working conditions from motivators such as recognition, responsibility, achievement and growth. Removing dissatisfaction is not the same as motivating people.

In a public sector bank, pay scales are fixed by industry-level settlements, so large pay increases are not available to a branch manager. However, the motivators are largely within the bank's control. Recognition can be made specific and timely, for example by acknowledging an officer who resolves a difficult customer grievance. Responsibility can be widened by giving clerks ownership of a product line such as MSME loans in their branch.

Growth matters as well. Structured training, certification support and transparent rotation give employees a sense of progress, while regular feedback replaces the annual-only appraisal.

Therefore, by fixing hygiene complaints such as workload and digital tools, and investing in motivators, the bank can raise motivation without large pay increases.`;

describe("guest trial (no account)", async () => {
  const { db } = await freshDb();
  const cfg = trialConfig();

  it("offers the configured questions for both UPSC and RBI Grade B", async () => {
    const ex = await trialOverview(db, null);
    expect(ex.length).toBeGreaterThanOrEqual(2);
    for (const e of ex) {
      expect(e.questions.length).toBe((cfg.questions[e.code] ?? []).length);
      expect(e.used).toBe(0);
      expect(e.limit).toBe(cfg.answers_per_exam);
    }
    expect(ex.some((e) => e.stage === "preview")).toBe(true);
  });

  let guestId = "";
  let attemptId = "";
  it("lets a guest answer an RBI trial question and get feedback", async () => {
    const g = await startGuest(db, "203.0.113.5");
    guestId = g.user.id;
    expect(g.user.plan).toBe("guest");
    expect(g.user.email.endsWith(".invalid")).toBe(true);
    const rbi = (await trialOverview(db, g.user)).find((e) => e.stage === "preview")!;
    const q = rbi.questions[1];
    const a = await createAttempt(db, guestId, { question_id: q.id, mode: "typed" });
    attemptId = a.id;
    await submitTyped(db, guestId, a.id, { text: RBI_ANSWER, time_spent_sec: 600 });
    await requestEvaluation(db, guestId, a.id);
    await runPendingJobs(db);
    const ev = (await latestEvaluation(db, a.id))!;
    expect(ev.status).toBe("completed");
    expect(ev.result!.score_kind).toBe("ai_estimate");
    expect(ev.result!.criteria.some((c) => c.code === "PRESENTATION")).toBe(false); // typed RBI rubric
    const after = (await trialOverview(db, g.user)).find((e) => e.code === rbi.code)!;
    expect(after.used).toBe(1);
  });

  it("keeps guests inside the trial set and its limits", async () => {
    const outside = await getQuestion(db, "gs2-ec-independence");
    await expect(createAttempt(db, guestId, { question_id: outside.id, mode: "typed" })).rejects.toThrow(/not part of the free trial/);
    const a = await getOwnedAttempt(db, guestId, attemptId);
    await expect(createAttempt(db, guestId, { question_id: a.question_id, mode: "typed" })).rejects.toThrow(/already tried/);
    const rw = await createAttempt(db, guestId, { question_id: a.question_id, mode: "typed", attempt_kind: "rewrite", parent_attempt_id: attemptId });
    expect(rw.attempt_kind).toBe("rewrite");
    await expect(createAttempt(db, guestId, { question_id: a.question_id, mode: "typed", attempt_kind: "rewrite", parent_attempt_id: attemptId })).rejects.toThrow(/trial rewrite/);
  });

  it("converts the guest into a real account on sign-up and keeps the work", async () => {
    const { user } = await signup(db, { email: "trial-convert@example.com", password: "a long test password", display_name: "Meera" }, "203.0.113.5", guestId);
    expect(user.id).toBe(guestId);
    expect(user.plan).toBe("free");
    expect((await listAttempts(db, user.id)).length).toBe(2);
    // Now a normal account: the full question bank is open.
    const outside = await getQuestion(db, "gs2-ec-independence");
    await expect(createAttempt(db, user.id, { question_id: outside.id, mode: "typed" })).resolves.toBeTruthy();
  });

  it("rate-limits new guests per IP and purges abandoned guests", async () => {
    for (let i = 0; i < cfg.max_new_guests_per_ip_per_day; i++) await startGuest(db, "198.51.100.9");
    await expect(startGuest(db, "198.51.100.9")).rejects.toThrow(/Too many requests/);
    const before = ((await db.get("SELECT COUNT(*) AS n FROM users WHERE plan = 'guest'")) as { n: number }).n;
    expect(before).toBe(cfg.max_new_guests_per_ip_per_day);
    const purged = await purgeStaleGuests(db, Date.now() + (cfg.purge_guests_after_days + 1) * 86400_000);
    expect(purged).toBe(before);
    expect(((await db.get("SELECT COUNT(*) AS n FROM users WHERE plan = 'guest'")) as { n: number }).n).toBe(0);
    // The converted account is untouched.
    expect(await db.get("SELECT plan FROM users WHERE id = ?", guestId)).toEqual({ plan: "free" });
  });
});
