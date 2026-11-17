-- Disabled until the operator explicitly opens the public trial.
CREATE TABLE free_scan_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 web_daily INTEGER NOT NULL DEFAULT 5 CHECK(web_daily BETWEEN 0 AND 5),
 api_lifetime INTEGER NOT NULL DEFAULT 3 CHECK(api_lifetime BETWEEN 0 AND 3),
 global_daily INTEGER NOT NULL DEFAULT 50 CHECK(global_daily BETWEEN 0 AND 50),
 global_monthly INTEGER NOT NULL DEFAULT 500 CHECK(global_monthly BETWEEN 0 AND 500)
);
INSERT INTO free_scan_policy(id) VALUES(1);
CREATE TABLE free_scan_usage (
 request_id TEXT PRIMARY KEY REFERENCES api_requests(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 channel TEXT NOT NULL CHECK(channel IN ('web','api')),
 day TEXT NOT NULL, month TEXT NOT NULL
);
CREATE INDEX free_usage_user_channel_day ON free_scan_usage(user_id,channel,day);
CREATE INDEX free_usage_day ON free_scan_usage(day);
CREATE INDEX free_usage_month ON free_scan_usage(month);
DROP TRIGGER reserve_credit;
CREATE TRIGGER reserve_credit AFTER INSERT ON api_requests WHEN NEW.status='reserved'
BEGIN
 INSERT INTO free_scan_usage(request_id,user_id,channel,day,month)
 SELECT NEW.id,NEW.user_id,CASE WHEN NEW.api_key_id='web:'||NEW.user_id THEN 'web' ELSE 'api' END,strftime('%Y-%m-%d','now'),strftime('%Y-%m','now')
 FROM free_scan_policy p WHERE p.id=1 AND p.enabled=1 AND NEW.operation_kind IN ('route','scan')
 AND (NEW.api_key_id='web:'||NEW.user_id AND (SELECT count(*) FROM free_scan_usage WHERE user_id=NEW.user_id AND channel='web' AND day=strftime('%Y-%m-%d','now'))<p.web_daily
 OR NEW.api_key_id NOT LIKE 'web:%' AND (SELECT count(*) FROM free_scan_usage WHERE user_id=NEW.user_id AND channel='api')<p.api_lifetime)
 AND (SELECT count(*) FROM free_scan_usage WHERE day=strftime('%Y-%m-%d','now'))<p.global_daily
 AND (SELECT count(*) FROM free_scan_usage WHERE month=strftime('%Y-%m','now'))<p.global_monthly;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM free_scan_usage WHERE request_id=NEW.id)
 AND NOT EXISTS(SELECT 1 FROM accounts WHERE user_id=NEW.user_id AND credits>0)
 THEN RAISE(ABORT,'reservation_not_allowed') END;
 UPDATE accounts SET credits=credits-1,updated_at=NEW.created_at WHERE user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM free_scan_usage WHERE request_id=NEW.id);
 INSERT INTO credit_ledger(id,user_id,delta,reason,external_ref,created_at)
 SELECT 'debit:'||NEW.id,NEW.user_id,-1,'scan','debit:'||NEW.id,NEW.created_at WHERE NOT EXISTS(SELECT 1 FROM free_scan_usage WHERE request_id=NEW.id);
END;
DROP TRIGGER refund_credit;
CREATE TRIGGER refund_credit AFTER UPDATE OF status ON api_requests
WHEN OLD.status='reserved' AND NEW.status='refunded' AND NOT EXISTS(SELECT 1 FROM free_scan_usage WHERE request_id=NEW.id)
BEGIN
 UPDATE accounts SET credits=credits+1,updated_at=NEW.updated_at WHERE user_id=NEW.user_id;
 INSERT INTO credit_ledger(id,user_id,delta,reason,external_ref,created_at) VALUES('refund:'||NEW.id,NEW.user_id,1,'scan_refund','refund:'||NEW.id,NEW.updated_at);
END;
-- Attempts stay counted after failure/refund: provider work can still cost money.
CREATE TRIGGER free_usage_immutable BEFORE UPDATE ON free_scan_usage BEGIN SELECT RAISE(ABORT,'free_usage_immutable'); END;
