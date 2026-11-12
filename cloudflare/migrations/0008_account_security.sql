-- Public-key credentials only. Private passkey material never reaches the app.
CREATE TABLE security_keys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL,
 transports TEXT NOT NULL, backed_up INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE INDEX security_keys_user ON security_keys(user_id);
CREATE TABLE security_challenges (
 id TEXT PRIMARY KEY, user_id TEXT, binding TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('register','authenticate')),
 challenge TEXT NOT NULL, name TEXT, expires_at INTEGER NOT NULL
);
CREATE TABLE user_roles (
 user_id TEXT PRIMARY KEY REFERENCES users(id), role TEXT NOT NULL CHECK(role='admin'), created_at INTEGER NOT NULL
);
CREATE TABLE security_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 target_id TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX security_audit_time ON security_audit(created_at);
ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT 'API key';
ALTER TABLE api_keys ADD COLUMN expires_at INTEGER;
ALTER TABLE api_keys ADD COLUMN last_used_at INTEGER;
ALTER TABLE sessions ADD COLUMN created_at INTEGER;
ALTER TABLE sessions ADD COLUMN elevated_until INTEGER NOT NULL DEFAULT 0;
