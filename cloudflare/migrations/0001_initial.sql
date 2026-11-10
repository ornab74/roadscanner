-- New installations only. Existing encrypted SQLite data requires an explicit
-- verified export/import; this schema does not silently migrate it.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  stripe_customer_id TEXT UNIQUE,
  updated_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE api_requests (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'refunded')),
  response_json TEXT,
  lease_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (api_key_id, idempotency_key)
);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL CHECK (delta != 0),
  reason TEXT NOT NULL,
  external_ref TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

CREATE TABLE stripe_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  event_created INTEGER NOT NULL,
  event_rank INTEGER NOT NULL,
  event_id TEXT NOT NULL
);

CREATE INDEX api_requests_expiry ON api_requests(status, lease_expires_at);
CREATE INDEX stripe_subscriptions_user ON stripe_subscriptions(user_id, status);
