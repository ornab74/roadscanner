CREATE TABLE terms_acceptances (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 terms_version TEXT NOT NULL, document_sha256 TEXT NOT NULL,
 accepted_at INTEGER NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('registration','account')),
 PRIMARY KEY(user_id,terms_version,document_sha256)
);
CREATE TRIGGER terms_acceptance_audited AFTER INSERT ON terms_acceptances BEGIN
 INSERT INTO security_audit VALUES(lower(hex(randomblob(16))),NEW.user_id,'terms.accepted',NEW.terms_version,json_object('sha256',NEW.document_sha256,'method',NEW.method),NEW.accepted_at);
END;
