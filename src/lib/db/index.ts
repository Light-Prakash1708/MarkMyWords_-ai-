import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../env";
import { nowIso } from "../util/ids";
import { ensureSeeded } from "./seed";
export { parseJson, toJson } from "./json";

export type DB = Database.Database;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** Apply pending *.up.sql migrations in order. Each runs in a transaction. */
export function migrate(db: DB, dir = getEnv().migrationsDir): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();
  const ran: string[] = [];
  for (const f of files) {
    const name = f.replace(/\.up\.sql$/, "");
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, nowIso());
    })();
    ran.push(name);
  }
  return ran;
}

/** Roll back the most recent migration using its *.down.sql. */
export function rollback(db: DB, dir = getEnv().migrationsDir): string | null {
  const last = db.prepare("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1").get() as
    | { name: string }
    | undefined;
  if (!last) return null;
  const sql = fs.readFileSync(path.join(dir, `${last.name}.down.sql`), "utf8");
  db.transaction(() => {
    db.pragma("foreign_keys = OFF");
    db.exec(sql);
    db.prepare("DELETE FROM schema_migrations WHERE name = ?").run(last.name);
  })();
  db.pragma("foreign_keys = ON");
  return last.name;
}

type GlobalWithDb = typeof globalThis & { __mmwDb?: DB; __mmwDbPath?: string };

/**
 * Process-wide database handle. On first use it migrates and (if empty) seeds config and content,
 * so `npm run dev` works on a fresh checkout.
 */
export function getDb(): DB {
  const g = globalThis as GlobalWithDb;
  const env = getEnv();
  if (g.__mmwDb && g.__mmwDbPath === env.dbPath) return g.__mmwDb;
  const db = openDb(env.dbPath);
  migrate(db);
  ensureSeeded(db);
  g.__mmwDb = db;
  g.__mmwDbPath = env.dbPath;
  return db;
}

