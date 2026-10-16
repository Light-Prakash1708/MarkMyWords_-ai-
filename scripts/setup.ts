/**
 * One-time local setup: creates .env.local with a random signing secret (if missing),
 * migrates and seeds the database. Safe to run repeatedly.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const envFile = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envFile)) {
  const example = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  fs.writeFileSync(envFile, example.replace(/^MMW_SIGNING_SECRET=.*$/m, `MMW_SIGNING_SECRET=${randomBytes(32).toString("base64url")}`), { mode: 0o600 });
  console.log("Created .env.local (edit it to add ANTHROPIC_API_KEY and MMW_ADMIN_EMAILS).");
} else {
  console.log(".env.local already exists — leaving it unchanged.");
}

async function main() {
  // Load .env.local for this process so the DB path etc. match the app.
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
  const { getDb } = await import("../src/lib/db");
  const db = (await getDb());
  const q = ((await db.get("SELECT COUNT(*) AS n FROM questions")) as { n: number }).n;
  const s = ((await db.get("SELECT COUNT(*) AS n FROM sources")) as { n: number }).n;
  console.log(`Database ready: ${q} questions, ${s} sources.`);
  console.log("Next: npm run build && npm start   (or npm run dev)");
}
(await main());
