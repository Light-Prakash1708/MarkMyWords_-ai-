import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, openDb, type DB } from "@/lib/db";
import { ensureSeeded } from "@/lib/db/seed";
import { signup } from "@/lib/services/users";
import { getQuestion } from "@/lib/services/questions";
import { buildEvaluationInput, rubricForQuestion } from "@/lib/services/evaluations";
import { createAttempt, submitTyped } from "@/lib/services/attempts";
import type { EvaluationInput } from "@/lib/schemas/evaluation";

export function tempDir(prefix = "mmw-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A fresh, migrated and seeded SQLite database in a temp directory. */
export async function freshDb(): Promise<{ db: DB; dir: string }> {
  const dir = tempDir();
  const db = (await openDb(path.join(dir, "test.db")));
  (await migrate(db));
  (await ensureSeeded(db));
  return { db, dir };
}

let n = 0;
export async function makeUser(db: DB, name = "Student") {
  n++;
  const { user } = await signup(db, { email: `u${n}-${Date.now()}@example.com`, password: "a long test password", display_name: name }, `10.0.0.${n % 250}`);
  return user;
}

/** Create a submitted typed attempt and return a ready-to-run EvaluationInput. */
export async function inputFor(db: DB, slug: string, text: string, opts: { samples?: number } = {}): Promise<{ input: EvaluationInput; userId: string; attemptId: string }> {
  const u = await makeUser(db);
  const q = (await getQuestion(db, slug));
  const a = (await createAttempt(db, u.id, { question_id: q.id, mode: "typed" }));
  (await submitTyped(db, u.id, a.id, { text }));
  const rv = (await rubricForQuestion(db, q));
  const row = (await db.get("SELECT * FROM attempts WHERE id = ?", a.id)) as Parameters<typeof buildEvaluationInput>[1];
  return { input: (await buildEvaluationInput(db, row, rv.id, opts.samples ?? 3)), userId: u.id, attemptId: a.id };
}

export function joinParas(ps: { text: string }[]) {
  return ps.map((p) => p.text).join("\n\n");
}

export function baseAnswers() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "benchmarks", "cases", "base_answers.json"), "utf8")).answers as {
    id: string;
    question_slug: string;
    tier: string;
    paragraphs: { role: string; text: string }[];
    factual_substitutions: { find: string; replace: string; check_id: string | null }[];
    pattern_error?: { append_to: string; sentence: string };
  }[];
}
