"""Create an UNSIGNED slim requirements manifest for the existing PQ signing flow.

Does not access private keys or fabricate signatures. Requires an existing
hashed lockfile. The Docker build will refuse to proceed without a matching
ML-DSA signature, using Roadscanner's existing verify.py and public trust anchor.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re


def manifest(requirements,algorithm="ML-DSA-87"):
    if algorithm not in {'ML-DSA-44','ML-DSA-65','ML-DSA-87'}:
        raise ValueError('unsupported lock signing algorithm')
    content=requirements.read_bytes()
    text=content.decode()
    names=[]
    for line in text.splitlines():
        if not line or line.startswith((' ','#','\\')):continue
        found=re.match(r'([A-Za-z0-9_.-]+)(?:\[.*?\])?==',line)
        if not found:
            raise ValueError('unexpected or unpinned requirements line')
        names.append(found.group(1).lower().replace('_','-'))
    if not names or '--hash=sha256:' not in text:
        raise ValueError('generate a full hashed dependency lock first')
    if any(n=='llama-cpp-python' or n.startswith('pennylane') for n in names):
        raise ValueError('local AI packages remain in slim lock')
    return {'pq_alg':algorithm,'requirements_txt_sha256':hashlib.sha256(content).hexdigest(),
            'purpose':'Roadscanner cloud external-AI runtime','format_version':1}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--requirements',type=Path,default=Path('deploy/requirements.cloud.txt'))
    p.add_argument('--output',type=Path,default=Path('deploy/lock.cloud.manifest.json'))
    p.add_argument('--algorithm',choices=['ML-DSA-44','ML-DSA-65','ML-DSA-87'],default='ML-DSA-87')
    a=p.parse_args()
    obj=manifest(a.requirements,a.algorithm)
    with a.output.open('x') as output:
        output.write(json.dumps(obj,sort_keys=True,separators=(',',':'))+'\n')
    print('Created unsigned manifest:',a.output)
    print('Sign its canonical JSON using the matching trusted ML-DSA key; put base64 signature in deploy/lock.cloud.manifest.pqsig.')

if __name__=='__main__':main()
