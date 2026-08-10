import base64
import hashlib
import json
import pathlib
import sys

import oqs

manifest_path = pathlib.Path("lock.manifest.json")
sig_path = pathlib.Path("lock.manifest.pqsig")
pub_path = pathlib.Path("pq_pubkey.b64")
req_path = pathlib.Path("requirements.txt")

for p in (manifest_path, sig_path, pub_path, req_path):
    if not p.exists():
        print(f"ERROR: missing file: {p}")
        sys.exit(2)

manifest_obj = json.loads(manifest_path.read_text(encoding="utf-8"))
canonical = json.dumps(manifest_obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def load_b64(path: pathlib.Path) -> bytes:
    raw = path.read_bytes().strip()
    try:
        return base64.b64decode(raw, validate=True)
    except Exception:
        return raw


alg = manifest_obj.get("pq_alg", "ML-DSA-44")
if alg.startswith("Dilithium"):
    print(
        "ERROR: legacy Dilithium lock manifest detected. liboqs 0.16 uses the "
        "standardized ML-DSA family. Regenerate and re-sign the lock with "
        "scripts/resign-pq-lock.py after updating requirements.txt."
    )
    sys.exit(6)

if alg not in {"ML-DSA-44", "ML-DSA-65", "ML-DSA-87"}:
    print(f"ERROR: unsupported PQ signature algorithm: {alg}")
    sys.exit(6)

sig = load_b64(sig_path)
pub = load_b64(pub_path)

try:
    with oqs.Signature(alg) as verifier:
        ok = verifier.verify(canonical, sig, pub)
except Exception as exc:
    print(f"ERROR: oqs failure ({alg}): {exc}")
    sys.exit(5)

if not ok:
    print("PQ signature FAILED")
    print("sig bytes:", len(sig))
    print("pub bytes:", len(pub))
    print("canonical sha256:", hashlib.sha256(canonical).hexdigest())
    sys.exit(3)

expected = manifest_obj.get("requirements_txt_sha256", "").lower().strip()
actual = hashlib.sha256(req_path.read_bytes()).hexdigest().lower()
if not expected or expected != actual:
    print("requirements.txt mismatch")
    print("expected:", expected or "<missing>")
    print("actual:  ", actual)
    sys.exit(4)

print(f"OK: PQ verification passed ({alg})")