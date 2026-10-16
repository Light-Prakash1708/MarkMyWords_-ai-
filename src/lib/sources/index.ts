import type { DB } from "../db";
import { parseJson } from "../db";
import type { HeuristicCheck } from "../exam-config";
import type { Citation, RetrievedSource } from "../schemas/evaluation";
import { contentWords } from "../util/text";

interface ChunkRow {
  chunk_id: string;
  source_id: string;
  text: string;
  title: string;
  url: string;
  published_on: string | null;
  text_kind: "verbatim" | "our_summary" | "link_only";
  verification_status: "verified" | "unverified";
  stale_after_days: number | null;
}

const CHUNK_SELECT = `SELECT c.id AS chunk_id, c.source_id, c.text, s.title, s.url, s.published_on, s.text_kind, s.verification_status, s.stale_after_days
  FROM source_chunks c JOIN sources s ON s.id = c.source_id`;

function toRetrieved(r: ChunkRow): RetrievedSource {
  return {
    source_chunk_id: r.chunk_id,
    source_id: r.source_id,
    title: r.title,
    url: r.url,
    published_on: r.published_on,
    text: r.text,
    text_kind: r.text_kind,
    verification_status: r.verification_status,
    stale_after_days: r.stale_after_days,
  };
}

/** Build a safe FTS5 query: quoted terms OR-ed together (no user-controlled operators). */
export function ftsQuery(text: string, maxTerms = 24): string {
  const words = Array.from(new Set(contentWords(text))).slice(0, maxTerms);
  return words.map((w) => `"${w.replace(/"/g, "")}"`).join(" OR ");
}

/**
 * Retrieve source chunks for a question: chunks linked to the question first, then BM25 matches.
 * The evaluator may cite ONLY these chunks.
 */
export function retrieveForQuestion(db: DB, questionId: string, queryText: string, k = 8, minRelative = 0.45): RetrievedSource[] {
  const linked = db
    .prepare(`${CHUNK_SELECT} JOIN question_sources qs ON qs.source_id = s.id WHERE qs.question_id = ? AND s.status = 'active' ORDER BY c.ordinal`)
    .all(questionId) as ChunkRow[];
  const out = new Map<string, RetrievedSource>();
  for (const r of linked) out.set(r.chunk_id, toRetrieved(r));
  const q = ftsQuery(queryText);
  if (q) {
    const hits = db
      .prepare(`SELECT chunk_id, bm25(source_chunks_fts) AS score FROM source_chunks_fts WHERE source_chunks_fts MATCH ? ORDER BY score LIMIT ?`)
      .all(q, k * 2) as { chunk_id: string; score: number }[];
    // bm25() is negative; more negative = more relevant. Keep hits reasonably close to the best one.
    const best = hits[0]?.score ?? 0;
    for (const h of hits) {
      if (best < 0 && h.score > best * minRelative) continue;
      if (out.size >= k + linked.length) break;
      if (out.has(h.chunk_id)) continue;
      const r = db.prepare(`${CHUNK_SELECT} WHERE c.id = ? AND s.status = 'active'`).get(h.chunk_id) as ChunkRow | undefined;
      if (r) out.set(r.chunk_id, toRetrieved(r));
    }
  }
  return [...out.values()];
}

export function sourcesByIds(db: DB, chunkIds: string[]): RetrievedSource[] {
  return chunkIds
    .map((id) => db.prepare(`${CHUNK_SELECT} WHERE c.id = ?`).get(id) as ChunkRow | undefined)
    .filter((r): r is ChunkRow => !!r)
    .map(toRetrieved);
}

export function mayBeOutdated(s: Pick<RetrievedSource, "published_on" | "stale_after_days">, now = new Date()): boolean {
  if (!s.stale_after_days || !s.published_on) return false;
  const pub = new Date(s.published_on).getTime();
  return now.getTime() - pub > s.stale_after_days * 86400_000;
}

/**
 * Verify a citation: the chunk must be among the retrieved sources AND the quote must be an exact
 * substring of the chunk text. Returns null when verification fails (the citation is dropped).
 */
export function verifyCitation(retrieved: RetrievedSource[], chunkId: string, quote: string): Citation | null {
  const src = retrieved.find((r) => r.source_chunk_id === chunkId);
  if (!src) return null;
  const q = quote.trim();
  if (q.length < 4 || !src.text.includes(q)) return null;
  return {
    source_chunk_id: src.source_chunk_id,
    source_title: src.title,
    source_url: src.url,
    published_on: src.published_on,
    quote: q,
    text_kind: src.text_kind,
    verification_status: src.verification_status,
    may_be_outdated: mayBeOutdated(src),
  };
}

export interface CheckWithSource {
  check: HeuristicCheck;
  source: RetrievedSource;
}

/** All deterministic fact checks in the corpus, each paired with the chunk containing its quote. */
export function allHeuristicChecks(db: DB): CheckWithSource[] {
  const rows = db.prepare("SELECT id, heuristic_checks FROM sources WHERE status = 'active' AND heuristic_checks != '[]'").all() as {
    id: string;
    heuristic_checks: string;
  }[];
  const out: CheckWithSource[] = [];
  for (const row of rows) {
    const checks = parseJson<HeuristicCheck[]>(row.heuristic_checks, []);
    const chunks = (db.prepare(`${CHUNK_SELECT} WHERE c.source_id = ?`).all(row.id) as ChunkRow[]).map(toRetrieved);
    for (const check of checks) {
      const chunk = chunks.find((c) => c.text.includes(check.quote));
      if (chunk) out.push({ check, source: chunk });
    }
  }
  return out;
}

export function sourceDossier(db: DB, questionId: string) {
  return db
    .prepare(
      `SELECT s.id, s.title, s.publisher, s.url, s.published_on, s.text_kind, s.verification_status, s.stale_after_days,
              (SELECT group_concat(text, '\n\n') FROM source_chunks c WHERE c.source_id = s.id) AS text
       FROM question_sources qs JOIN sources s ON s.id = qs.source_id WHERE qs.question_id = ? AND s.status = 'active'`,
    )
    .all(questionId) as {
    id: string;
    title: string;
    publisher: string;
    url: string;
    published_on: string | null;
    text_kind: string;
    verification_status: string;
    stale_after_days: number | null;
    text: string;
  }[];
}
