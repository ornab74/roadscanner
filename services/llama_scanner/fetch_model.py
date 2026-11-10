"""Fetch the one configured GGUF artifact and verify it before publishing."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlsplit

import httpx


MODEL_URL = os.getenv(
    "QRS_LLAMA_MODEL_URL",
    "https://huggingface.co/tensorblock/llama3-small-GGUF/resolve/main/llama3-small-Q3_K_M.gguf",
)
MODEL_PATH = Path(
    os.getenv("QRS_LLAMA_MODEL_PATH", "/models/llama3-small-Q3_K_M.gguf")
)
EXPECTED_SHA256 = os.getenv(
    "QRS_LLAMA_MODEL_SHA256",
    "8e4f4856fb84bafb895f1eb08e6c03e4be613ead2d942f91561aeac742a619aa",
).strip().lower()
MAX_BYTES = int(os.getenv("QRS_LLAMA_MODEL_MAX_BYTES", str(1024**3)))


def fail(message: str) -> None:
    raise SystemExit(f"model fetch failed: {message}")


if urlsplit(MODEL_URL).scheme.lower() != "https":
    fail("source URL must use HTTPS")
if not re.fullmatch(r"[0-9a-f]{64}", EXPECTED_SHA256):
    fail("expected digest must be SHA-256 hex")
if (
    not MODEL_PATH.is_absolute()
    or MODEL_PATH.parent != Path("/models")
    or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.gguf", MODEL_PATH.name)
):
    fail("destination must be a direct GGUF child of /models")

MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
os.chmod(MODEL_PATH.parent, 0o755)

if MODEL_PATH.is_file():
    existing_digest = hashlib.sha256()
    with MODEL_PATH.open("rb") as existing_file:
        for existing_chunk in iter(lambda: existing_file.read(1024 * 1024), b""):
            existing_digest.update(existing_chunk)
    existing = existing_digest.hexdigest()
    if hmac.compare_digest(existing, EXPECTED_SHA256):
        print(f"model already verified: {MODEL_PATH.name}")
        raise SystemExit(0)

temporary = MODEL_PATH.with_name(f".{MODEL_PATH.name}.{secrets.token_hex(8)}.part")
digest = hashlib.sha256()
received = 0
try:
    timeout = httpx.Timeout(connect=20.0, read=180.0, write=30.0, pool=20.0)
    with httpx.stream(
        "GET",
        MODEL_URL,
        headers={"Accept-Encoding": "identity", "User-Agent": "roadscanner-model-fetch/1"},
        follow_redirects=True,
        timeout=timeout,
    ) as response:
        response.raise_for_status()
        if urlsplit(str(response.url)).scheme.lower() != "https":
            fail("redirected to a non-HTTPS URL")
        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > MAX_BYTES:
            fail("model exceeds configured maximum")
        with temporary.open("xb") as model_file:
            for chunk in response.iter_bytes(1024 * 1024):
                received += len(chunk)
                if received > MAX_BYTES:
                    fail("model exceeds configured maximum")
                model_file.write(chunk)
                digest.update(chunk)
    actual = digest.hexdigest()
    if not hmac.compare_digest(actual, EXPECTED_SHA256):
        fail(f"SHA-256 mismatch ({actual})")
    os.chmod(temporary, 0o444)
    os.replace(temporary, MODEL_PATH)
    print(f"verified model installed: {MODEL_PATH.name} ({received} bytes)")
finally:
    temporary.unlink(missing_ok=True)
