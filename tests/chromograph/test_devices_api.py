import hashlib
import json
import time
import threading
import pytest
from flask_wtf.csrf import generate_csrf
from test_registry import body


def csrf_headers(client,engine):
    with client.session_transaction() as session:
        token=session.get('csrf_token') or 'testing-csrf-session-token'
        session['csrf_token']=token
        # Test-client sessions are synthetic logins; model the snapshot that
        # the native sign-in wrapper now sets. Never refresh a changed hash for
        # the same account: that must still require a new real sign-in.
        resolver=getattr(engine,'get_user_id',None)
        snapshot_fn=getattr(engine,'_cx6_account_snapshot',None)
        if callable(resolver) and callable(snapshot_fn):
            uid=resolver(session.get('username',''))
            if uid is not None and (session.get('cx6_auth_user_id')!=uid or 'cx6_auth_fingerprint' not in session):
                snapshot=snapshot_fn(uid)
                session['cx6_auth_user_id']=snapshot['user_id']
                session['cx6_auth_fingerprint']=snapshot['auth_fingerprint']
    with engine.app.test_request_context('/'):
        from flask import session
        session['csrf_token']=token
        return {'X-CSRFToken':generate_csrf()}


def issue(client,registry,scopes):
    headers=csrf_headers(client,registry)
    response=client.post('/api/chromograph/v3/devices',json={'scopes':scopes},headers=headers)
    assert response.status_code==201,response.json
    return response.json


def test_device_tokens_are_hashed_expiring_scoped_and_revocable(client,registry,native_stub):
    result=issue(client,registry,['record:read','search:read'])
    token=result['token']
    row=registry._cx5_one('SELECT * FROM cx5_devices')
    assert row['token_hash']==hashlib.sha256(token.encode()).hexdigest()
    assert token not in str(row) and row['expires_at']>time.time()
    devices=client.get('/api/chromograph/v3/devices').json
    assert 'token_hash' not in str(devices) and token not in str(devices)
    auth={'Authorization':'Bearer '+token}
    assert client.post('/api/chromograph/v3/search',json={'query':{}},headers=auth).status_code==200
    denied=client.post('/api/chromograph/v3/records',json=body(native_stub()),headers={**auth,'Idempotency-Key':'request01'})
    assert denied.status_code==403
    assert client.post('/api/chromograph/v3/devices/'+result['device_id']+'/revoke',json={},headers=csrf_headers(client,registry)).status_code==200
    assert client.post('/api/chromograph/v3/search',json={'query':{}},headers=auth).status_code==401


def test_cookie_writes_need_csrf_bearer_writes_dont(client,registry,native_stub):
    # Manual CSRF is enforced even though the mixed-auth views must be globally
    # exempt to permit token-only mobile clients. Cookies alone never bypass it.
    registry.app.config['WTF_CSRF_ENABLED']=True
    data=body(native_stub())
    no_csrf=client.post('/api/chromograph/v3/records',json=data,headers={'Idempotency-Key':'request01'})
    assert no_csrf.status_code==400
    device=issue(client,registry,['record:write','record:read'])
    with client.session_transaction() as s:s.clear()
    auth={'Authorization':'Bearer '+device['token'],'Idempotency-Key':'request01'}
    created=client.post('/api/chromograph/v3/records',json=data,headers=auth)
    assert created.status_code==201 and created.json['record']['pin_state']=='pending'
    assert created.headers['X-Request-ID']
    assert client.get('/api/chromograph/v3/records/record-001?ciphertext=1',headers=auth).json['envelope']==data['envelope']


def test_invalid_bearer_cannot_fall_back_to_admin_cookie(client,registry):
    response=client.post('/api/chromograph/v3/search',json={'query':{}},
                         headers={'Authorization':'Bearer invalid'})
    assert response.status_code==401


def test_no_device_can_issue_credentials_or_run_admin_jobs(client,registry):
    result=issue(client,registry,['record:read'])
    headers={'Authorization':'Bearer '+result['token']}
    assert client.post('/api/chromograph/v3/devices',json={'scopes':['record:write']},headers=headers).status_code==403
    assert client.post('/api/chromograph/v3/admin/publish-next',json={},headers=headers).status_code==403


def test_owner_namespace_prevents_cross_account_reads(client,registry,native_stub):
    a=issue(client,registry,['record:write','record:read'])
    token_a={'Authorization':'Bearer '+a['token']}
    assert client.post('/api/chromograph/v3/records',json=body(native_stub()),
                       headers={**token_a,'Idempotency-Key':'alice-write-1'}).status_code==201
    with client.session_transaction() as s:s['username']='bob';s['is_admin']=False
    b=issue(client,registry,['record:read'])
    denied=client.get('/api/chromograph/v3/records/record-001',headers={'Authorization':'Bearer '+b['token']})
    assert denied.status_code==404
    # Scope is bound to the principal in the token, not a supplied session user.
    assert client.get('/api/chromograph/v3/records/record-001',headers=token_a).status_code==200


