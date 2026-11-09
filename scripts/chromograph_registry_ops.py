#!/usr/bin/env python3
"""Offline schema setup or explicit native-runtime queue drain.

init-local / export-schema parse source without importing the full app, loading
private keys or touching the original app database. Drain imports main ONLY
when an operator explicitly requests it in the configured native environment.
"""
from __future__ import annotations
import argparse
import ast
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys

ROOT=Path(__file__).resolve().parents[1]


def embedded_schema():
    tree=ast.parse((ROOT/'main.py').read_text())
    schemas={t.id:node.value.value for node in tree.body if isinstance(node,ast.Assign)
             for t in node.targets if isinstance(t,ast.Name) and t.id in ('_CX5_SCHEMA','_CX6_SCHEMA')}
    return schemas['_CX5_SCHEMA']+'\n'+schemas['_CX6_SCHEMA']


def init_local(path):
    path=path.expanduser().resolve()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    os.close(fd)
    connection=sqlite3.connect(path)
    try:
        connection.executescript(embedded_schema())
    finally:connection.close()
    print(json.dumps({'initialized_new_registry':str(path),'legacy_database_touched':False}))


def drain(limit):
    if os.getenv('ROADSCANNER_CX_ENABLED')!='1' or os.getenv('ROADSCANNER_CX_REGISTRY_ENABLED')!='1':
        raise RuntimeError('enable_registry_explicitly_in_operator_runtime')
    sys.path.insert(0,str(ROOT))
    spec=importlib.util.spec_from_file_location('roadscanner_registry_operator',ROOT/'main.py')
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    # Full original app initialization requires its native dependencies and
    # existing admin/key configuration; no bypasses or fake crypto are used.
    spec.loader.exec_module(module)
    results=[]
    for _ in range(limit):
        result=module._cx5_publish_one()
        results.append(result)
        if not result['claimed']:break
    print(json.dumps({'results':results}))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    init=sub.add_parser('init-local');init.add_argument('--database',type=Path,required=True)
    sub.add_parser('export-schema')
    jobs=sub.add_parser('drain');jobs.add_argument('--limit',type=int,default=1)
    args=parser.parse_args()
    if args.command=='init-local':init_local(args.database)
    elif args.command=='export-schema':print(embedded_schema())
    elif 1<=args.limit<=20:drain(args.limit)
    else:parser.error('limit must be between 1 and 20')

if __name__=='__main__':main()
