/**
 * Add a source to the corpus from a local JSON file in the content/sources format:
 *   npm run sources:ingest -- path/to/file.json
 * The file is validated (every fact-check quote must appear in a chunk), copied into
 * content/sources/, and synced. Sources always start as verification_status=unverified.
 * Respect each publisher's terms: store official documents (PIB, RBI, statutes) or your own
 * summaries; for editorials store only a link and your own summary.
 */
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../src/lib/env";
import { SourceFileSchema } from "../src/lib/exam-config";
import { migrate, openDb } from "../src/lib/db";
import { ensureSeeded } from "../src/lib/db/seed";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run sources:ingest -- <file.json>");
  process.exit(1);
}
const parsed = SourceFileSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
for (const s of parsed.sources) for (const c of s.heuristic_checks) {
  if (!s.chunks.some((ch) => ch.includes(c.quote))) throw new Error(`${s.slug}: check ${c.id} quote not found in chunks`);
}
const dest = path.join(getEnv().contentDir, "sources", path.basename(file));
fs.copyFileSync(file, dest);
const db = await openDb(getEnv().dbUrl, getEnv().dbAuthToken);
(await migrate(db));
(await ensureSeeded(db));
console.log(`Ingested ${parsed.sources.length} source(s) from ${path.basename(file)}.`);
