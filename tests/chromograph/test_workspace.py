import io
import json
import pytest
from test_devices_api import csrf_headers,issue
from test_registry import body


def post_form(client,engine,path,data):
    return client.post(path,data=data,headers=csrf_headers(client,engine))


def test_workspace_is_server_rendered_without_browser_javascript(client,registry):
    response=client.get('/chromograph')
    assert response.status_code==200
    text=response.get_data(as_text=True)
    assert 'Your road intelligence workspace' in text
    assert '<script' not in text.lower()
    assert 'action="/chromograph/search"' in text and 'name="csrf_token"' in text
    assert response.headers['Cache-Control']=='no-store'
    assert 'No records yet' in text


def test_browser_search_uses_owned_persistent_records(client,registry,native_stub):
    with registry.app.test_request_context('/'):
        from flask import session
        session['username']='alice';owner=registry._cx5_owner()
    registry._cx5_create(owner,body(native_stub()),'workspace01')
    result=post_form(client,registry,'/chromograph/search',{'rgb':'#3366aa','tags':'wet'})
    assert result.status_code==200
    assert 'record-001' in result.get_data(as_text=True)
    assert 'Match rank' in result.get_data(as_text=True)


def test_workspace_cookie_post_requires_csrf(client,registry):
    registry.app.config['WTF_CSRF_ENABLED']=True
    assert client.post('/chromograph/search',data={'rgb':'#3388cc'}).status_code==400
    assert post_form(client,registry,'/chromograph/search',{'rgb':'#3388cc'}).status_code==200


def test_browser_upload_encrypts_nothing_and_accepts_only_verified_export(client,registry,native_stub):
    good=native_stub()
    result=post_form(client,registry,'/chromograph/upload',{
       'record_id':'road-browser','expected_version':'0','kind':'hazard','rgb':'#3366aa',
       'tags':'wet,road','public_ack':'yes','write_key':'browser-key01',
       'ciphertext':(io.BytesIO(good.encode()),'encrypted.qrs2')})
    assert result.status_code==200
    assert 'Saved road-browser version 1' in result.get_data(as_text=True)
    assert registry._cx5_one('SELECT envelope_qrs2 FROM cx5_versions')['envelope_qrs2']==good
    invalid=post_form(client,registry,'/chromograph/upload',{
       'record_id':'bad-export','expected_version':'0','kind':'hazard','rgb':'#3366aa',
       'public_ack':'yes','write_key':'browser-key02',
       'ciphertext':(io.BytesIO(b'plaintext'),'untrusted.txt')})
    assert invalid.status_code==422
    assert len(registry._cx5_rows('SELECT * FROM cx5_versions'))==1


def test_device_secret_displayed_once_then_only_metadata(client,registry):
    result=post_form(client,registry,'/chromograph/devices',{'scopes':['record:read'],'ttl_hours':'24'})
    text=result.get_data(as_text=True)
    assert result.status_code==200 and 'Save this credential now' in text
    assert 'rsd1.' in text
    later=client.get('/chromograph').get_data(as_text=True)
    assert 'rsd1.' not in later
    row=registry._cx5_one('SELECT * FROM cx6_device_subjects')
    assert row is not None


def test_read_only_device_cannot_enter_browser_workspace(client,registry):
    token=issue(client,registry,['record:read'])['token']
    assert client.get('/chromograph',headers={'Authorization':'Bearer '+token}).status_code==403


def test_non_admin_cannot_process_shared_queue(client,registry):
    with client.session_transaction() as s:s['is_admin']=False
    page=client.get('/chromograph').get_data(as_text=True)
    assert 'Process next publication' not in page
    assert post_form(client,registry,'/chromograph/publish-next',{}).status_code==403
    assert client.get('/api/chromograph/v3/admin/jobs').status_code==403


def test_history_page_and_pagination_stable_with_equal_timestamps(client,registry,native_stub):
    with registry.app.test_request_context('/'):
        from flask import session
        session['username']='alice';owner=registry._cx5_owner()
    for i in range(3):registry._cx5_create(owner,body(native_stub(),rid=f'road-00{i}'),f'request-{i}')
    first=client.get('/api/chromograph/v3/records?limit=2')
    assert first.status_code==200 and len(first.json['records'])==2 and first.json['next_cursor']
    following=client.get('/api/chromograph/v3/records',query_string={'limit':2,'cursor':first.json['next_cursor']})
    assert len(following.json['records'])==1
    assert set(x['record_id'] for x in first.json['records']).isdisjoint(x['record_id'] for x in following.json['records'])
    history=client.get('/chromograph/records/road-000')
    assert history.status_code==200 and 'Upload a revision' in history.get_data(as_text=True)


def test_invalid_cursor_rejected_and_cross_account_records_never_listed(client,registry,native_stub):
    registry._cx5_create('another-owner',body(native_stub(),rid='private-other'), 'request-01')
    assert client.get('/api/chromograph/v3/records').json['records']==[]
    assert client.get('/api/chromograph/v3/records?cursor=not-base64').status_code==400


