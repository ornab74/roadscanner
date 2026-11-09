import hashlib
import sqlite3
import time
import pytest
from test_devices_api import issue,csrf_headers


def change(registry,sql,params=()):
    with sqlite3.connect(registry.DB_FILE) as db:db.execute(sql,params)


def search(client,token):
    return client.post('/api/chromograph/v3/search',json={'query':{}},headers={'Authorization':'Bearer '+token})


def test_deleted_account_invalidates_and_persistently_revokes_device(client,registry):
    token=issue(client,registry,['search:read'])['token']
    change(registry,'DELETE FROM users WHERE id=1')
    result=search(client,token)
    assert result.status_code==401
    assert result.json['error']=='device_account_changed_or_reissue_required'
    assert registry._cx5_one('SELECT revoked_at FROM cx5_devices')['revoked_at'] is not None


@pytest.mark.parametrize('sql,params',[
    ('UPDATE users SET password=? WHERE id=1',('new-password-hash',)),
    ('UPDATE users SET is_admin=0 WHERE id=1',()),
    ('UPDATE users SET webauthn_user_handle=? WHERE id=1',(b'new-handle',)),
    ('INSERT INTO webauthn_credentials VALUES(1,1,?,?,0,?)',(b'new-credential',b'public-data','phone')),
])
def test_authentication_material_changes_invalidate_device(client,registry,sql,params):
    token=issue(client,registry,['search:read'])['token']
    change(registry,sql,params)
    assert search(client,token).status_code==401


def test_normal_passkey_counter_and_label_updates_keep_device_valid(client,registry):
    change(registry,'INSERT INTO webauthn_credentials VALUES(1,1,?,?,0,?)',(b'cred-id',b'public-data','Phone'))
    token=issue(client,registry,['search:read'])['token']
    change(registry,"UPDATE webauthn_credentials SET sign_count=sign_count+1,label='Renamed phone' WHERE id=1")
    assert search(client,token).status_code==200
    change(registry,'DELETE FROM webauthn_credentials WHERE id=1')
    assert search(client,token).status_code==401


def test_other_account_change_does_not_invalidate_owner(client,registry):
    token=issue(client,registry,['search:read'])['token']
    change(registry,"UPDATE users SET password='new-bob-hash' WHERE id=2")
    assert search(client,token).status_code==200


def test_old_unbound_v05_device_cannot_authenticate(client,registry):
    token='rsd1.'+'a'*32+'.'+'B'*43
    registry._cx5_db().query('''INSERT INTO cx5_devices(device_id,owner_id,token_hash,scopes_json,created_at,expires_at)
       VALUES(?,?,?,?,?,?)''',('a'*32,'legacy-owner',hashlib.sha256(token.encode()).hexdigest(),'["search:read"]',0,int(time.time())+3600))
    assert search(client,token).status_code==401


def test_recent_signin_required_for_credential_issuance(client,registry):
    with client.session_transaction() as s:s['auth_time']=0
    response=client.post('/api/chromograph/v3/devices',json={'scopes':['record:read']},headers=csrf_headers(client,registry))
    assert response.status_code==403
    assert response.json['error']=='recent_login_required_for_device_issuance'


def test_account_store_outage_fails_closed_without_deleting_store(client,registry,monkeypatch,tmp_path):
    token=issue(client,registry,['search:read'])['token']
    missing=tmp_path/'not-a-real-auth.db'
    monkeypatch.setattr(registry,'DB_FILE',missing)
    assert search(client,token).status_code==503
    assert not missing.exists()


def test_partial_binding_failure_never_discloses_secret(client,registry,monkeypatch):
    db=registry._cx5_db();original=db.query
    def query(sql,params=()):
        if sql.startswith('INSERT INTO cx6_device_subjects'):raise RuntimeError('simulated D1 outage')
        return original(sql,params)
    monkeypatch.setattr(db,'query',query)
    result=client.post('/api/chromograph/v3/devices',json={'scopes':['record:read']},headers=csrf_headers(client,registry))
    assert result.status_code==503 and 'token' not in result.json
    assert registry._cx5_one('SELECT revoked_at FROM cx5_devices')['revoked_at'] is not None


def test_binding_contains_no_raw_password_hash_or_username(client,registry):
    issue(client,registry,['search:read'])
    row=registry._cx5_one('SELECT * FROM cx6_device_subjects')
    assert row['legacy_user_id']==1
    assert len(row['auth_fingerprint'])==64
    assert 'test-hash-alice' not in str(row) and 'alice' not in str(row)


def test_stale_recent_browser_cookie_cannot_reissue_after_password_change(client,registry):
    issue(client,registry,['search:read'])
    change(registry,"UPDATE users SET password='new-current-hash' WHERE id=1")
    result=client.post('/api/chromograph/v3/devices',json={'scopes':['record:read']},headers=csrf_headers(client,registry))
    assert result.status_code==403
    assert result.json['error']=='sign_in_again_for_device_issuance'


def test_old_browser_session_without_login_snapshot_must_sign_in_again(client,registry):
    headers=csrf_headers(client,registry)
    with client.session_transaction() as s:
        s.pop('cx6_auth_user_id',None);s.pop('cx6_auth_fingerprint',None)
    response=client.post('/api/chromograph/v3/devices',json={'scopes':['record:read']},headers=headers)
    assert response.status_code==403
    assert response.json['error']=='sign_in_again_for_device_issuance'


def test_real_legacy_session_helper_captures_account_snapshot(registry):
    with registry.app.test_request_context('/'):
        from flask import session
        registry._establish_authenticated_session('alice',True,'password')
        assert session['username']=='alice' and session['auth_method']=='password'
        assert session['cx6_auth_user_id']==1
        assert session['cx6_auth_fingerprint']==registry._cx6_account_snapshot(1)['auth_fingerprint']
        assert registry._cx6_session_binding()['user_id']==1


def test_login_binding_outage_keeps_native_session_but_blocks_credential_issuance(registry,monkeypatch):
    def fail(*args):raise RuntimeError('auth snapshot unavailable')
    monkeypatch.setattr(registry,'_cx6_account_snapshot',fail)
    with registry.app.test_request_context('/'):
        from flask import session
        registry._establish_authenticated_session('alice',True,'password')
        assert session['username']=='alice'
        assert 'cx6_auth_fingerprint' not in session
        with pytest.raises(RuntimeError):registry._cx6_session_binding()
