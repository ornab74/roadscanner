"""Small, dependency-free security helpers for API keys and Stripe webhooks."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass


API_KEY_RE = re.compile(r"^qrs_live_([A-Za-z0-9_-]{10})_([A-Za-z0-9_-]{40,})$")
IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$")


def require_pepper(value: str | bytes | None) -> bytes:
    if isinstance(value, str):
        value = value.encode("utf-8")
    if not isinstance(value, bytes) or len(value) < 32:
        raise ValueError("QRS_API_KEY_PEPPER must contain at least 32 bytes")
    return value


@dataclass(frozen=True)
class GeneratedApiKey:
    plaintext: str
    prefix: str
    digest: str


def hash_api_key(plaintext: str, pepper: str | bytes) -> str:
    return hmac.new(
        require_pepper(pepper), plaintext.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def generate_api_key(pepper: str | bytes) -> GeneratedApiKey:
    prefix = secrets.token_urlsafe(8)[:10]
    secret = secrets.token_urlsafe(40)
    plaintext = f"qrs_live_{prefix}_{secret}"
    return GeneratedApiKey(plaintext, prefix, hash_api_key(plaintext, pepper))


def api_key_prefix(plaintext: str) -> str | None:
    match = API_KEY_RE.fullmatch(plaintext or "")
    return match.group(1) if match else None


def bearer_token(header: str | None) -> str | None:
    if not header:
        return None
    parts = header.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        return None
    return parts[1]


def valid_idempotency_key(value: str | None) -> bool:
    return bool(value and IDEMPOTENCY_KEY_RE.fullmatch(value))


def verify_stripe_signature(
    payload: bytes,
    signature_header: str | None,
    webhook_secret: str | bytes | None,
    *,
    now: int | None = None,
    tolerance_seconds: int = 300,
) -> bool:
    if isinstance(webhook_secret, str):
        webhook_secret = webhook_secret.encode("utf-8")
    if not payload or not signature_header or not webhook_secret:
        return False
    timestamp: int | None = None
    signatures: list[str] = []
    for item in signature_header.split(","):
        key, separator, value = item.strip().partition("=")
        if not separator:
            continue
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return False
        elif key == "v1":
            signatures.append(value.lower())
    if timestamp is None or not signatures:
        return False
    current = int(time.time() if now is None else now)
    if abs(current - timestamp) > tolerance_seconds:
        return False
    signed = str(timestamp).encode("ascii") + b"." + payload
    expected = hmac.new(webhook_secret, signed, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, candidate) for candidate in signatures)
