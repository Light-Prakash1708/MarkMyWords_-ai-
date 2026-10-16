-- MarkMyWords initial schema (SQLite). Additive; see 0001_init.down.sql for rollback.
-- JSON columns are stored as TEXT and validated by Zod in the application layer.

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','reviewer','admin')),
  org_id TEXT REFERENCES orgs(id),
  target_exam_code TEXT,
  target_year INTEGER,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('benchmark_use','model_improvement','public_example','parent_summary')),
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT,
  revoked_at TEXT,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, purpose)
);

CREATE TABLE exams (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','inactive')),
  config_version TEXT NOT NULL,
  input_modes TEXT NOT NULL,
  default_input_mode TEXT NOT NULL,
  ux TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subtitle TEXT,
  total_marks INTEGER,
  duration_min INTEGER,
  default_input_mode TEXT NOT NULL,
  fact_source_url TEXT,
  official_reference_url TEXT,
  verified_on TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('official','secondary','unverified')),
  status TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE question_types (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id),
  code TEXT NOT NULL,
  marks REAL,
  word_limit INTEGER,
  time_budget_min INTEGER NOT NULL,
  word_tolerance_pct INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (paper_id, code)
);

CREATE TABLE syllabus_nodes (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id),
  code TEXT NOT NULL UNIQUE,
  parent_code TEXT,
  title TEXT NOT NULL,
  text_kind TEXT NOT NULL DEFAULT 'paraphrase',
  micro_topics TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE directives (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  demand TEXT NOT NULL,
  expected_moves TEXT NOT NULL
);

CREATE TABLE skill_tags (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grp TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  paper_id TEXT NOT NULL REFERENCES papers(id),
  question_type_id TEXT NOT NULL REFERENCES question_types(id),
  text TEXT NOT NULL,
  parts TEXT NOT NULL,
  directive_codes TEXT NOT NULL,
  syllabus_codes TEXT NOT NULL,
  dimensions_expected TEXT NOT NULL DEFAULT '[]',
  origin TEXT NOT NULL CHECK (origin IN ('pyq','original','ca_generated')),
  pyq_year INTEGER,
  pyq_source_url TEXT,
  priority_reasons TEXT NOT NULL DEFAULT '[]',
  skill_tags_targeted TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL CHECK (review_status IN ('draft','pending_human','approved','retired')),
  review_checks TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  dossier_policy TEXT NOT NULL DEFAULT 'post_attempt_only' CHECK (dossier_policy IN ('pre_attempt_allowed','post_attempt_only')),
  version INTEGER NOT NULL DEFAULT 1,
  language TEXT NOT NULL DEFAULT 'en',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_questions_paper ON questions(paper_id, review_status);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  text_kind TEXT NOT NULL CHECK (text_kind IN ('verbatim','our_summary','link_only')),
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL,
  published_on TEXT,
  retrieved_on TEXT NOT NULL,
  license TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','unverified')),
  verified_by TEXT,
  stale_after_days INTEGER,
  heuristic_checks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, ordinal)
);

CREATE VIRTUAL TABLE source_chunks_fts USING fts5(chunk_id UNINDEXED, text, tokenize = 'porter unicode61');

CREATE TABLE question_sources (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('background','fact_basis','pyq_related')),
  PRIMARY KEY (question_id, source_id)
);

CREATE TABLE qotd (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  exam_code TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  approved_by TEXT,
  published_at TEXT NOT NULL,
  UNIQUE (date, exam_code)
);

