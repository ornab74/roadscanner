import pathlib
import sqlite3
import unittest


class CreditInvariantTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        for path in sorted((pathlib.Path(__file__).resolve().parents[1] / 'cloudflare/migrations').glob('*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO users VALUES ('u','u@example.test',1)")
        self.db.execute("INSERT INTO accounts(user_id,credits,updated_at) VALUES ('u',1,1)")
        self.db.execute("INSERT INTO api_keys(id,user_id,key_hash,created_at) VALUES ('k','u','hash',1)")

    def reserve(self, request_id, key='k', user='u', idem='unique'):
        self.db.execute("INSERT INTO api_requests(id,api_key_id,user_id,idempotency_key,status,lease_expires_at,created_at,updated_at) VALUES (?,?,?,?,'reserved',100,1,1)", (request_id, key, user, idem))

    def test_reservation_and_refund_are_exactly_once(self):
        self.reserve('r')
        self.assertEqual(self.db.execute('SELECT credits FROM accounts').fetchone()[0], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.reserve('r2', idem='another')
        self.db.execute("UPDATE api_requests SET status='refunded',updated_at=2 WHERE id='r'")
        self.db.execute("UPDATE api_requests SET status='refunded' WHERE id='r'")
        self.assertEqual(self.db.execute('SELECT credits FROM accounts').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM credit_ledger').fetchone()[0], 2)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE api_requests SET status='completed' WHERE id='r'")

    def test_duplicate_and_wrong_owner_do_not_debit(self):
        self.db.execute("INSERT INTO users VALUES ('v','v@example.test',1)")
        self.db.execute("INSERT INTO accounts(user_id,credits,updated_at) VALUES ('v',1,1)")
        with self.assertRaises(sqlite3.IntegrityError):
            self.reserve('wrong', user='v')
        self.reserve('r')
        with self.assertRaises(sqlite3.IntegrityError):
            self.reserve('duplicate')
        self.assertEqual(self.db.execute("SELECT credits FROM accounts WHERE user_id='v'").fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
