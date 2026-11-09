# Chromograph tests

From the repository root, install the hash-locked **test-only** environment:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r tests/chromograph/requirements.txt
python -m pytest -q tests/chromograph
```

The tests use actual Flask/Flask-WTF/SQLite, mocked remote HTTP and an explicitly non-PQ native signing test double. They extract the additive block from root `main.py`; there is no duplicated generated runtime or backup main file to accidentally import. They do not initialize the real native app, native key store or production databases.

The legacy-prefix/native source hashes in `docs/chromograph/release.json` must only be changed after reviewing intentional legacy edits, not blindly regenerated to make a failing test pass.

Full native, Cloudflare, provider, Docker and visual-browser checks are separate audit requirements. See `docs/deployment/DAYBREAK_HANDOFF.md`.
