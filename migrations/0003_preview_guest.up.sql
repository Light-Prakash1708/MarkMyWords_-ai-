-- Launch stage per exam (live | preview) and an index for guest-trial housekeeping.
ALTER TABLE exams ADD COLUMN stage TEXT NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS idx_users_plan_created ON users(plan, created_at);