def test_weather_form_requests_explicit_consent_and_shows_unknown(client,registry,monkeypatch):
    called=[]
    def weather(*args):
        called.append(args)
        return {'weather':{'wind_gust_kph':None,'precipitation_mm':None,'visibility_km':None},
                'circuit':{'weather_gate':'UNKNOWN','reasons':['missing_weather']}}
    monkeypatch.setattr(registry,'_cx_live_context',weather)
    assert post_form(client,registry,'/chromograph/weather',{'lat':'33.5','lon':'-86.8'}).status_code==400
    assert not called
    result=post_form(client,registry,'/chromograph/weather',{'lat':'33.5','lon':'-86.8','location_ack':'yes'})
    assert result.status_code==200 and 'UNKNOWN' in result.get_data(as_text=True)
    assert len(called)==1


def test_workspace_errors_are_escaped_and_no_private_upstream_text(client,registry,monkeypatch):
    result=post_form(client,registry,'/chromograph/search',{'rgb':'<script>alert(1)</script>','tags':'wet'})
    assert result.status_code==400
    assert '<script>alert' not in result.get_data(as_text=True)
    def down(*args,**kwargs):raise RuntimeError('private upstream secret')
    monkeypatch.setattr(registry,'_cx6_list',down)
    result=client.get('/chromograph')
    assert result.status_code==503 and 'private upstream secret' not in result.get_data(as_text=True)


def test_large_ui_upload_rejected_before_form_parse(client,registry):
    result=client.post('/chromograph/upload',data={'ciphertext':(io.BytesIO(b'x'*270_000),'large.qrs2')})
    assert result.status_code==413


def test_job_diagnostics_omit_ciphertext_and_auth_fields(client,registry,native_stub):
    registry._cx5_create('owner',body(native_stub()),'request-01')
    response=client.get('/api/chromograph/v3/admin/jobs')
    assert response.status_code==200 and response.json['counts']['pending']==1
    assert 'envelope_qrs2' not in str(response.json) and 'token_hash' not in str(response.json)


def test_revision_form_preserves_weather_time_and_palette(client,registry,native_stub):
    with registry.app.test_request_context('/'):
        from flask import session
        session['username']='alice';owner=registry._cx5_owner()
    data=body(native_stub(),rid='preserve-001')
    data['kind']='custom-type'
    data['public_context'].update(palette=[{'rgb':'#3366aa','weight':2},{'rgb':'#7788aa','weight':1}],
          weather={'wind_gust_kph':32},timestamp_utc='2026-11-09T01:00:00Z')
    registry._cx5_create(owner,data,'revision-origin')
    detail=client.get('/chromograph/records/preserve-001').get_data(as_text=True)
    assert 'value="custom-type" selected' in detail
    assert 'value="wet"' in detail
    updated=post_form(client,registry,'/chromograph/upload',{
        'record_id':'preserve-001','expected_version':'1','kind':'custom-type','rgb':'#3366aa',
        'tags':'wet','public_ack':'yes','write_key':'revision-next',
        'ciphertext':(io.BytesIO(native_stub('b').encode()),'revision.qrs2')})
    assert updated.status_code==200
    stored=registry._cx5_read(owner,'preserve-001')['public_context']
    assert stored['weather']['wind_gust_kph']==32
    assert stored['timestamp_utc'].startswith('2026-11-09T01:00:00')
    assert len(stored['palette'])==2


def test_workspace_device_state_reflects_account_changes_before_token_use(client,registry):
    issue(client,registry,['search:read'])
    import sqlite3
    with sqlite3.connect(registry.DB_FILE) as db:db.execute("UPDATE users SET password='changed' WHERE id=1")
    page=client.get('/chromograph').get_data(as_text=True)
    assert 'reissue required' in page
    assert '>active<' not in page


def test_workspace_html_forms_have_csrf_and_no_external_runtime(client,registry):
    from html.parser import HTMLParser
    class Forms(HTMLParser):
        def __init__(self):super().__init__();self.forms=[];self.current=None;self.scripts=[]
        def handle_starttag(self,tag,attrs):
            attrs=dict(attrs)
            if tag=='form':self.current={'attrs':attrs,'csrf':False}
            elif tag=='input' and self.current is not None and attrs.get('name')=='csrf_token':
                self.current['csrf']=bool(attrs.get('value'))
            elif tag=='script':self.scripts.append(attrs)
        def handle_endtag(self,tag):
            if tag=='form' and self.current is not None:self.forms.append(self.current);self.current=None
    parser=Forms();parser.feed(client.get('/chromograph').get_data(as_text=True))
    assert len(parser.forms)>=5 and not parser.scripts
    assert all(form['attrs'].get('method')=='post' and form['csrf'] for form in parser.forms)
