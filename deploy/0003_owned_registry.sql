-- New, separate CX5 registry ONLY. No legacy or v0.1 tables are altered.

CREATE TABLE IF NOT EXISTS cx5_devices (
  device_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, token_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS cx5_devices_owner ON cx5_devices(owner_id, created_at DESC);
CREATE TABLE IF NOT EXISTS cx5_versions (
  owner_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  kind TEXT NOT NULL, context_json TEXT NOT NULL, context_hash TEXT NOT NULL,
  envelope_sha256 TEXT NOT NULL, envelope_qrs2 TEXT,
  previous_hash TEXT NOT NULL, chain_hash TEXT NOT NULL,
  request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  pin_state TEXT NOT NULL CHECK(pin_state IN ('pending','leased','pinned','dead')),
  cid TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_after INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at INTEGER NOT NULL, pinned_at INTEGER,
  PRIMARY KEY(owner_id, record_id, version), UNIQUE(owner_id, request_key)
);
CREATE INDEX IF NOT EXISTS cx5_latest_owner ON cx5_versions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cx5_publish_due ON cx5_versions(pin_state, retry_after, lease_until);
CREATE TABLE IF NOT EXISTS cx5_budgets (
  budget_key TEXT NOT NULL, window_start INTEGER NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY(budget_key, window_start)
);
