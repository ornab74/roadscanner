-- Recheck credentials at the atomic debit boundary, not only at HTTP admission.
-- Database time prevents stale/caller-supplied request timestamps extending a key.
-- Existing requests and balances are preserved; only new allocations are guarded.
CREATE TRIGGER request_key_current BEFORE INSERT ON api_requests
WHEN NEW.status='reserved' AND NOT EXISTS (
 SELECT 1 FROM api_keys k WHERE k.id=NEW.api_key_id AND k.user_id=NEW.user_id
 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>unixepoch())
)
BEGIN SELECT RAISE(ABORT,'api_key_no_longer_valid'); END;
