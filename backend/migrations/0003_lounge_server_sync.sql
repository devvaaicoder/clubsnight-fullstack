CREATE TABLE IF NOT EXISTS lounge_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT OR IGNORE INTO lounge_config (key, value, updated_at, updated_by) VALUES
  ('min_post_chars', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system:migration'),
  ('max_stories_per_day', '3', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system:migration'),
  ('max_global_posts', '20', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system:migration'),
  ('posting_locked', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system:migration'),
  ('qc_gateway', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system:migration');

CREATE TABLE IF NOT EXISTS talent_approvals (
  talent_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  decided_by TEXT,
  decided_at TEXT,
  reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_talent_approvals_status
  ON talent_approvals (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS lounge_admin_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lounge_admin_audit_action
  ON lounge_admin_audit (action, created_at DESC);

CREATE TABLE IF NOT EXISTS lounge_deleted_stories (
  story_id TEXT PRIMARY KEY,
  deleted_by TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
