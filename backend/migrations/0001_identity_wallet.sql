CREATE TABLE IF NOT EXISTS orders_store (
  id TEXT PRIMARY KEY,
  customer_username TEXT,
  customer_name TEXT,
  service TEXT,
  amount INTEGER,
  voucher TEXT,
  note TEXT,
  status TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS wallet_balances (
  username TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS qris_intents (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  base_amount INTEGER NOT NULL,
  unique_code INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  mode TEXT,
  service TEXT,
  status TEXT DEFAULT 'PENDING',
  expires_at INTEGER,
  created_at TEXT,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS wallet_subject_balances (
  subject TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_legacy_claims (
  legacy_username TEXT NOT NULL,
  subject TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'review', 'rejected')),
  reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  PRIMARY KEY (legacy_username, subject)
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_legacy_one_claim_per_username
  ON wallet_legacy_claims (legacy_username)
  WHERE status = 'claimed';

CREATE TABLE IF NOT EXISTS wallet_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_username TEXT NOT NULL,
  subject TEXT NOT NULL,
  amount INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('claimed', 'review', 'resolved', 'rejected')),
  reason TEXT,
  occurred_at TEXT NOT NULL,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS wallet_migrations_review
  ON wallet_legacy_claims (status, legacy_username, created_at);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  username TEXT NOT NULL,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  reference TEXT,
  actor_subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS wallet_transactions_subject
  ON wallet_transactions (subject, created_at);

CREATE TABLE IF NOT EXISTS wallet_intents (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  username TEXT NOT NULL,
  base_amount INTEGER NOT NULL,
  unique_code INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  mode TEXT,
  service TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS wallet_intents_pending
  ON wallet_intents (status, base_amount, expires_at);

CREATE TABLE IF NOT EXISTS legacy_qris_credits (
  intent_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  amount INTEGER NOT NULL,
  subject TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  credited_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_subject_links (
  order_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'standard',
  assigned_talent_subject TEXT,
  linked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS order_subject_links_subject
  ON order_subject_links (subject, order_type);

CREATE INDEX IF NOT EXISTS order_subject_links_talent
  ON order_subject_links (assigned_talent_subject);

INSERT INTO order_subject_links (order_id, subject, order_type, linked_at)
SELECT o.id, c.subject,
       CASE WHEN lower(COALESCE(o.service, '')) LIKE '%merch%' THEN 'merch' ELSE 'standard' END,
       COALESCE(c.created_at, CURRENT_TIMESTAMP)
FROM orders_store o
JOIN wallet_legacy_claims c ON lower(c.legacy_username) = lower(o.customer_username)
WHERE c.status = 'claimed'
ON CONFLICT(order_id) DO UPDATE SET
  order_type = CASE
    WHEN lower(COALESCE((SELECT service FROM orders_store WHERE id = order_subject_links.order_id), '')) LIKE '%merch%'
    THEN 'merch'
    ELSE order_subject_links.order_type
  END;

CREATE TABLE IF NOT EXISTS talent_subjects (
  username TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_username_history (
  subject TEXT NOT NULL,
  old_username TEXT NOT NULL,
  new_username TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (subject, changed_at)
);

CREATE TABLE IF NOT EXISTS merch_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  tag TEXT NOT NULL DEFAULT 'OFFICIAL',
  image TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  stock INTEGER DEFAULT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merch_stock_control (
  product_id TEXT PRIMARY KEY,
  stock INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT OR IGNORE INTO merch_stock_control (product_id, stock, updated_at, updated_by)
SELECT id, stock, COALESCE(updated_at, CURRENT_TIMESTAMP), COALESCE(updated_by, 'migration')
FROM merch_products
WHERE stock IS NOT NULL AND stock > 0;
