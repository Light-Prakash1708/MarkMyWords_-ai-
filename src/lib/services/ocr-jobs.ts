import fs from "node:fs";
import path from "node:path";
import type { DB } from "../db";
import { toJson } from "../db";
import { getEnv } from "../env";
import { getProvider } from "../llm";
import { assertSpendCapNotReached, recordCost } from "../llm/cost";
import { buildTranscript, mockOcr, transcribeWithProvider } from "../ocr";
import { rateLimit } from "../security/rate-limit";
import { newId, nowIso } from "../util/ids";

export async function runOcrJob(db: DB, attemptId: string) {
  const a = (await db.get("SELECT id, user_id, status FROM attempts WHERE id = ?", attemptId)) as { id: string; user_id: string; status: string } | undefined;
  if (!a || a.status !== "awaiting_transcription") return;
  const env = getEnv();
  const uploads = (await db.all("SELECT data, stored_mime, page_count FROM uploads WHERE attempt_id = ? ORDER BY page_index", a.id)) as {
    data: Buffer | null;
    stored_mime: "image/jpeg" | "application/pdf";
    page_count: number;
  }[];
  const pageCount = uploads.reduce((s, u) => s + u.page_count, 0);
  const runId = newId();
  let raw;
  let engine: string;
  if (env.ocrProvider === "mock") {
    if (!env.allowMock) throw Object.assign(new Error("Mock OCR is disabled in production."), { permanent: true });
    raw = mockOcr(pageCount);
    engine = "mock-ocr";
  } else {
    const provider = getProvider();
    if (!provider) throw Object.assign(new Error("No AI provider configured for OCR."), { permanent: true });
    (await assertSpendCapNotReached(db));
    (await rateLimit(db, `ocr:pages:${a.user_id}`, env.ocrPagesPerDay, 86400));
    const pages = uploads.map((u) => ({
      mime: u.stored_mime,
      base64: Buffer.from(u.data ?? new Uint8Array()).toString("base64"),
    }));
    const res = await transcribeWithProvider(provider, pages);
    (await recordCost(db, { userId: a.user_id, operation: "ocr", provider: provider.name, model: res.model, usage: res.usage }));
    raw = res.raw;
    engine = `${provider.name}:${res.model}`;
  }
  const built = buildTranscript(raw);
  await db.transaction(async (db) => {
    (await db.run("INSERT INTO ocr_runs (id, attempt_id, engine, status, pages, created_at) VALUES (?,?,?,?,?,?)", runId, a.id, engine, "completed", toJson(built), nowIso()));
    (await db.run("UPDATE attempts SET status = 'awaiting_confirmation', updated_at = ? WHERE id = ?", nowIso(), a.id));
  });
}

export async function markOcrFailed(db: DB, attemptId: string, message: string) {
  (await db.run("INSERT INTO ocr_runs (id, attempt_id, engine, status, pages, error, created_at) VALUES (?,?,?,?,?,?,?)", newId(), attemptId, "n/a", "failed", "null", message, nowIso()));
  // Leave the attempt awaiting transcription so the student can type it instead.
}
