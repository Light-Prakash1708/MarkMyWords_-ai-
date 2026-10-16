/** Re-sync config and content (exams, rubrics, questions, sources) into the database. Idempotent. */
import { getEnv } from "../src/lib/env";
import { migrate, openDb } from "../src/lib/db";
import { ensureSeeded } from "../src/lib/db/seed";

const env = getEnv();
const db = await openDb(env.dbUrl, env.dbAuthToken);
(await migrate(db));
(await ensureSeeded(db));
console.log("Config and content synced.");
db.close();
