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

/** Light suffix stemmer so "subsidies"/"subsidy", "federalism"/"federal" etc. meet in the index. */
export function stem(w: string): string {
  let x = w.toLowerCase();
  if (x.length <= 4) return x;
  const rules: [RegExp, string][] = [
    [/ational$/, "ate"], [/ization$/, "ize"], [/fulness$/, "ful"], [/iveness$/, "ive"],
    [/(ism|ist|ity|ment|ness)$/, ""], [/ies$/, "y"], [/sses$/, "ss"], [/(ing|edly|ed)$/, ""], [/ly$/, ""], [/(?<!s)s$/, ""],
  ];
  for (const [re, rep] of rules) {
    if (re.test(x)) {
      const y = x.replace(re, rep);
      if (y.length >= 3) x = y;
      break;
    }
  }
  return x;
}

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(stem);
}

/** Unique stemmed query terms (no user-controlled operators reach SQL; ranking happens in code). */
export function queryTerms(text: string, maxTerms = 24): string[] {
  return Array.from(new Set(contentWords(text).map(stem))).slice(0, maxTerms);
}

/** Okapi BM25 (k1 = 1.2, b = 0.75) over the given chunks. Higher = more relevant. */
export function bm25Rank(chunks: { id: string; text: string }[], query: string[]): { chunk_id: string; score: number }[] {
  if (!chunks.length || !query.length) return [];
  const docs = chunks.map((c) => {
    const tf = new Map<string, number>();
    const t = terms(c.text);
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { id: c.id, tf, len: t.length };
  });
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.len, 0) / N || 1;
  const df = new Map<string, number>();
  for (const q of query) df.set(q, docs.filter((d) => d.tf.has(q)).length);
  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((d) => {
    let score = 0;
    for (const q of query) {
      const f = d.tf.get(q);
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
    }
    return { chunk_id: d.id, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score);
}

/**
 * Retrieve source chunks for a question: chunks linked to the question first, then BM25 matches.
 * The evaluator may cite ONLY these chunks.
 */
export async function retrieveForQuestion(db: DB, questionId: string, queryText: string, k = 8, minRelative = 0.45): Promise<RetrievedSource[]> {
  const linked = (await db.all(`${CHUNK_SELECT} JOIN question_sources qs ON qs.source_id = s.id WHERE qs.question_id = ? AND s.status = 'active' ORDER BY c.ordinal`, questionId)) as ChunkRow[];
  const out = new Map<string, RetrievedSource>();
  for (const r of linked) out.set(r.chunk_id, toRetrieved(r));
  const q = queryTerms(queryText);
  if (q.length) {
    const all = (await db.all(`${CHUNK_SELECT} WHERE s.status = 'active'`)) as ChunkRow[];
    const byId = new Map(all.map((r) => [r.chunk_id, r]));
    const hits = bm25Rank(all.map((r) => ({ id: r.chunk_id, text: r.text })), q).slice(0, k * 2);
    // Keep hits reasonably close to the best one so loosely related chunks are not offered as evidence.
    const best = hits[0]?.score ?? 0;
    for (const h of hits) {
      if (h.score < best * minRelative) continue;
      if (out.size >= k + linked.length) break;
      if (out.has(h.chunk_id)) continue;
      const r = byId.get(h.chunk_id);
      if (r) out.set(r.chunk_id, toRetrieved(r));
    }
  }
  return [...out.values()];
}

export async function sourcesByIds(db: DB, chunkIds: string[]): Promise<RetrievedSource[]> {
  const out: RetrievedSource[] = [];
  for (const id of chunkIds) {
    const r = (await db.get(`${CHUNK_SELECT} WHERE c.id = ?`, id)) as ChunkRow | undefined;
    if (r) out.push(toRetrieved(r));
  }
  return out;
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
export async function allHeuristicChecks(db: DB): Promise<CheckWithSource[]> {
  const rows = (await db.all("SELECT id, heuristic_checks FROM sources WHERE status = 'active' AND heuristic_checks != '[]'")) as {
    id: string;
    heuristic_checks: string;
  }[];
  const out: CheckWithSource[] = [];
  for (const row of rows) {
    const checks = parseJson<HeuristicCheck[]>(row.heuristic_checks, []);
    const chunks = ((await db.all(`${CHUNK_SELECT} WHERE c.source_id = ?`, row.id)) as ChunkRow[]).map(toRetrieved);
    for (const check of checks) {
      const chunk = chunks.find((c) => c.text.includes(check.quote));
      if (chunk) out.push({ check, source: chunk });
    }
  }
  return out;
}

export async function sourceDossier(db: DB, questionId: string) {
  return (await db.all(`SELECT s.id, s.title, s.publisher, s.url, s.published_on, s.text_kind, s.verification_status, s.stale_after_days,
              (SELECT group_concat(text, '\n\n') FROM source_chunks c WHERE c.source_id = s.id) AS text
       FROM question_sources qs JOIN sources s ON s.id = qs.source_id WHERE qs.question_id = ? AND s.status = 'active'`, questionId)) as {
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
