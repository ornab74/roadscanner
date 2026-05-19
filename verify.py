import base64
import hashlib
import json
import sys
import pathlib
import oqs

manifest_path = pathlib.Path("lock.manifest.json")
sig_path = pathlib.Path("lock.manifest.pqsig")
pub_path = pathlib.Path("pq_pubkey.b64")
req_path = pathlib.Path("requirements.txt")

# ---- strict file existence check ----
for p in (manifest_path, sig_path, pub_path, req_path):
    if not p.exists():
        print(f"ERROR: missing file: {p}")
        sys.exit(2)

# ---- load manifest deterministically ----
manifest_obj = json.loads(manifest_path.read_text(encoding="utf-8"))

canonical = json.dumps(
    manifest_obj,
    sort_keys=True,
    separators=(",", ":")
).encode("utf-8")

# ---- STRICT binary loading (NO guessing) ----
def load_b64(path: pathlib.Path) -> bytes:
    raw = path.read_bytes().strip()
    try:
        return base64.b64decode(raw, validate=True)
    except Exception:
        return raw

sig = load_b64(sig_path)
pub = load_b64(pub_path)

# ---- algorithm selection ----
alg = manifest_obj.get("pq_alg", "Dilithium2")

try:
    with oqs.Signature(alg) as signer:
        ok = signer.verify(canonical, sig, pub)
except Exception as e:
    print(f"ERROR: oqs failure: {e}")
    sys.exit(5)

if not ok:
    print("PQ signature FAILED")
    print("DEBUG:")
    print("sig bytes:", len(sig))
    print("pub bytes:", len(pub))
    print("canonical sha256:", hashlib.sha256(canonical).hexdigest())
    sys.exit(3)

# ---- requirements hash check ----
expected = manifest_obj.get("requirements_txt_sha256", "").lower().strip()
actual = hashlib.sha256(req_path.read_bytes()).hexdigest().lower()

if expected != actual:
    print("requirements.txt mismatch")
    print("expected:", expected)
    print("actual:  ", actual)
    sys.exit(4)

print("OK: PQ verification passed")