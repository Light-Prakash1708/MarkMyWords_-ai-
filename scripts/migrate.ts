import { getEnv } from "../src/lib/env";
import { migrate, openDb, rollback } from "../src/lib/db";

const env = getEnv();
const db = await openDb(env.dbUrl, env.dbAuthToken);
if (process.argv.includes("--down")) {
  const name = (await rollback(db));
  console.log(name ? `Rolled back ${name}` : "Nothing to roll back");
} else {
  const ran = (await migrate(db));
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date");
}
db.close();
