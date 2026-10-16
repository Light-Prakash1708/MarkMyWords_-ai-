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
  const { db } = (await freshDb());
  const u = await makeUser(db);
  const q = (await getQuestion(db, "gs3-monetary-transmission"));
  const a = (await createAttempt(db, u.id, { question_id: q.id, mode: "handwritten" }));

  it("requires pages before submission and stores them privately", async () => {
    await expect((async () => submitHandwritten(db, u.id, a.id, {}))()).rejects.toThrow(/at least one page/);
    const up = await addUpload(db, u.id, a.id, await sheet());
    const row = (await db.get("SELECT storage_key, exif_stripped, data, bytes FROM uploads WHERE id = ?", up.id)) as { storage_key: string; exif_stripped: number; data: Buffer; bytes: number };
    expect(row.exif_stripped).toBe(1);
    expect(row.storage_key.startsWith(u.id + "/")).toBe(true);
    // Re-encoded bytes are stored with the row (no world-readable files on disk).
    expect(Buffer.isBuffer(row.data)).toBe(true);
    expect(row.data.length).toBe(row.bytes);
    expect(row.data.subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  it("transcribes, then blocks evaluation until every uncertain line is resolved", async () => {
    (await submitHandwritten(db, u.id, a.id, {}));
    await runPendingJobs(db);
    expect((await getOwnedAttempt(db, u.id, a.id)).status).toBe("awaiting_confirmation");
    await expect((async () => requestEvaluation(db, u.id, a.id))()).rejects.toThrow(/Confirm your transcript/);
    await expect((async () => confirmTranscript(db, u.id, a.id, { decisions: [] }))()).rejects.toThrow(/every highlighted line/);
    const built = (await latestOcr(db, a.id))!.built!;
    const unc = built.regions.filter((r) => r.flag !== "ok");
    (await confirmTranscript(db, u.id, a.id, { decisions: unc.map((r) => ({ region_id: r.id, action: "leave_uncertain" })) }));
    const tr = (await latestTranscript(db, a.id))!;
    expect(tr.source).toBe("ocr_confirmed");
    expect(tr.uncertain_spans.length).toBe(unc.length);
  });

  it("evaluates handwritten answers with presentation enabled and uncertain-region comments flagged", async () => {
    (await requestEvaluation(db, u.id, a.id));
    await runPendingJobs(db);
    const r = (await latestEvaluation(db, a.id))!.result!;
    expect(r.criteria.some((c) => c.code === "PRESENTATION")).toBe(true);
    expect(r.total.confidence_reasons).toContain("ocr_uncertain_spans");
    const tr = (await latestTranscript(db, a.id))!;
    for (const c of r.comments) {
      if (c.evidence.answer_spans.some((s) => tr.uncertain_spans.some((u2) => s.start < u2.end && u2.start < s.end))) expect(c.uncertain).toBe(true);
    }
  });
});

describe("privacy: consent, export and hard delete", async () => {
  const { db } = (await freshDb());
  const u = await makeUser(db);
  it("consents default to off and can be toggled", async () => {
    expect((await getConsents(db, u.id)).every((c) => c.granted === 0)).toBe(true);
    (await setConsent(db, u.id, "benchmark_use", true));
    expect((await getConsents(db, u.id)).find((c) => c.purpose === "benchmark_use")!.granted).toBe(1);
    (await setConsent(db, u.id, "benchmark_use", false));
    expect((await getConsents(db, u.id)).find((c) => c.purpose === "benchmark_use")!.revoked_at).toBeTruthy();
  });
  it("exports and then hard-deletes everything including files", async () => {
    const q = (await getQuestion(db, "gs2-rti-accountability"));
    const a = (await createAttempt(db, u.id, { question_id: q.id, mode: "typed" }));
    (await submitTyped(db, u.id, a.id, { text: "The RTI Act lets citizens ask public authorities for information, which improves accountability. However, pendency limits it. Overall it is effective." }));
    const hw = (await createAttempt(db, u.id, { question_id: q.id, mode: "handwritten" }));
    await addUpload(db, u.id, hw.id, await sheet());
    const dump = (await exportUserData(db, u.id));
    expect(dump.attempts.length).toBe(2);
    expect(JSON.stringify(dump)).not.toContain("password_hash");
    await expect((async () => deleteAccount(db, u.id, "wrong@example.com"))()).rejects.toThrow(/Type your email/);
    (await deleteAccount(db, u.id, (dump.user as { email: string }).email));
    expect((await db.get("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?", u.id))).toEqual({ n: 0 });
    expect((await db.get("SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?", u.id))).toEqual({ n: 0 });
    for (const t of ["transcripts", "hint_ladder_state", "error_ledger", "consents", "sessions"]) {
      const where = t === "transcripts" || t === "hint_ladder_state" ? "attempt_id IN (SELECT id FROM attempts WHERE user_id = ?)" : "user_id = ?";
      expect(await db.get(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`, u.id)).toEqual({ n: 0 });
    }
    expect(await db.get("SELECT COUNT(*) AS n FROM users WHERE id = ?", u.id)).toEqual({ n: 0 });
  });
});
