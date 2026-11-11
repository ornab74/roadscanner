-- Support grants are operator-inserted ledger entries, not purchases or user input.
-- The unique external_ref makes retries idempotent; the trigger settles atomically.
CREATE TRIGGER credit_ledger_support_grant
AFTER INSERT ON credit_ledger
WHEN NEW.reason='operator_support_grant' AND NEW.delta>0
BEGIN
 UPDATE accounts SET credits=credits+NEW.delta,updated_at=NEW.created_at WHERE user_id=NEW.user_id;
END;
