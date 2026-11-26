ALTER TABLE client_errors ADD COLUMN error_code TEXT NOT NULL DEFAULT 'CN-UI-000';
ALTER TABLE client_errors ADD COLUMN request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE client_errors ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';
ALTER TABLE client_errors ADD COLUMN action TEXT NOT NULL DEFAULT '';
ALTER TABLE client_errors ADD COLUMN endpoint TEXT NOT NULL DEFAULT '';
ALTER TABLE client_errors ADD COLUMN http_status INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_client_errors_scope_ts ON client_errors (scope, ts DESC);
CREATE INDEX IF NOT EXISTS idx_client_errors_code ON client_errors (error_code);
