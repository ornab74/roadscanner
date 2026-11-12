CREATE TABLE garage_vehicles (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 profile TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, image_id TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX garage_owner ON garage_vehicles(user_id,deleted_at);
CREATE TABLE garage_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),active_vehicle_id TEXT);
CREATE TABLE garage_images(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX garage_image_expiry ON garage_images(expires_at);
CREATE TABLE aviation_cache(key TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at INTEGER NOT NULL);
