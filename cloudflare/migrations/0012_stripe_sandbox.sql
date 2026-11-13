-- Explicitly sandbox-only. No live-payment path is enabled by this migration.
CREATE TABLE billing_test_access (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL
);
CREATE TABLE billing_customers (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 customer_id TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);
CREATE TABLE billing_orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 product TEXT NOT NULL CHECK(product IN ('credits','pro')), price_id TEXT NOT NULL,
 credits INTEGER NOT NULL CHECK(credits>0 AND credits<=1000000),
 customer_id TEXT NOT NULL, session_id TEXT UNIQUE, status TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX billing_orders_user ON billing_orders(user_id,created_at);
CREATE UNIQUE INDEX billing_one_pending_checkout ON billing_orders(user_id,product) WHERE status IN ('creating','open');
CREATE TABLE billing_catalog (
 price_id TEXT PRIMARY KEY, product TEXT NOT NULL, credits INTEGER NOT NULL CHECK(credits>0 AND credits<=1000000)
);
CREATE TABLE billing_subscriptions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 customer_id TEXT NOT NULL, status TEXT NOT NULL, event_created INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE billing_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at INTEGER NOT NULL,
 processed_at INTEGER NOT NULL
);
CREATE TABLE billing_grants (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source TEXT NOT NULL, credits INTEGER NOT NULL CHECK(credits>0 AND credits<=1000000),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER billing_grant_credit AFTER INSERT ON billing_grants
BEGIN
 INSERT INTO credit_ledger(id,user_id,delta,reason,external_ref,created_at)
 VALUES ('billing:'||NEW.id,NEW.user_id,NEW.credits,'stripe_sandbox_credit','billing:'||NEW.id,NEW.created_at);
 UPDATE accounts SET credits=credits+NEW.credits,updated_at=NEW.created_at WHERE user_id=NEW.user_id;
END;
CREATE TABLE billing_holds (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reason TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at INTEGER NOT NULL
);
CREATE INDEX billing_holds_user ON billing_holds(user_id,active);
CREATE TRIGGER billing_hold_reservation BEFORE INSERT ON api_requests
WHEN NEW.status='reserved' AND EXISTS(SELECT 1 FROM billing_holds WHERE user_id=NEW.user_id AND active=1)
BEGIN SELECT RAISE(ABORT,'billing_account_restricted'); END;
