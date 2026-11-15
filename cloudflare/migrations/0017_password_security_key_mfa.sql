CREATE TABLE password_login_intents (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 browser_binding TEXT NOT NULL UNIQUE,
 credential_fingerprint TEXT NOT NULL,
 session_hash TEXT,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX password_login_intents_expiry ON password_login_intents(expires_at);
ALTER TABLE security_challenges ADD COLUMN login_intent_hash TEXT;
ALTER TABLE sessions ADD COLUMN mfa_key_id TEXT;
ALTER TABLE sessions ADD COLUMN mfa_verified_at INTEGER;
ALTER TABLE sessions ADD COLUMN login_intent_hash TEXT;
CREATE UNIQUE INDEX session_one_password_intent ON sessions(login_intent_hash) WHERE login_intent_hash IS NOT NULL;
CREATE TRIGGER session_consume_password_intent AFTER INSERT ON sessions
WHEN NEW.login_intent_hash IS NOT NULL BEGIN
 DELETE FROM password_login_intents WHERE token_hash=NEW.login_intent_hash;
END;
CREATE TRIGGER password_change_revokes_intents AFTER UPDATE OF password_hash,password_salt ON user_credentials
WHEN OLD.password_hash<>NEW.password_hash OR OLD.password_salt<>NEW.password_salt BEGIN
 DELETE FROM password_login_intents WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER security_key_added_reauthenticate AFTER INSERT ON security_keys BEGIN
 DELETE FROM sessions WHERE user_id=NEW.user_id;
 DELETE FROM password_login_intents WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER security_key_removed_reauthenticate AFTER DELETE ON security_keys BEGIN
 DELETE FROM sessions WHERE user_id=OLD.user_id;
 DELETE FROM password_login_intents WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER security_key_replaced_reauthenticate AFTER UPDATE OF user_id,public_key ON security_keys
WHEN OLD.user_id<>NEW.user_id OR OLD.public_key<>NEW.public_key BEGIN
 DELETE FROM sessions WHERE user_id IN (OLD.user_id,NEW.user_id);
 DELETE FROM password_login_intents WHERE user_id IN (OLD.user_id,NEW.user_id);
END;
-- Existing key-only/password-only sessions do not satisfy the new two-factor policy.
DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM security_keys);
DELETE FROM security_challenges WHERE purpose='authenticate';
