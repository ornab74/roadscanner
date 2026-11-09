from pathlib import Path
import ast
import hashlib
import json

ROOT=Path(__file__).resolve().parents[2]

def test_legacy_prefix_and_native_crypto_preserved():
    source=(ROOT/'main.py').read_text()
    contract=json.loads((ROOT/'docs/chromograph/release.json').read_text())
    prefix=source[:source.index('# BEGIN ROADSCANNER CHROMOGRAPH-X SINGLE-FILE V0.3')]
    assert hashlib.sha256(prefix.encode()).hexdigest()==contract['legacy_prefix_sha256']
    definitions={n.name:n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)}
    for name,expected in contract['native_functions'].items():
        assert hashlib.sha256(ast.get_source_segment(source,definitions[name]).encode()).hexdigest()==expected

def test_additive_migrations_match_embedded_schema(engine):
    for filename,schema in [('0003_owned_registry.sql',engine._CX5_SCHEMA),
                            ('0004_device_account_bindings.sql',engine._CX6_SCHEMA)]:
        text=(ROOT/'deploy'/filename).read_text()
        assert text.split('\n',1)[1]==schema
        assert 'DROP TABLE' not in text and 'ALTER TABLE' not in text
