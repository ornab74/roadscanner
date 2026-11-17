CREATE TABLE user_onboarding (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version=1),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','skipped')),
 updated_at INTEGER NOT NULL
);
-- Existing users are not forced into a new-user tour. They may open Quick start.
