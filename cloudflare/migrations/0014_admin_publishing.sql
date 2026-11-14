CREATE TABLE site_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 0,
 updated_by TEXT, change_reason TEXT NOT NULL DEFAULT ''
);
INSERT INTO site_settings(id) VALUES (1);
CREATE TRIGGER settings_audited AFTER UPDATE ON site_settings BEGIN
 INSERT INTO security_audit VALUES (lower(hex(randomblob(16))),NEW.updated_by,'admin.settings_updated','site',json_object('version',NEW.version,'reason',NEW.change_reason),NEW.updated_at);
END;
CREATE TABLE blog_posts (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 version INTEGER NOT NULL DEFAULT 1, author_id TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, published_at INTEGER
);
CREATE INDEX blog_public_order ON blog_posts(status,published_at DESC,id);
CREATE TRIGGER blog_post_limit BEFORE INSERT ON blog_posts
WHEN (SELECT COUNT(*) FROM blog_posts)>=500
BEGIN SELECT RAISE(ABORT,'blog_post_limit'); END;
CREATE TRIGGER blog_created_audited AFTER INSERT ON blog_posts BEGIN
 INSERT INTO security_audit VALUES(lower(hex(randomblob(16))),NEW.updated_by,'blog.created',NEW.id,json_object('status',NEW.status,'version',NEW.version),NEW.updated_at);
END;
CREATE TRIGGER blog_updated_audited AFTER UPDATE ON blog_posts BEGIN
 INSERT INTO security_audit VALUES(lower(hex(randomblob(16))),NEW.updated_by,CASE WHEN OLD.status!='published' AND NEW.status='published' THEN 'blog.published' WHEN OLD.status='published' AND NEW.status!='published' THEN 'blog.unpublished' ELSE 'blog.updated' END,NEW.id,json_object('status',NEW.status,'version',NEW.version),NEW.updated_at);
END;
