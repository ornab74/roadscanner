-- A reservation and its debit are one SQLite statement/transaction. A failed
-- trigger rolls the entire insert back, including the ledger entry.
CREATE TRIGGER reserve_credit AFTER INSERT ON api_requests
WHEN NEW.status = 'reserved'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM api_keys k JOIN accounts a ON a.user_id = k.user_id
    WHERE k.id = NEW.api_key_id AND k.user_id = NEW.user_id
      AND k.revoked_at IS NULL AND a.credits > 0
  ) THEN RAISE(ABORT, 'reservation_not_allowed') END;
  UPDATE accounts SET credits = credits - 1, updated_at = NEW.created_at
    WHERE user_id = NEW.user_id;
  INSERT INTO credit_ledger(id, user_id, delta, reason, external_ref, created_at)
    VALUES ('debit:' || NEW.id, NEW.user_id, -1, 'scan', 'debit:' || NEW.id, NEW.created_at);
END;

CREATE TRIGGER validate_request_insert BEFORE INSERT ON api_requests
WHEN NEW.status != 'reserved'
BEGIN SELECT RAISE(ABORT, 'invalid_initial_status'); END;

CREATE TRIGGER validate_request_transition BEFORE UPDATE OF status ON api_requests
WHEN NOT (OLD.status = 'reserved' AND NEW.status IN ('completed', 'refunded'))
     AND NEW.status != OLD.status
BEGIN SELECT RAISE(ABORT, 'invalid_status_transition'); END;

CREATE TRIGGER refund_credit AFTER UPDATE OF status ON api_requests
WHEN OLD.status = 'reserved' AND NEW.status = 'refunded'
BEGIN
  UPDATE accounts SET credits = credits + 1, updated_at = NEW.updated_at
    WHERE user_id = NEW.user_id;
  INSERT INTO credit_ledger(id, user_id, delta, reason, external_ref, created_at)
    VALUES ('refund:' || NEW.id, NEW.user_id, 1, 'scan_refund', 'refund:' || NEW.id, NEW.updated_at);
END;

CREATE TRIGGER request_identity_immutable BEFORE UPDATE OF id, api_key_id, user_id, idempotency_key ON api_requests
BEGIN SELECT RAISE(ABORT, 'request_identity_immutable'); END;
