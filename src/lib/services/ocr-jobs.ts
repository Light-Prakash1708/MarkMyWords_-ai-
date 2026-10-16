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
  const a = db.prepare("SELECT id, user_id, status FROM attempts WHERE id = ?").get(attemptId) as { id: string; user_id: string; status: string } | undefined;
  if (!a || a.status !== "awaiting_transcription") return;
  const env = getEnv();
  const uploads = db.prepare("SELECT storage_key, stored_mime, page_count FROM uploads WHERE attempt_id = ? ORDER BY page_index").all(a.id) as {
    storage_key: string;
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
    assertSpendCapNotReached(db);
    rateLimit(db, `ocr:pages:${a.user_id}`, env.ocrPagesPerDay, 86400);
    const pages = uploads.map((u) => ({
      mime: u.stored_mime,
      base64: fs.readFileSync(path.join(env.uploadDir, u.storage_key)).toString("base64"),
    }));
    const res = await transcribeWithProvider(provider, pages);
    recordCost(db, { userId: a.user_id, operation: "ocr", provider: provider.name, model: res.model, usage: res.usage });
    raw = res.raw;
    engine = `${provider.name}:${res.model}`;
  }
  const built = buildTranscript(raw);
  db.transaction(() => {
    db.prepare("INSERT INTO ocr_runs (id, attempt_id, engine, status, pages, created_at) VALUES (?,?,?,?,?,?)").run(runId, a.id, engine, "completed", toJson(built), nowIso());
    db.prepare("UPDATE attempts SET status = 'awaiting_confirmation', updated_at = ? WHERE id = ?").run(nowIso(), a.id);
  })();
}

export function markOcrFailed(db: DB, attemptId: string, message: string) {
  db.prepare("INSERT INTO ocr_runs (id, attempt_id, engine, status, pages, error, created_at) VALUES (?,?,?,?,?,?,?)").run(
    newId(), attemptId, "n/a", "failed", "null", message, nowIso(),
  );
  // Leave the attempt awaiting transcription so the student can type it instead.
}
