/** Re-sync config and content (exams, rubrics, questions, sources) into the database. Idempotent. */
import { getEnv } from "../src/lib/env";
import { migrate, openDb } from "../src/lib/db";
import { ensureSeeded } from "../src/lib/db/seed";

const db = openDb(getEnv().dbPath);
migrate(db);
ensureSeeded(db);
console.log("Config and content synced.");
db.close();
