import base64
import hashlib
import hmac
import importlib.util
import json
import sys
import types
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[2]


def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def configured(tmp_path):
    module=load('cloudflare_preflight')
    root=tmp_path/'repo';(root/'deploy').mkdir(parents=True)
    (root/'main.py').write_text('x=1\n')
    req=root/'deploy/requirements.cloud.txt';req.write_text('test==1 --hash=sha256:fixture\n')
    manifest=root/'deploy/lock.cloud.manifest.json'
    manifest.write_text(json.dumps({'pq_alg':'ML-DSA-87','requirements_txt_sha256':hashlib.sha256(req.read_bytes()).hexdigest()}))
    (root/'deploy/lock.cloud.manifest.pqsig').write_text('test-signature-only')
    public=root/'pq_pubkey.b64';public.write_text('test-public-file')
    env={k:'test-only-placeholder' for k in module.REQUIRED}
    env.update(INVITE_CODE_SECRET_KEY='a'*40,STRICT_PQ2_ONLY='1',QRS_PQ_KEM_ALG='ML-KEM-768',
               QRS_SIG_ALG='ML-DSA-87',PUBLIC_BASE_URL='https://staging.example.com',WEBAUTHN_RP_ID='staging.example.com',
               ROADSCANNER_LOCK_PUBLIC_KEY_SHA256=hashlib.sha256(public.read_bytes()).hexdigest())
    return module,root,env


def test_production_container_gate_cannot_be_opened_by_environment(tmp_path):
    module,root,env=configured(tmp_path)
    env.update(ROADSCANNER_DISPOSABLE_STAGING='1',PRODUCTION_READY='1')
    result=module.evaluate(root,env,'containers-production')
    assert not result['ready']
    assert any(c['check']=='containers_production_gate' and not c['ok'] for c in result['checks'])


def test_preflight_never_returns_secret_values(tmp_path):
    module,root,env=configured(tmp_path)
    env['admin_pass']='UNIQUE-secret-do-not-print'
    result=module.evaluate(root,env,'containers-staging')
    assert 'UNIQUE-secret-do-not-print' not in json.dumps(result)
    assert result['provisions_cloudflare'] is False
    assert result['security_certification'] is False


def test_staging_requires_disposable_marker_and_matching_lock(tmp_path):
    module,root,env=configured(tmp_path)
    assert not module.evaluate(root,env,'containers-staging')['ready']
    env['ROADSCANNER_DISPOSABLE_STAGING']='1'
    assert module.evaluate(root,env,'containers-staging')['ready']
    (root/'deploy/requirements.cloud.txt').write_text('changed')
    result=module.evaluate(root,env,'containers-staging')
    assert not result['ready']
    assert not next(c for c in result['checks'] if c['check']=='cloud_lock_hash')['ok']


def test_trust_fingerprint_is_required_independently(tmp_path):
    module,root,env=configured(tmp_path)
    env.pop('ROADSCANNER_LOCK_PUBLIC_KEY_SHA256')
    assert not module.evaluate(root,env,'persistent-host')['ready']


def test_signing_helper_uses_existing_key_and_refuses_overwrite(tmp_path,monkeypatch):
    module=load('sign_cloud_manifest');module.ROOT=tmp_path/'repo';module.ROOT.mkdir()
    private=tmp_path/'private.b64';private.write_bytes(base64.b64encode(b'test-key'));private.chmod(0o600)
    public=module.ROOT/'pq_pubkey.b64';public.write_bytes(base64.b64encode(b'test-public'))
    requirements=module.ROOT/'requirements.txt';requirements.write_text('test-lock')
    manifest=module.ROOT/'manifest.json';manifest.write_text(json.dumps({'pq_alg':'ML-DSA-87','requirements_txt_sha256':hashlib.sha256(requirements.read_bytes()).hexdigest()}))
    # Explicit non-PQ double. Verifies helper control flow, not real ML-DSA.
    class Signature:
        def __init__(self,alg,key=None):self.key=key
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def sign(self,message):return hmac.new(self.key,message,hashlib.sha256).digest()
        def verify(self,message,signature,key):return key==b'test-public' and hmac.compare_digest(signature,hmac.new(b'test-key',message,hashlib.sha256).digest())
    monkeypatch.setitem(sys.modules,'oqs',types.SimpleNamespace(Signature=Signature))
    output=module.ROOT/'signature.b64'
    old_public=public.read_bytes();old_private=private.read_bytes()
    digest=module.sign(manifest,requirements,private,public,output)
    assert output.exists() and len(digest)==64
    assert public.read_bytes()==old_public and private.read_bytes()==old_private
    with pytest.raises(FileExistsError):module.sign(manifest,requirements,private,public,output)
    public.write_bytes(base64.b64encode(b'wrong-public'))
    with pytest.raises(ValueError,match='pinned trust anchor'):module.sign(manifest,requirements,private,public,module.ROOT/'no-signature')
    assert not (module.ROOT/'no-signature').exists()


def test_signing_helper_rejects_key_inside_repo_before_reading_it(tmp_path):
    module=load('sign_cloud_manifest');module.ROOT=tmp_path
    private=tmp_path/'key';private.write_text('test-only');private.chmod(0o600)
    with pytest.raises(ValueError,match='outside the repository'):
        module.sign(tmp_path/'manifest',tmp_path/'requirements',private,tmp_path/'public',tmp_path/'sig')
