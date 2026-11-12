ALTER TABLE api_keys ADD COLUMN scopes TEXT NOT NULL DEFAULT '["account:read","scans:read","scans:write","routes:write","garage:read","garage:write","images:read","images:write","aviation:read","aviation:review","operations:read"]';
ALTER TABLE api_requests ADD COLUMN operation_kind TEXT NOT NULL DEFAULT 'scan';
UPDATE api_requests SET operation_kind='image' WHERE api_key_id LIKE 'web:garage:%';
CREATE INDEX requests_owner_order ON api_requests(user_id,created_at DESC);
-- Preserve correct classification if an older deployed Worker finishes an image
-- request while the new Worker is being rolled out.
CREATE TRIGGER classify_legacy_garage_image AFTER INSERT ON api_requests
WHEN NEW.api_key_id LIKE 'web:garage:%' AND NEW.operation_kind='scan'
BEGIN
 UPDATE api_requests SET operation_kind='image' WHERE id=NEW.id;
END;
