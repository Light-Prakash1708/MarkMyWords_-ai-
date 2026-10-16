import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { addUpload, confirmTranscript, createAttempt, getOwnedAttempt, latestOcr, latestTranscript, submitHandwritten, submitTyped } from "@/lib/services/attempts";
import { latestEvaluation, requestEvaluation } from "@/lib/services/evaluations";
import { runPendingJobs } from "@/lib/services/jobs";
import { getQuestion } from "@/lib/services/questions";
import { deleteAccount, exportUserData, getConsents, setConsent } from "@/lib/services/users";
import { freshDb, makeUser } from "../helpers";

const sheet = () =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="100%" height="100%" fill="#f5f2ea"/><text x="50" y="120" font-size="38">Answer sheet</text></svg>`)).jpeg().toBuffer();

describe("handwritten flow with uncertain OCR", async () => {
  process.env.MMW_OCR_PROVIDER = "mock";
  const { db } = freshDb();
  const u = await makeUser(db);
  const q = getQuestion(db, "gs3-monetary-transmission");
  const a = createAttempt(db, u.id, { question_id: q.id, mode: "handwritten" });

  it("requires pages before submission and stores them privately", async () => {
    expect(() => submitHandwritten(db, u.id, a.id, {})).toThrow(/at least one page/);
    const up = await addUpload(db, u.id, a.id, await sheet());
    const row = db.prepare("SELECT storage_key, exif_stripped FROM uploads WHERE id = ?").get(up.id) as { storage_key: string; exif_stripped: number };
    expect(row.exif_stripped).toBe(1);
    expect(row.storage_key.startsWith(u.id + "/")).toBe(true);
    expect(fs.statSync(path.join(process.env.MMW_UPLOAD_DIR!, row.storage_key)).mode & 0o077).toBe(0);
  });

  it("transcribes, then blocks evaluation until every uncertain line is resolved", async () => {
    submitHandwritten(db, u.id, a.id, {});
    await runPendingJobs(db);
    expect(getOwnedAttempt(db, u.id, a.id).status).toBe("awaiting_confirmation");
    expect(() => requestEvaluation(db, u.id, a.id)).toThrow(/Confirm your transcript/);
    expect(() => confirmTranscript(db, u.id, a.id, { decisions: [] })).toThrow(/every highlighted line/);
    const built = latestOcr(db, a.id)!.built!;
    const unc = built.regions.filter((r) => r.flag !== "ok");
    confirmTranscript(db, u.id, a.id, { decisions: unc.map((r) => ({ region_id: r.id, action: "leave_uncertain" })) });
    const tr = latestTranscript(db, a.id)!;
    expect(tr.source).toBe("ocr_confirmed");
    expect(tr.uncertain_spans.length).toBe(unc.length);
  });

  it("evaluates handwritten answers with presentation enabled and uncertain-region comments flagged", async () => {
    requestEvaluation(db, u.id, a.id);
    await runPendingJobs(db);
    const r = latestEvaluation(db, a.id)!.result!;
    expect(r.criteria.some((c) => c.code === "PRESENTATION")).toBe(true);
    expect(r.total.confidence_reasons).toContain("ocr_uncertain_spans");
    const tr = latestTranscript(db, a.id)!;
    for (const c of r.comments) {
      if (c.evidence.answer_spans.some((s) => tr.uncertain_spans.some((u2) => s.start < u2.end && u2.start < s.end))) expect(c.uncertain).toBe(true);
    }
  });
});

describe("privacy: consent, export and hard delete", async () => {
  const { db } = freshDb();
  const u = await makeUser(db);
  it("consents default to off and can be toggled", () => {
    expect(getConsents(db, u.id).every((c) => c.granted === 0)).toBe(true);
    setConsent(db, u.id, "benchmark_use", true);
    expect(getConsents(db, u.id).find((c) => c.purpose === "benchmark_use")!.granted).toBe(1);
    setConsent(db, u.id, "benchmark_use", false);
    expect(getConsents(db, u.id).find((c) => c.purpose === "benchmark_use")!.revoked_at).toBeTruthy();
  });
  it("exports and then hard-deletes everything including files", async () => {
    const q = getQuestion(db, "gs2-rti-accountability");
    const a = createAttempt(db, u.id, { question_id: q.id, mode: "typed" });
    submitTyped(db, u.id, a.id, { text: "The RTI Act lets citizens ask public authorities for information, which improves accountability. However, pendency limits it. Overall it is effective." });
    const hw = createAttempt(db, u.id, { question_id: q.id, mode: "handwritten" });
    await addUpload(db, u.id, hw.id, await sheet());
    const dump = exportUserData(db, u.id);
    expect(dump.attempts.length).toBe(2);
    expect(JSON.stringify(dump)).not.toContain("password_hash");
    expect(() => deleteAccount(db, u.id, "wrong@example.com")).toThrow(/Type your email/);
    deleteAccount(db, u.id, (dump.user as { email: string }).email);
    expect(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?").get(u.id)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?").get(u.id)).toEqual({ n: 0 });
    expect(fs.existsSync(path.join(process.env.MMW_UPLOAD_DIR!, u.id))).toBe(false);
  });
});
