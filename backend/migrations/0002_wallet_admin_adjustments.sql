CREATE TABLE IF NOT EXISTS wallet_admin_adjustments (
  subject TEXT NOT NULL,
  reference TEXT NOT NULL,
  username TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (subject, reference)
);

CREATE INDEX IF NOT EXISTS wallet_admin_adjustments_subject
  ON wallet_admin_adjustments (subject, created_at);
