#!/usr/bin/env python3
"""Sign a slim lock with an EXISTING trusted ML-DSA key on a signing machine.

Never generates/replaces a trust anchor. Never takes private key bytes on the
command line. Decrypt an approved key to a private, external tmpfs file first.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def sign(manifest,requirements,private_key,public_key,output):
    path=private_key.resolve(strict=True)
    if path.is_relative_to(ROOT):raise ValueError('private signing key must be outside the repository')
    if os.name=='posix' and path.stat().st_mode&0o077:raise ValueError('private key file must not be group/world accessible')
    if path.stat().st_size>200_000:raise ValueError('private key file too large')
    data=json.loads(manifest.read_text())
    alg=data.get('pq_alg')
    if alg not in ('ML-DSA-44','ML-DSA-65','ML-DSA-87'):raise ValueError('unsupported signing algorithm')
    if data.get('requirements_txt_sha256')!=hashlib.sha256(requirements.read_bytes()).hexdigest():
        raise ValueError('requirements hash mismatch')
    canonical=json.dumps(data,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    secret=base64.b64decode(path.read_bytes().strip(),validate=True)
    trusted=base64.b64decode(public_key.read_bytes().strip(),validate=True)
    import oqs
    with oqs.Signature(alg,secret) as signer:signature=signer.sign(canonical)
    with oqs.Signature(alg) as verifier:
        if not verifier.verify(canonical,signature,trusted):raise ValueError('private key does not match pinned trust anchor')
    with output.open('x') as file:file.write(base64.b64encode(signature).decode()+'\n')
    return hashlib.sha256(canonical).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--private-key-file',type=Path,required=True)
    p.add_argument('--public-key-file',type=Path,default=ROOT/'pq_pubkey.b64')
    p.add_argument('--manifest',type=Path,default=ROOT/'deploy/lock.cloud.manifest.json')
    p.add_argument('--requirements',type=Path,default=ROOT/'deploy/requirements.cloud.txt')
    p.add_argument('--output',type=Path,default=ROOT/'deploy/lock.cloud.manifest.pqsig')
    args=p.parse_args()
    digest=sign(args.manifest,args.requirements,args.private_key_file,args.public_key_file,args.output)
    print('Signed canonical manifest sha256:',digest)
    print('Signature written; no key or trust anchor was generated.')

if __name__=='__main__':main()
