#!/usr/bin/env python3
"""Fail when tracked source reintroduces disallowed decentralized storage."""

from __future__ import annotations

import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKENS = (
    b"ip" + b"fs",
    b"ip" + b"ns",
    b"pin" + b"ata",
    b"web3" + b".storage",
    b"nft" + b".storage",
)
SKIP_SUFFIXES = {".woff", ".woff2", ".ttf", ".otf", ".png", ".jpg", ".ico"}


def tracked_files() -> list[pathlib.Path]:
    output = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT, stderr=subprocess.DEVNULL
    )
    return [ROOT / item.decode("utf-8") for item in output.split(b"\0") if item]


violations: list[str] = []
for path in tracked_files():
    if path.suffix.lower() in SKIP_SUFFIXES or not path.is_file():
        continue
    try:
        content = path.read_bytes()
    except OSError:
        continue
    if b"\0" in content[:4096]:
        continue
    lowered = content.lower()
    if any(token in lowered for token in TOKENS):
        violations.append(str(path.relative_to(ROOT)))

if violations:
    print("Disallowed storage integration found in tracked files:", file=sys.stderr)
    for violation in violations:
        print(f"  {violation}", file=sys.stderr)
    raise SystemExit(1)

print("Storage policy check passed: Cloudflare-only deployment remains enforced.")
