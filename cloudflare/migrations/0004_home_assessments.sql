CREATE TABLE home_assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_request_id TEXT NOT NULL REFERENCES api_requests(id),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','completed','failed')),
  lease_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id,source_request_id,model)
);
