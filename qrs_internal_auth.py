"""Authenticated request/response envelopes for private container APIs."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from typing import Mapping


AUTH_VERSION = b"qrs-internal-v1"


def require_shared_secret(value: str | bytes | None) -> bytes:
    if isinstance(value, str):
        value = value.encode("utf-8")
    if not isinstance(value, bytes) or len(value) < 32:
        raise ValueError("QRS_LLAMA_API_TOKEN must contain at least 32 bytes")
    return value


def _request_message(timestamp: str, nonce: str, body: bytes) -> bytes:
    return b"\n".join(
        (AUTH_VERSION, b"request", timestamp.encode("ascii"), nonce.encode("ascii"), body)
    )


def _response_message(nonce: str, body: bytes) -> bytes:
    return b"\n".join((AUTH_VERSION, b"response", nonce.encode("ascii"), body))


def sign_request(
    secret: str | bytes,
    body: bytes,
    *,
    timestamp: int | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    key = require_shared_secret(secret)
    ts = str(int(time.time() if timestamp is None else timestamp))
    request_nonce = nonce or secrets.token_urlsafe(24)
    if not request_nonce or len(request_nonce) > 96:
        raise ValueError("invalid internal request nonce")
    signature = hmac.new(
        key, _request_message(ts, request_nonce, body), hashlib.sha256
    ).hexdigest()
    return {
        "X-QRS-Timestamp": ts,
        "X-QRS-Nonce": request_nonce,
        "X-QRS-Signature": signature,
    }


def verify_request(
    secret: str | bytes,
    body: bytes,
    headers: Mapping[str, str],
    *,
    now: int | None = None,
    max_skew_seconds: int = 30,
) -> tuple[bool, str]:
    try:
        key = require_shared_secret(secret)
        timestamp = str(headers.get("X-QRS-Timestamp", ""))
        nonce = str(headers.get("X-QRS-Nonce", ""))
        supplied = str(headers.get("X-QRS-Signature", "")).lower()
        timestamp_int = int(timestamp)
    except (TypeError, ValueError):
        return False, "invalid_auth_headers"
    if len(nonce) < 16 or len(nonce) > 96 or not nonce.isascii():
        return False, "invalid_nonce"
    if len(supplied) != 64 or any(ch not in "0123456789abcdef" for ch in supplied):
        return False, "invalid_signature"
    current = int(time.time() if now is None else now)
    if abs(current - timestamp_int) > max_skew_seconds:
        return False, "stale_request"
    expected = hmac.new(
        key, _request_message(timestamp, nonce, body), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        return False, "invalid_signature"
    return True, nonce


def sign_response(secret: str | bytes, nonce: str, body: bytes) -> str:
    return hmac.new(
        require_shared_secret(secret), _response_message(nonce, body), hashlib.sha256
    ).hexdigest()


def verify_response(
    secret: str | bytes, nonce: str, body: bytes, supplied_signature: str | None
) -> bool:
    supplied = str(supplied_signature or "").lower()
    if len(supplied) != 64:
        return False
    expected = sign_response(secret, nonce, body)
    return hmac.compare_digest(expected, supplied)
