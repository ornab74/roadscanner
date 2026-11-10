#!/usr/bin/env python3
"""Disable DiskCache pickle deserialization for PYSEC-2026-2447.

Roadscanner does not use llama-cpp-python's optional disk cache. Until upstream
ships a fixed release, production images fail closed if code attempts to read a
pickled DiskCache key or value.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.metadata
import importlib.util
import os
import pathlib
import py_compile
import sys
import tempfile


ADVISORY = "PYSEC-2026-2447"
SUPPORTED_VERSION = "5.6.3"
ORIGINAL_SHA256 = "a229e61e76025ef476417551681a2a3dff2233bf4ce6901e8b16a395a27d4cdb"
MARKER = "Roadscanner security patch: PYSEC-2026-2447"

UNSAFE_KEY_LOAD = """        else:
            return pickle.load(io.BytesIO(key))
"""
SAFE_KEY_LOAD = f"""        else:
            # {MARKER}
            raise ValueError(\"DiskCache pickle key deserialization is disabled\")
"""

UNSAFE_VALUE_LOAD = """        elif mode == MODE_PICKLE:
            if value is None:
                with open(op.join(self._directory, filename), 'rb') as reader:
                    return pickle.load(reader)
            else:
                return pickle.load(io.BytesIO(value))
"""
SAFE_VALUE_LOAD = f"""        elif mode == MODE_PICKLE:
            # {MARKER}
            raise ValueError(\"DiskCache pickle value deserialization is disabled\")
"""


def core_path() -> pathlib.Path:
    spec = importlib.util.find_spec("diskcache.core")
    if spec is None or not spec.origin:
        raise SystemExit("diskcache.core is not installed")
    return pathlib.Path(spec.origin).resolve()


def verify(path: pathlib.Path) -> None:
    source = path.read_text(encoding="utf-8")
    if source.count(MARKER) != 2:
        raise SystemExit(f"{ADVISORY} patch marker is missing or duplicated")
    if UNSAFE_KEY_LOAD in source or UNSAFE_VALUE_LOAD in source:
        raise SystemExit(f"{ADVISORY} unsafe pickle load remains")
    py_compile.compile(str(path), doraise=True)

    # Exercise both vulnerable deserialization paths with a payload that would
    # create a file if pickle.loads were reached.
    import pickle

    importlib.invalidate_caches()
    sys.modules.pop("diskcache.core", None)
    sys.modules.pop("diskcache", None)
    core = importlib.import_module("diskcache.core")

    with tempfile.TemporaryDirectory() as directory:
        marker = pathlib.Path(directory) / "pickle-executed"

        class Payload:
            def __reduce__(self):
                return (pathlib.Path.touch, (marker,))

        payload = pickle.dumps(Payload())
        disk = core.Disk(directory)
        for operation in (
            lambda: disk.get(payload, False),
            lambda: disk.fetch(core.MODE_PICKLE, None, payload, False),
        ):
            try:
                operation()
            except ValueError:
                pass
            else:
                raise SystemExit(f"{ADVISORY} deserialization path did not fail closed")
        if marker.exists():
            raise SystemExit(f"{ADVISORY} malicious pickle executed")


def apply(path: pathlib.Path) -> None:
    if importlib.metadata.version("diskcache") != SUPPORTED_VERSION:
        raise SystemExit("unsupported diskcache version; review the advisory before patching")
    original = path.read_bytes()
    source = original.decode("utf-8")
    if MARKER in source:
        verify(path)
        return
    digest = hashlib.sha256(original).hexdigest()
    if digest != ORIGINAL_SHA256:
        raise SystemExit("diskcache core.py does not match the reviewed 5.6.3 source")
    if source.count(UNSAFE_KEY_LOAD) != 1 or source.count(UNSAFE_VALUE_LOAD) != 1:
        raise SystemExit("reviewed vulnerable code shapes were not found exactly once")
    patched = source.replace(UNSAFE_KEY_LOAD, SAFE_KEY_LOAD).replace(
        UNSAFE_VALUE_LOAD, SAFE_VALUE_LOAD
    )
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(patched, encoding="utf-8")
        os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    verify(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify without modifying")
    args = parser.parse_args()
    path = core_path()
    verify(path) if args.check else apply(path)
    print(f"{ADVISORY} mitigation verified: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
