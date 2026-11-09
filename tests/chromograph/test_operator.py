import json
import sqlite3
import stat
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]


def test_operator_initializes_new_separate_schema_without_native_keys(tmp_path):
    target=tmp_path/'new-registry.db'
    command=[sys.executable,str(ROOT/'scripts/chromograph_registry_ops.py'),'init-local','--database',str(target)]
    created=subprocess.run(command,capture_output=True,text=True,check=True)
    assert json.loads(created.stdout)['legacy_database_touched'] is False
    assert stat.S_IMODE(target.stat().st_mode)==0o600
    connection=sqlite3.connect(target)
    try:
        tables={r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:connection.close()
    assert tables=={'cx5_devices','cx5_versions','cx5_budgets','cx6_device_subjects'}
    again=subprocess.run(command,capture_output=True,text=True)
    assert again.returncode!=0


def test_exported_schema_requires_no_full_app_import():
    output=subprocess.run([sys.executable,str(ROOT/'scripts/chromograph_registry_ops.py'),'export-schema'],
                          capture_output=True,text=True,check=True).stdout
    assert 'CREATE TABLE IF NOT EXISTS cx5_versions' in output
    assert 'BEGIN ROADSCANNER' not in output
