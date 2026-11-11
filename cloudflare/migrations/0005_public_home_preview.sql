CREATE TABLE public_home_previews (
  model TEXT PRIMARY KEY,
  payload TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER NOT NULL DEFAULT 0
);
