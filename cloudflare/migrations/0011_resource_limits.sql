-- Enforce account quotas in the same database statement as the insert.
-- Existing records are preserved; this only guards additional allocations.
CREATE TRIGGER garage_vehicle_limit BEFORE INSERT ON garage_vehicles
WHEN NEW.deleted_at IS NULL AND
 (SELECT COUNT(*) FROM garage_vehicles WHERE user_id=NEW.user_id AND deleted_at IS NULL)>=20
BEGIN SELECT RAISE(ABORT,'garage_full'); END;

CREATE TRIGGER api_key_account_limit BEFORE INSERT ON api_keys
WHEN NEW.id NOT LIKE 'web:%' AND NEW.revoked_at IS NULL
 AND (NEW.expires_at IS NULL OR NEW.expires_at>unixepoch())
 AND (SELECT COUNT(*) FROM api_keys WHERE user_id=NEW.user_id
  AND id NOT LIKE 'web:%' AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at>unixepoch()))>=20
BEGIN SELECT RAISE(ABORT,'api_key_limit'); END;

CREATE TRIGGER security_key_account_limit BEFORE INSERT ON security_keys
WHEN (SELECT COUNT(*) FROM security_keys WHERE user_id=NEW.user_id)>=10
BEGIN SELECT RAISE(ABORT,'security_key_limit'); END;
