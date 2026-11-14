-- Application-side R2 guard, not a Cloudflare-wide storage/billing limit.
-- Seed the current bucket inventory before setting initialized=1.
CREATE TABLE report_storage_budget (
 id INTEGER PRIMARY KEY CHECK(id=1),
 max_bytes INTEGER NOT NULL CHECK(max_bytes>0),
 max_objects INTEGER NOT NULL CHECK(max_objects>0),
 used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
 object_count INTEGER NOT NULL DEFAULT 0 CHECK(object_count>=0),
 initialized INTEGER NOT NULL DEFAULT 0 CHECK(initialized IN (0,1))
);
INSERT INTO report_storage_budget(id,max_bytes,max_objects) VALUES (1,1073741824,10000);
CREATE TABLE report_storage_objects (
 object_key TEXT PRIMARY KEY,
 byte_length INTEGER NOT NULL CHECK(byte_length>=0),
 state TEXT NOT NULL CHECK(state IN ('reserved','stored','deleting')),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER report_storage_quota BEFORE INSERT ON report_storage_objects
WHEN (SELECT initialized FROM report_storage_budget WHERE id=1)=1 AND (
 (SELECT used_bytes+NEW.byte_length>max_bytes OR object_count+1>max_objects FROM report_storage_budget WHERE id=1))
BEGIN SELECT RAISE(ABORT,'report_storage_full'); END;
CREATE TRIGGER report_storage_allocated AFTER INSERT ON report_storage_objects BEGIN
 UPDATE report_storage_budget SET used_bytes=used_bytes+NEW.byte_length,object_count=object_count+1 WHERE id=1;
END;
CREATE TRIGGER report_storage_immutable BEFORE UPDATE OF object_key,byte_length ON report_storage_objects
WHEN NEW.object_key<>OLD.object_key OR NEW.byte_length<>OLD.byte_length
BEGIN SELECT RAISE(ABORT,'report_storage_immutable'); END;
CREATE TRIGGER report_storage_released AFTER DELETE ON report_storage_objects BEGIN
 UPDATE report_storage_budget SET used_bytes=used_bytes-OLD.byte_length,object_count=object_count-1 WHERE id=1;
END;
