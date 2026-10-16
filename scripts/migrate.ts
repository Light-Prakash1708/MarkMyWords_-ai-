import { getEnv } from "../src/lib/env";
import { migrate, openDb, rollback } from "../src/lib/db";

const env = getEnv();
const db = openDb(env.dbPath);
if (process.argv.includes("--down")) {
  const name = rollback(db);
  console.log(name ? `Rolled back ${name}` : "Nothing to roll back");
} else {
  const ran = migrate(db);
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date");
}
db.close();
