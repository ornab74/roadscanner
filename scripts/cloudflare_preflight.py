#!/usr/bin/env python3
"""Read-only deployment checks; never provision Cloudflare, generate keys or print secret values.

A passing report is necessary, not a security certification. Containers
production remains intentionally blocked pending the documented persistence work.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
REQUIRED=(
 'INVITE_CODE_SECRET_KEY','admin_username','admin_pass','ENCRYPTION_PASSPHRASE',
 'QRS_SALT_B64','QRS_X25519_PUB_B64','QRS_X25519_PRIV_ENC_B64','QRS_PQ_KEM_ALG',
 'QRS_PQ_PUB_B64','QRS_PQ_PRIV_ENC_B64','QRS_SIG_ALG','QRS_SIG_PUB_B64','QRS_SIG_PRIV_ENC_B64')


def evaluate(root: Path,env: dict,target: str,runtime=False,mounts=None):
    checks=[]
    def check(name,ok,detail):checks.append({'check':name,'ok':bool(ok),'detail':detail})
    try:compile((root/'main.py').read_text(),'main.py','exec');syntax=True
    except (OSError,SyntaxError):syntax=False
    check('source_compiles',syntax,'Compile only; no native app import or secrets loaded.')
    cloud=root/'deploy'
    req=cloud/'requirements.cloud.txt';manifest=cloud/'lock.cloud.manifest.json'
    sig=cloud/'lock.cloud.manifest.pqsig';public=root/'pq_pubkey.b64'
    files=all(p.is_file() for p in (req,manifest,sig,public))
    check('signed_cloud_lock_files',files,'Prepare a reviewed hash lock and signature; do not bypass verify.py.')
    matching=False
    if files:
        try:matching=json.loads(manifest.read_text()).get('requirements_txt_sha256')==hashlib.sha256(req.read_bytes()).hexdigest()
        except (OSError,ValueError):pass
    check('cloud_lock_hash',matching,'The signed manifest must match the actual slim requirements file.')
    expected=env.get('ROADSCANNER_LOCK_PUBLIC_KEY_SHA256','')
    trusted=bool(len(expected)==64 and public.is_file() and hashlib.sha256(public.read_bytes()).hexdigest()==expected.lower())
    check('reviewed_lock_trust_anchor',trusted,'Set the exact public-key FILE SHA256 approved out of band; never self-approve a regenerated key.')
    missing=[k for k in REQUIRED if not env.get(k)]
    check('native_secret_configuration',not missing,'Missing variable NAMES: '+', '.join(missing) if missing else 'Required native configuration names are present; values are not displayed.')
    check('strict_pq_mode',env.get('STRICT_PQ2_ONLY')=='1' and env.get('QRS_PQ_KEM_ALG')=='ML-KEM-768'
          and env.get('QRS_SIG_ALG') in ('ML-DSA-65','ML-DSA-87'),'Explicit strict ML-KEM/ML-DSA configuration is required.')
    check('stable_session_secret',len(env.get('INVITE_CODE_SECRET_KEY',''))>=32,'Session secret must be high entropy, stable and at least 32 characters.')
    if env.get('ROADSCANNER_CX_REGISTRY_ENABLED')=='1':
        check('owner_namespace_key',len(env.get('ROADSCANNER_CX_OWNER_KEY',''))>=32,'Preserve the stable independent owner namespace key.')
        check('registry_d1',env.get('ROADSCANNER_CX_REGISTRY_BACKEND')=='d1' and all(env.get(k) for k in
              ('CLOUDFLARE_ACCOUNT_ID','ROADSCANNER_CX_D1_ID','ROADSCANNER_CX_D1_TOKEN')),'Cloud registry must use configured D1, not ephemeral Container SQLite.')
    check('public_origin',env.get('PUBLIC_BASE_URL','').startswith('https://') and bool(env.get('WEBAUTHN_RP_ID')),
          'Set exact audited HTTPS origin and RP ID; preflight does not prove their DNS/Access policy.')
    if target=='containers-production':
        check('containers_production_gate',False,'Blocked: legacy SQLite/sealed-file durability, native startup, restore and edge isolation are not production-validated.')
    elif target=='containers-staging':
        check('disposable_staging_only',env.get('ROADSCANNER_DISPOSABLE_STAGING')=='1',
              'Use a separate paid account/environment with disposable data; no real users or legacy migration.')
    elif runtime:
        directory=Path(env.get('QRS_DATA_DIR','/var/data'))
        if mounts is None:
            try:mounts=Path('/proc/self/mountinfo').read_text()
            except OSError:mounts=''
        resolved=str(directory.resolve())
        mounted=any(len(line.split())>4 and line.split()[4]==resolved for line in mounts.splitlines())
        private=directory.is_dir() and directory.stat().st_mode&0o077==0
        check('dedicated_private_state_mount',mounted and private,'Run inside a native container with a separate persistent /var/data mount, mode 0700. A mount is not a backup.')
    if runtime and files and trusted and matching:
        # Actual PQ signature verification occurs in the native image. Use a
        # private temporary working directory containing just reviewed files.
        import tempfile
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp)
            for src,dst in ((req,'requirements.txt'),(manifest,'lock.manifest.json'),(sig,'lock.manifest.pqsig'),(public,'pq_pubkey.b64'),(root/'verify.py','verify.py')):
                shutil.copyfile(src,tmp/dst)
            result=subprocess.run([sys.executable,str(tmp/'verify.py')],cwd=tmp,capture_output=True,timeout=60)
        check('native_lock_signature',result.returncode==0,'Native verify.py result only; stdout/stderr suppressed to avoid secret-bearing diagnostics.')
    elif runtime:
        check('native_lock_signature',False,'Native verification not attempted because lock/trust prerequisites failed.')
    return {'target':target,'ready':all(c['ok'] for c in checks),'checks':checks,
            'provisions_cloudflare':False,'security_certification':False,
            'manual_evidence_required':['Cloudflare Access deny tests','real native key restore','backup restore drill',
                                        'audit approval','image provenance and resource measurement']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target',choices=['persistent-host','containers-staging','containers-production'],required=True)
    parser.add_argument('--runtime',action='store_true')
    parser.add_argument('--start',action='store_true',help='After passing runtime checks, exec one-worker Gunicorn. Never deploys anything.')
    args=parser.parse_args()
    if args.start and not args.runtime:parser.error('--start requires --runtime')
    report=evaluate(ROOT,dict(os.environ),args.target,args.runtime)
    print(json.dumps(report,indent=2),flush=True)
    if not report['ready']:return 2
    if args.start:
        os.chdir(ROOT)
        os.execvp('gunicorn',['gunicorn','main:app','-b','0.0.0.0:3000','-w','1','-k','gthread',
                             '--threads','4','--timeout','180','--graceful-timeout','30','--log-level','warning'])
    return 0

if __name__=='__main__':raise SystemExit(main())
