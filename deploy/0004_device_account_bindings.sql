-- Additive CX6 bindings in the separate CX registry only.

CREATE TABLE IF NOT EXISTS cx6_device_subjects (
  device_id TEXT PRIMARY KEY,
  legacy_user_id INTEGER NOT NULL,
  auth_fingerprint TEXT NOT NULL,
  bound_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cx6_subject_devices ON cx6_device_subjects(legacy_user_id);