def test_device_expiry_checked_each_request(client,registry,monkeypatch):
    token=issue(client,registry,['search:read'])['token']
    registry._cx5_db().query('UPDATE cx5_devices SET expires_at=0')
    assert client.post('/api/chromograph/v3/search',json={'query':{}},headers={'Authorization':'Bearer '+token}).status_code==401


def test_durable_quota_shared_between_two_database_handles(registry):
    # Different handles see the same durable quota. Equivalent to two workers
    # sharing D1 / an explicitly persistent local staging database.
    path=registry._cx5_db().path
    a=registry._CX5SQLite(path);b=registry._CX5SQLite(path)
    sql='''INSERT INTO cx5_budgets(budget_key,window_start,used) VALUES (?,?,1)
        ON CONFLICT(budget_key,window_start) DO UPDATE SET used=used+1 WHERE used<? RETURNING used'''
    assert a.query(sql,('owner-bucket',0,2))['results'][0]['used']==1
    assert b.query(sql,('owner-bucket',0,2))['results'][0]['used']==2
    assert a.query(sql,('owner-bucket',0,2))['results']==[]


def test_api_retries_and_ownership_filter(client,registry,native_stub):
    headers={**csrf_headers(client,registry),'Idempotency-Key':'request-0001'}
    data=body(native_stub())
    first=client.post('/api/chromograph/v3/records',json=data,headers=headers)
    second=client.post('/api/chromograph/v3/records',json=data,headers=headers)
    assert first.status_code==201 and second.status_code==200
    assert client.get('/api/chromograph/v3/records/record-001/versions').json['versions'][0]['version']==1
    found=client.post('/api/chromograph/v3/search',json={'query':{'rgb':'#3366aa'}},headers=csrf_headers(client,registry)).json
    assert found['results'][0]['record_id']=='record-001' and found['results'][0]['version']==1


def test_fail_closed_without_registry_enable(client,engine):
    assert client.get('/api/chromograph/v3/devices').status_code==404


def test_deleted_legacy_account_cannot_issue_credentials(client,registry,monkeypatch):
    monkeypatch.setattr(registry,'get_user_id',lambda user:None,raising=False)
    result=client.post('/api/chromograph/v3/devices',json={'scopes':['record:read']},headers=csrf_headers(client,registry))
    assert result.status_code==401


def test_scoped_registry_retires_shared_legacy_relay(client,registry,monkeypatch):
    monkeypatch.setenv('ROADSCANNER_CX_EXTERNAL_AI_ENABLED','1')
    monkeypatch.setenv('ROADSCANNER_CX_RELAY_TOKEN','legacy-token-that-is-at-least-32-characters')
    result=client.post('/v1/route-engine/analyze',json={},
          headers={'Authorization':'Bearer legacy-token-that-is-at-least-32-characters'})
    assert result.status_code==410
    assert result.json['error']=='use_scoped_device_ai_endpoint'


def test_cannot_revoke_other_users_device(client,registry):
    issued=issue(client,registry,['record:read'])
    with client.session_transaction() as s:s['username']='bob'
    result=client.post('/api/chromograph/v3/devices/'+issued['device_id']+'/revoke',json={},headers=csrf_headers(client,registry))
    assert result.status_code==404


def test_scoped_status_omits_tokens_and_credentials(client,registry,monkeypatch):
    monkeypatch.setenv('PINATA_JWT','private-test-pinata-secret')
    result=client.get('/api/chromograph/v3/status')
    assert result.status_code==200 and result.json['version']=='0.5'
    assert result.json['pinning_secret_configured'] is True
    assert 'private-test-pinata-secret' not in str(result.json)


def test_scoped_ai_pipeline_server_weather_overrides_client(client,registry,monkeypatch):
    token=issue(client,registry,['ai:analyze'])['token']
    monkeypatch.setenv('ROADSCANNER_CX_DEVICE_AI_ENABLED','1')
    monkeypatch.setattr(registry,'_cx_live_context',lambda *a,**kw:{
        'weather':{'wind_gust_kph':90.,'precipitation_mm':5.,'visibility_km':1.},
        'circuit':{'weather_gate':'NO_GO','reasons':['gust_threshold_exceeded']}})
    request={'privacy_ack':True,'location_ack':True,'offer':{'pay':12,'displayed_miles':4},
             'weather':{'wind_gust_kph':0,'precipitation_mm':0.,'visibility_km':50.},
             'current_position':{'lat':33.5,'lon':-86.8}}
    response=client.post('/api/chromograph/v3/ai/analyze',json=request,headers={'Authorization':'Bearer '+token})
    assert response.status_code==200
    assert response.json['weather_gate']=='NO_GO' and response.json['verdict']=='HARD_SKIP'
    assert response.json['model']=='deterministic_weather_gate'


def test_device_cannot_bypass_missing_namespace_configuration(client,registry,monkeypatch):
    token=issue(client,registry,['search:read'])['token']
    monkeypatch.delenv('ROADSCANNER_CX_OWNER_KEY')
    result=client.post('/api/chromograph/v3/search',json={'query':{}},headers={'Authorization':'Bearer '+token})
    assert result.status_code==503
