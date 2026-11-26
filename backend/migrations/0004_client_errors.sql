CREATE TABLE IF NOT EXISTS client_errors (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  page TEXT NOT NULL,
  message TEXT NOT NULL,
  line INTEGER NOT NULL DEFAULT 0,
  ua TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_errors_ts
  ON client_errors (ts DESC);