CREATE TABLE rubrics (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  exam_code TEXT NOT NULL,
  question_type_code TEXT NOT NULL,
  paper_codes TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calibration_reports (
  id TEXT PRIMARY KEY,
  rubric_version_id TEXT NOT NULL,
  report TEXT NOT NULL,
  human_reviewed_cases INTEGER NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE rubric_versions (
  id TEXT PRIMARY KEY,
  rubric_id TEXT NOT NULL REFERENCES rubrics(id),
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','calibrating','active','retired')),
  criteria TEXT NOT NULL,
  max_band INTEGER NOT NULL,
  aggregation TEXT NOT NULL,
  disclaimer TEXT NOT NULL,
  changelog TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  calibration_report_id TEXT REFERENCES calibration_reports(id),
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (rubric_id, version)
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  mode TEXT NOT NULL CHECK (mode IN ('typed','handwritten')),
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','awaiting_transcription','awaiting_confirmation','ready','evaluating','evaluated','failed')),
  attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('first','rewrite','transfer_retest')),
  parent_attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  retest_id TEXT,
  timer_mode TEXT NOT NULL DEFAULT 'exam' CHECK (timer_mode IN ('exam','untimed')),
  draft_text TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  time_spent_sec INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_attempts_user ON attempts(user_id, created_at);
CREATE INDEX idx_attempts_user_question ON attempts(user_id, question_id);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  original_mime TEXT NOT NULL,
  stored_mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 1,
  validation_status TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'not_scanned',
  exif_stripped INTEGER NOT NULL DEFAULT 0,
  quality TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ocr_runs (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  pages TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('typed','ocr_confirmed','student_transcribed')),
  ocr_run_id TEXT REFERENCES ocr_runs(id) ON DELETE SET NULL,
  uncertain_spans TEXT NOT NULL DEFAULT '[]',
  diagrams TEXT NOT NULL DEFAULT '[]',
  confirmed_by_student_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (attempt_id, version)
);

CREATE TABLE self_assessments (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE CASCADE,
  ratings TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  transcript_version INTEGER NOT NULL,
  rubric_version_id TEXT NOT NULL REFERENCES rubric_versions(id),
  engine_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  result_json TEXT,
  score_kind TEXT NOT NULL DEFAULT 'ai_estimate' CHECK (score_kind = 'ai_estimate'),
  point_estimate REAL,
  max_marks REAL,
  confidence TEXT,
  trace_id TEXT NOT NULL,
  human_review_status TEXT NOT NULL DEFAULT 'none' CHECK (human_review_status IN ('none','queued','reviewed')),
  error TEXT,
  est_cost_inr REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_evaluations_attempt ON evaluations(attempt_id, created_at);

CREATE TABLE evaluation_comments (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL,
  criterion_code TEXT NOT NULL,
  skill_tag TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  span_start INTEGER,
  span_end INTEGER,
  uncertain INTEGER NOT NULL
);

CREATE TABLE citations (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  comment_id TEXT,
  source_chunk_id TEXT NOT NULL,
  quote TEXT NOT NULL,
  verified INTEGER NOT NULL,
  verification_method TEXT NOT NULL
);

CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  comment_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','upheld','overturned','partially_upheld')),
  resolution TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE skill_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_tag TEXT NOT NULL,
  paper_scope TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1,
  beta REAL NOT NULL DEFAULT 1,
  occurrences INTEGER NOT NULL DEFAULT 0,
  repair_count INTEGER NOT NULL DEFAULT 0,
  transfer_success_count INTEGER NOT NULL DEFAULT 0,
  transfer_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_transfer_result TEXT,
  last_updated TEXT NOT NULL,
  PRIMARY KEY (user_id, skill_tag, paper_scope)
);

CREATE TABLE error_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_tag TEXT NOT NULL,
  paper_code TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  resolved_in_rewrite INTEGER,
  absent_in_transfer INTEGER
);
CREATE INDEX idx_ledger_user ON error_ledger(user_id, skill_tag, occurred_at);

CREATE TABLE retest_schedule (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_tag TEXT NOT NULL,
  paper_code TEXT NOT NULL,
  source_attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES questions(id),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','passed','failed','cancelled')),
  completed_attempt_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE hint_ladder_state (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
  max_rung_revealed INTEGER NOT NULL DEFAULT -1,
  revealed TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE hint_content (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  rung INTEGER NOT NULL,
  content TEXT NOT NULL,
  generator TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (attempt_id, rung)
);

CREATE TABLE cost_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  operation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_inr REAL NOT NULL DEFAULT 0,
  trace_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cost_created ON cost_ledger(created_at);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_status ON jobs(status, run_after);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE share_links (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
