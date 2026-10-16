-- Serverless-ready storage: upload bytes live in the database (no local disk on Vercel),
-- retrieval no longer needs the FTS5 extension, and a small key/value table holds
-- the content-sync hash and the generated signing secret.
DROP TABLE IF EXISTS source_chunks_fts;
ALTER TABLE uploads ADD COLUMN data BLOB;
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
