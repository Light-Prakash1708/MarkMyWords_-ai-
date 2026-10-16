import { createClient, type Client, type InArgs, type InValue, type ResultSet, type Transaction } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../env";
import { nowIso } from "../util/ids";
import { ensureSeeded } from "./seed";
export { parseJson, toJson } from "./json";

/**
 * Async database handle over libSQL. The same SQL (SQLite dialect) runs against:
 *  - a local file (`file:./data/markmywords.db`) for development and tests, and
 *  - a hosted libSQL/Turso database (`libsql://…`) in production (e.g. Vercel).
 *
 * Inside `transaction(fn)` always use the `tx` handle passed to `fn` (by convention it shadows
 * the outer `db`), never the outer client.
 */
export interface DB {
  get(sql: string, ...args: unknown[]): Promise<unknown>;
  all(sql: string, ...args: unknown[]): Promise<unknown[]>;
  run(sql: string, ...args: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
  close(): void;
  readonly url: string;
}

function toArg(v: unknown): InValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Buffer.isBuffer(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return v as InValue;
}

function rowsOf(r: ResultSet): Record<string, unknown>[] {
  return r.rows.map((row) => {
    const o: Record<string, unknown> = {};
    r.columns.forEach((c, i) => {
      const v = row[i];
      o[c] = v instanceof ArrayBuffer ? Buffer.from(v) : v;
    });
    return o;
  });
}

class LibsqlDB implements DB {
  constructor(
    private readonly c: Client | Transaction,
    readonly url: string,
    private readonly inTx = false,
  ) {}
  private exe(sql: string, args: unknown[]) {
    return this.c.execute({ sql, args: args.map(toArg) as InArgs });
  }
  async get(sql: string, ...args: unknown[]) {
    return rowsOf(await this.exe(sql, args))[0];
  }
  async all(sql: string, ...args: unknown[]) {
    return rowsOf(await this.exe(sql, args));
  }
  async run(sql: string, ...args: unknown[]) {
    const r = await this.exe(sql, args);
    return { changes: r.rowsAffected };
  }
  async exec(sql: string) {
    await this.c.executeMultiple(sql);
  }
  async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    const tx = await (this.c as Client).transaction("write");
    try {
      const out = await fn(new LibsqlDB(tx, this.url, true));
      await tx.commit();
      return out;
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        /* already closed */
      }
      throw e;
    } finally {
      tx.close();
    }
  }
  close() {
    if (!this.inTx) (this.c as Client).close();
  }
}

/** Open a database. `target` is a libSQL URL (`libsql://…`, `file:…`) or a plain file path. */
export async function openDb(target: string, authToken?: string): Promise<DB> {
  let url = target;
  if (!/^(libsql|https?|wss?|file):/.test(target)) {
    if (target !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    url = target === ":memory:" ? ":memory:" : `file:${path.resolve(target)}`;
  } else if (target.startsWith("file:")) {
    const p = target.slice(5);
    if (p && p !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  }
  const client = createClient({ url, authToken });
  const db = new LibsqlDB(client, url);
  if (url.startsWith("file:")) {
    await db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  }
  return db;
}

/** Apply pending *.up.sql migrations in order. */
export async function migrate(db: DB, dir = getEnv().migrationsDir): Promise<string[]> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(((await db.all("SELECT name FROM schema_migrations")) as { name: string }[]).map((r) => r.name));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();
  const ran: string[] = [];
  for (const f of files) {
    const name = f.replace(/\.up\.sql$/, "");
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await db.exec(sql);
    await db.run("INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)", name, nowIso());
    ran.push(name);
  }
  return ran;
}

/** Roll back the most recent migration using its *.down.sql. */
export async function rollback(db: DB, dir = getEnv().migrationsDir): Promise<string | null> {
  const last = (await db.get("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1")) as { name: string } | undefined;
  if (!last) return null;
  const sql = fs.readFileSync(path.join(dir, `${last.name}.down.sql`), "utf8");
  await db.exec(`PRAGMA foreign_keys = OFF; ${sql}`);
  await db.run("DELETE FROM schema_migrations WHERE name = ?", last.name);
  return last.name;
}

type GlobalWithDb = typeof globalThis & { __mmwDb?: Promise<DB>; __mmwDbKey?: string };

/**
 * Process-wide database handle. On first use it migrates and syncs config/content (skipped when
 * nothing changed), so a fresh checkout or a fresh serverless instance just works.
 */
export function getDb(): Promise<DB> {
  const g = globalThis as GlobalWithDb;
  const env = getEnv();
  const key = `${env.dbUrl}|${env.dbAuthToken ? "auth" : ""}`;
  if (g.__mmwDb && g.__mmwDbKey === key) return g.__mmwDb;
  const init = async () => {
    const db = await openDb(env.dbUrl, env.dbAuthToken);
    try {
      await migrate(db);
      await ensureSeeded(db);
    } catch (e) {
      // Two cold serverless instances can race on a brand-new database; the loser retries once
      // and finds the work already done.
      await new Promise((r) => setTimeout(r, 750));
      await migrate(db).catch(() => undefined);
      await ensureSeeded(db).catch(() => {
        throw e;
      });
    }
    return db;
  };
  const p = init();
  p.catch(() => {
    if (g.__mmwDb === p) g.__mmwDb = undefined;
  });
  g.__mmwDb = p;
  g.__mmwDbKey = key;
  return p;
}
