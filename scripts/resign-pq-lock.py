#!/usr/bin/env python3
"""Regenerate Roadscanner's signed dependency lock metadata with ML-DSA.

Run only from a trusted checkout after requirements.txt has been regenerated and
reviewed. The generated private signing key is intentionally ephemeral: this
utility writes only the public key, signature, and signed manifest.
"""

import base64
import hashlib
import json
import pathlib
import re
import sys

import oqs

ROOT = pathlib.Path(__file__).resolve().parents[1]
REQ = ROOT / "requirements.txt"
MANIFEST = ROOT / "lock.manifest.json"
SIG = ROOT / "lock.manifest.pqsig"
PUB = ROOT / "pq_pubkey.b64"
ALG = "ML-DSA-44"

PIN_RE = re.compile(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)")


def normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_pins(text: str):
    pins = {}
    logical = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        logical += line[:-1].strip() if line.endswith("\\") else line
        if line.endswith("\\"):
            logical += " "
            continue
        match = PIN_RE.match(logical.strip())
        if match:
            pins[normalized(match.group(1))] = match.group(2)
        logical = ""
    return [{"name": name, "version": pins[name]} for name in sorted(pins)]


def main() -> int:
    if not REQ.is_file():
        print("ERROR: requirements.txt is missing", file=sys.stderr)
        return 2

    req_bytes = REQ.read_bytes()
    manifest = {
        "format": "pq-lock-manifest-v2",
        "pinned": parse_pins(req_bytes.decode("utf-8")),
        "pq_alg": ALG,
        "requirements_txt_sha256": hashlib.sha256(req_bytes).hexdigest(),
    }
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()

    with oqs.Signature(ALG) as signer:
        public_key = signer.generate_keypair()
        signature = signer.sign(canonical)

    MANIFEST.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ",")) + "\n")
    SIG.write_text(base64.b64encode(signature).decode() + "\n")
    PUB.write_text(base64.b64encode(public_key).decode() + "\n")

    print(f"Re-signed dependency lock with {ALG}")
    print(f"requirements sha256: {manifest['requirements_txt_sha256']}")
    print("Review git diff, then run: python verify.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
