import threading
import time
import json
from datetime import datetime,timezone
import pytest
from flask_wtf.csrf import generate_csrf
from conftest import weather_payload


def test_lru_ttl_does_not_serve_stale(engine):
    clock=[0.]
    cache=engine._CX4Cache(capacity=2,max_bytes=8,clock=lambda:clock[0])
    calls=[]
    def loader():calls.append(1);return b'abc'
    assert cache.get_or_load('a',loader,ttl=3)==b'abc'
    assert cache.get_or_load('a',loader,ttl=3)==b'abc'
    assert len(calls)==1 and cache.hits==1
    clock[0]=4
    assert cache.get_or_load('a',loader,ttl=3)==b'abc'
    assert len(calls)==2
    cache.get_or_load('b',lambda:b'def',3)
    cache.get_or_load('c',lambda:b'ghi',3)
    assert len(cache.data)==2 and cache.size==6 and 'a' not in cache.data


def test_cache_singleflight_coalesces_concurrent_requests(engine):
    cache=engine._CX4Cache()
    started=threading.Event();release=threading.Event();results=[];calls=[]
    def loader():
        calls.append(1);started.set();assert release.wait(2);return b'value'
    first=threading.Thread(target=lambda:results.append(cache.get_or_load('same',loader)))
    first.start();assert started.wait(1)
    followers=[threading.Thread(target=lambda:results.append(cache.get_or_load('same',loader))) for _ in range(3)]
    for thread in followers:thread.start()
    release.set()
    for thread in [first,*followers]:thread.join(2);assert not thread.is_alive()
    assert results==[b'value']*4 and len(calls)==1
    assert not cache.inflight


def test_failed_load_does_not_deadlock_or_publish_value(engine):
    cache=engine._CX4Cache()
    def fail():raise ValueError('failure')
    with pytest.raises(ValueError):cache.get_or_load('a',fail)
    assert cache.get_or_load('a',lambda:b'ok')==b'ok'
    assert not cache.inflight


@pytest.mark.parametrize('url',[
 'http://api.open-meteo.com/v1/forecast',
 'https://evil.invalid/v1/forecast',
 'https://api.open-meteo.com@127.0.0.1/v1/forecast',
 'https://api.open-meteo.com/v1/forecast#ignore',
 'https://tilecache.rainviewer.com/v2/radar/1700000000/256/8/1/1/2/0_0.png',
 'https://tilecache.rainviewer.com:444/v2/radar/1700000000/256/7/1/1/2/0_0.png',
 'https://api.rainviewer.com/public/weather-maps.json?host=evil',
])
def test_url_allowlist_prevents_client_fetches(engine,url):
    assert engine._cx4_url_allowed(url) is False
    with pytest.raises(ValueError):engine._cx4_fetch(url)


def test_provider_circuit_breaker_stops_repeated_calls(engine,monkeypatch):
    import httpx
    calls=[]
    def bad(*args,**kwargs):calls.append(1);raise RuntimeError('outage')
    monkeypatch.setattr(httpx,'stream',bad)
    url='https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0'
    for _ in range(3):
        with pytest.raises(RuntimeError):engine._cx4_network_bytes(url)
    with pytest.raises(RuntimeError,match='circuit_open'):engine._cx4_network_bytes(url)
    assert len(calls)==3


def test_rate_limiting_and_admin_readiness(client,engine):
    ready=client.get('/api/chromograph/v2/readiness')
    assert ready.status_code==200 and ready.json['production_ready'] is False
    for _ in range(24):assert client.post('/api/chromograph/v2/descriptor',json={}).status_code==200
    denied=client.post('/api/chromograph/v2/descriptor',json={})
    assert denied.status_code==429 and denied.headers['Retry-After']=='30'
    with client.session_transaction() as s:s['is_admin']=False
    assert client.get('/api/chromograph/v2/readiness').status_code==403


def test_feature_flag_and_auth_fail_closed(client,engine,monkeypatch):
    with client.session_transaction() as s:s.clear()
    assert client.post('/api/chromograph/v2/descriptor',json={}).status_code==401
    monkeypatch.delenv('ROADSCANNER_CX_ENABLED')
    assert client.post('/api/chromograph/v2/descriptor',json={}).status_code==404
    assert client.get('/api/chromograph/status').json['enabled'] is False


def test_csrf_preserved_for_cookie_auth(client,engine):
    engine.app.config['WTF_CSRF_ENABLED']=True
    assert client.post('/api/chromograph/v2/descriptor',json={}).status_code==400
    with client.session_transaction() as s:
        s['csrf_token']='test-csrf-session-token'
    # Generate token in request context carrying a session token signed with same key.
    with engine.app.test_request_context('/'):
        from flask import session
        session['csrf_token']='test-csrf-session-token'
        token=generate_csrf()
    assert client.post('/api/chromograph/v2/descriptor',json={},headers={'X-CSRFToken':token}).status_code==200


def test_bearer_route_never_accepts_browser_session(client,engine,monkeypatch):
    engine.app.config['WTF_CSRF_ENABLED']=True
    monkeypatch.setenv('ROADSCANNER_CX_EXTERNAL_AI_ENABLED','1')
    monkeypatch.setenv('ROADSCANNER_CX_RELAY_TOKEN','test-token-0123456789abcdef0123456789abcdef')
    assert client.post('/v1/route-engine/analyze',json={}).status_code==401
    # Correct bearer is exempt from cookie CSRF, and still needs consent/body validation.
    result=client.post('/v1/route-engine/analyze',json={},headers={'Authorization':'Bearer test-token-0123456789abcdef0123456789abcdef'})
    assert result.status_code==400


