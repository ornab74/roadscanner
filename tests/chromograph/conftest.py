from __future__ import annotations
import logging
import ast
import time
import sqlite3
import types
from pathlib import Path
import pytest
from flask import Flask, request, session, jsonify, render_template_string
from flask_wtf import CSRFProtect

ROOT=Path(__file__).resolve().parents[2]
_MAIN_SOURCE=(ROOT/'main.py').read_text()
_LEGACY_LOGIN=ast.get_source_segment(_MAIN_SOURCE,next(n for n in ast.parse(_MAIN_SOURCE).body
            if isinstance(n,ast.FunctionDef) and n.name=='_establish_authenticated_session'))

@pytest.fixture
def engine(monkeypatch):
    monkeypatch.setenv('ROADSCANNER_CX_ENABLED','1')
    monkeypatch.delenv('ROADSCANNER_CX_EXTERNAL_AI_ENABLED',raising=False)
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    module=types.ModuleType('roadscanner_v04_test')
    app=Flask('roadscanner_v04_test')
    app.config.update(SECRET_KEY='test-secret-only',TESTING=True,WTF_CSRF_ENABLED=False)
    csrf=CSRFProtect(app)
    module.__dict__.update(app=app,csrf=csrf,request=request,session=session,
                          jsonify=jsonify,render_template_string=render_template_string,
                          logger=logging.getLogger('roadscanner-v04-tests'),psutil=None,time=time)
    exec(compile('from __future__ import annotations\n'+_LEGACY_LOGIN,'<native-session-establishment>','exec'),module.__dict__)
    exec(compile(_MAIN_SOURCE[_MAIN_SOURCE.index('# BEGIN ROADSCANNER CHROMOGRAPH-X SINGLE-FILE V0.3'):_MAIN_SOURCE.index("if __name__ == '__main__':")],'<integrated-main-block>','exec'),module.__dict__)
    return module

@pytest.fixture
def client(engine):
    with engine.app.test_client() as client:
        with client.session_transaction() as session:
            session['username']='alice'
            session['is_admin']=True
            session['auth_time']=int(time.time())
        yield client


def weather_payload(start=None, count=48):
    from datetime import datetime, timezone, timedelta
    start=start or datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
    keys=('temperature_2m','apparent_temperature','precipitation','rain','showers',
          'cloud_cover','wind_speed_10m','wind_gusts_10m','visibility','precipitation_probability')
    units=dict(zip(keys,('°C','°C','mm','mm','mm','%','km/h','km/h','m','%')))
    vals=dict(zip(keys,(22.,20.,0.,0.,0.,10.,10.,15.,10000.,10.)))
    now=datetime.now(timezone.utc).replace(minute=0,second=0,microsecond=0)
    return {'latitude':33.5,'longitude':-86.8,'hourly_units':units,
            'current_units':{k:v for k,v in units.items() if k not in ('visibility','precipitation_probability')},
            'current':{'time':now.isoformat(),**{k:v for k,v in vals.items() if k not in ('visibility','precipitation_probability')}},
            'hourly':{'time':[(start+timedelta(hours=i)).isoformat() for i in range(count)],
                      **{k:[v]*count for k,v in vals.items()}}}


@pytest.fixture
def registry(engine,monkeypatch,tmp_path):
    monkeypatch.setenv('ROADSCANNER_CX_REGISTRY_ENABLED','1')
    monkeypatch.setenv('ROADSCANNER_CX_REGISTRY_BACKEND','sqlite')
    monkeypatch.setenv('ROADSCANNER_CX_REGISTRY_PATH',str(tmp_path/'registry.db'))
    monkeypatch.setenv('ROADSCANNER_CX_OWNER_KEY','test-namespace-key-that-is-at-least-32-characters')
    engine._cx5_db().initialize()
    engine._cx5_db().query('CREATE TABLE cx6_device_subjects(device_id TEXT PRIMARY KEY,legacy_user_id INTEGER NOT NULL,auth_fingerprint TEXT NOT NULL,bound_at INTEGER NOT NULL)')
    auth_path=tmp_path/'legacy-auth.db'
    with sqlite3.connect(auth_path) as db:
        db.executescript('''CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,password TEXT,is_admin INTEGER,webauthn_user_handle BLOB);
        CREATE TABLE webauthn_credentials(id INTEGER PRIMARY KEY,user_id INTEGER,credential_id BLOB,credential_data BLOB,sign_count INTEGER DEFAULT 0,label TEXT);''')
        db.execute('INSERT INTO users VALUES (1,?,?,1,NULL)',('alice','test-hash-alice'))
        db.execute('INSERT INTO users VALUES (2,?,?,0,NULL)',('bob','test-hash-bob'))
    engine.DB_FILE=auth_path
    def resolve(username):
        with sqlite3.connect(auth_path) as db:
            row=db.execute('SELECT id FROM users WHERE username=?',(username,)).fetchone()
        return row[0] if row else None
    engine.get_user_id=resolve
    return engine


@pytest.fixture
def native_stub(registry):
    # This is a test double for native verification ONLY. These are NOT genuine
    # ML-DSA/ML-KEM test vectors, and no PQ compatibility claim follows from it.
    import hashlib,hmac,base64,json
    key=b'native-verifier-test-double-key'
    pub=b'trusted-public-key-fixture'
    class Manager:
        sig_alg_name='ML-DSA-87'
        sig_pub=pub
        def sign_blob(self,message):return hmac.new(key,message,hashlib.sha256).digest()
        def verify_blob(self,public,signature,message):
            return public==pub and hmac.compare_digest(signature,self.sign_blob(message))
    registry.key_manager=Manager()
    registry.POLICY={'min_env_version':'QRS2','require_sig_on_pq2':True,'require_pq_if_available':False}
    def envelope(ch='x'):
        def b64(value):return base64.b64encode(value).decode()
        env={'v':'QRS2','alg':'HY1','pq_alg':'ML-KEM-768',
             'pq_ct':b64(b'p'*1088),'x_ephemeral_pub':b64(b'x'*32),
             'wrap_nonce':b64(b'n'*12),'dek_wrapped':b64(b'w'*48),
             'data_nonce':b64(b'd'*12),'data_ct':b64((ch.encode()*20)),
             'comp':{'alg':'none','orig_len':4},'col_meta':{'hex':'#3366aa'}}
        core={**env,'policy':registry.POLICY,'hd_ctx':{}}
        env['sig']={'alg':'ML-DSA-87','pub':b64(pub),'val':b64(registry.key_manager.sign_blob(registry._cx4_canonical(core).encode()))}
        return 'PQ2.'+base64.urlsafe_b64encode(json.dumps(env,separators=(',',':')).encode()).decode()
    return envelope
