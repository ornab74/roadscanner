import pytest
from test_registry import body


def test_d1_rest_contract_with_string_parameters(registry,native_stub,monkeypatch):
    sqlite=registry._cx5_db()
    calls=[]
    def wire(url,payload,token,max_bytes=0):
        calls.append((url,payload,token))
        assert token=='test-d1-token'
        assert all(isinstance(x,str) for x in payload['params'])
        result=sqlite.query(payload['sql'],payload['params'])
        return {'success':True,'result':[{'success':True,'results':result['results'],
                                         'meta':{'changes':result['changes']}}]}
    monkeypatch.setattr(registry,'_cx5_wire_json',wire)
    d1=registry._CX5D1('a'*32,'00000000-0000-4000-8000-000000000001','test-d1-token')
    monkeypatch.setattr(registry,'_cx5_db',lambda:d1)
    first,created=registry._cx5_create('owner',body(native_stub()),'request01')
    assert created and first['version']==1
    second,created=registry._cx5_create('owner',body(native_stub('b'),expected=1),'request02')
    assert created and second['version']==2
    assert all('/client/v4/accounts/' in call[0] for call in calls)
    assert all('batch' not in call[1] for call in calls)


def test_d1_rejects_failure_result(registry,monkeypatch):
    d1=registry._CX5D1('a'*32,'00000000-0000-4000-8000-000000000001','test')
    for response in ({'success':False},{'success':True,'result':[]},
                     {'success':True,'result':[{'success':False}]}):
        monkeypatch.setattr(registry,'_cx5_wire_json',lambda *args,**kw:response)
        with pytest.raises(RuntimeError):d1.query('SELECT 1')


def test_d1_only_server_selected_url_and_ids(registry):
    for account in ('localhost','https://evil.invalid','a'*33):
        with pytest.raises(ValueError):registry._CX5D1(account,'00000000-0000-4000-8000-000000000001','test')


def test_separate_registry_never_uses_legacy_database(registry,monkeypatch):
    monkeypatch.setattr(registry,'DB_FILE',registry._cx5_db().path,raising=False)
    with pytest.raises(RuntimeError,match='legacy_database'):registry._cx5_db()