def test_external_ai_not_called_when_unsafe_or_unknown(engine,monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    raw,model=engine._cx4_external_ai({'estimated_minutes':20},{'weather_gate':'NO_GO','reasons':['wind']})
    assert raw['verdict']=='HARD_SKIP' and model=='deterministic_weather_gate'
    raw,model=engine._cx4_external_ai({}, {'weather_gate':'UNKNOWN','reasons':['missing']})
    assert raw['verdict']=='BORDERLINE'


def test_summary_and_safety_reasons_agree(engine):
    features={'pay':12,'estimated_minutes':20}
    gate={'weather_gate':'NO_GO','reasons':['gust_threshold_exceeded']}
    result=engine._cx4_finalize({'verdict':'STRONG_TAKE','score':1,'reasons':['great deal']*6,
                              'headline':'accept now','spoken_summary':'TAKE'},features,gate,'stub')
    assert result['verdict']=='HARD_SKIP'
    assert 'NO_GO' in result['headline']
    assert result['reasons'][0]=='gust_threshold_exceeded'
    assert result['score']==0


def test_live_weather_provenance_and_unverified_transparency(engine,monkeypatch):
    payload=weather_payload()
    monkeypatch.setattr(engine,'_cx4_fetch',lambda *args,**kwargs:json.dumps(payload).encode())
    monkeypatch.setattr(engine,'_cx4_radar',lambda *args,**kwargs:{'available':True,'activity':0.,'coverage_verified':False})
    result=engine._cx4_live_context(33.51234,-86.82234)
    assert result['circuit']['weather_gate']=='CAUTION'
    assert 'radar_coverage_unverified' in result['circuit']['reasons']
    assert result['weather']['precipitation_accumulation_seconds']==3600
    assert result['attribution']['weather']=='Open-Meteo'
    assert '33.51234' not in str(result)


def test_weather_api_unavailability_returns_503_not_go(client,engine,monkeypatch):
    def fail(*args,**kwargs):raise RuntimeError('provider_unavailable')
    monkeypatch.setattr(engine,'_cx4_fetch',fail)
    response=client.get('/api/chromograph/weather?lat=34&lon=-86')
    assert response.status_code==503
    assert 'weather_gate' not in response.json


def test_post_body_limit_applies_to_chunked_no_length(engine):
    # Test per-request body limit independently of Content-Length being supplied.
    with engine.app.test_request_context('/api/chromograph/v2/search',method='POST',
                                        data='x'*(1024*1024+5),content_type='application/json',
                                        environ_overrides={'wsgi.input_terminated':True}):
        from flask import request
        request.environ.pop('CONTENT_LENGTH',None)
        assert request.content_length is None
        from werkzeug.exceptions import RequestEntityTooLarge
        with pytest.raises(RequestEntityTooLarge):engine._cx_payload(1024*1024)


def test_external_api_payload_bounded_sanitized_and_configurable(engine,monkeypatch):
    import httpx
    captured={}
    class Upstream:
        def __enter__(self):return self
        def __exit__(self,*args):return False
        def raise_for_status(self):pass
        def iter_bytes(self):
            yield json.dumps({'choices':[{'message':{'content':'{"verdict":"BORDERLINE","score":0.4}'}}]}).encode()
    def stream(method,url,**kwargs):
        captured.update(method=method,url=url,**kwargs)
        return Upstream()
    monkeypatch.setattr(httpx,'stream',stream)
    monkeypatch.setenv('OPENAI_API_KEY','test-only-api-key')
    monkeypatch.setenv('ROADSCANNER_CX_AI_MODEL','configured-test-model')
    features={'pay':12,'displayed_miles':6,'weather':{'rain_mm':1},'private_address':'secret','gps':[33.5,-86.8]}
    raw,model=engine._cx4_external_ai(features,{'weather_gate':'CAUTION'})
    assert model=='configured-test-model' and raw['verdict']=='BORDERLINE'
    assert 'secret' not in str(captured['json']) and '33.5' not in str(captured['json'])
    assert captured['json']['max_completion_tokens']==650
    assert captured['follow_redirects'] is False


def test_huge_json_number_rejected_without_500(client):
    response=client.post('/api/chromograph/v2/descriptor',json={'weather':{'wind_gust_kph':10**1000}})
    assert response.status_code==400
    legacy=client.post('/api/chromograph/vectorize',json={'weather':{'wind_gust_kph':10**1000}})
    assert legacy.status_code==400


def test_worker_bridge_refuses_plaintext_or_embedded_credentials(client,engine,monkeypatch):
    monkeypatch.setenv('ROADSCANNER_CX_STORAGE_PROXY','1')
    for url in ('http://example.invalid','https://user:password@example.invalid','https://example.invalid/path'):
        monkeypatch.setattr(engine,'_CX_UPSTREAM_URL',url)
        response=client.get('/api/chromograph/storage/records/road1')
        assert response.status_code==503
        assert response.json['error']=='trusted_https_edge_origin_required'
