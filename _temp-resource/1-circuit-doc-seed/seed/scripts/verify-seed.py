#!/usr/bin/env python3
"""Verify this research seed, without network access or project installation."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []
stats = {}

def require(condition, message):
    if not condition:
        errors.append(message)

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))

def check_json():
    files = sorted(ROOT.rglob('*.json'))
    for p in files:
        try:
            read_json(p)
        except (ValueError, OSError) as exc:
            errors.append(f'{p.relative_to(ROOT)}: {exc}')
    stats['json_files'] = len(files)

def check_sources():
    manifest = read_json(ROOT / 'sources/file-manifest.json')
    seen = set()
    snapshot_paths = set()
    for record in manifest['files']:
        key = (record['repository'], record['commit'], record['path'])
        require(key not in seen, f'duplicate source: {key}')
        seen.add(key)
        relative = record.get('snapshotPath')
        if relative is None:
            continue
        path = (ROOT / relative).resolve()
        require(path.is_relative_to(ROOT), f'snapshot escaped root: {relative}')
        require(path.is_file(), f'missing snapshot: {relative}')
        if not path.is_file() or not path.is_relative_to(ROOT):
            continue
        b = path.read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest()
        require(blob == record['gitBlobSha1'], f'Git blob mismatch: {relative}')
        require(hashlib.sha256(b).hexdigest() == record['sha256'], f'SHA-256 mismatch: {relative}')
        require(len(b) == record['bytes'], f'length mismatch: {relative}')
        snapshot_paths.add(path)
    actual = {p.resolve() for p in (ROOT/'references/upstream').rglob('*.source')}
    require(actual == snapshot_paths, 'snapshot tree and manifest differ')
    stats['audited_sources'] = len(seen)
    stats['exact_snapshots'] = len(snapshot_paths)

def check_empty_data():
    base = ROOT/'templates/empty-data'
    inv = read_json(base/'inventory.json')
    require(inv == {'schema_version': 1, 'generator_specs': [], 'assertions': {'orderable_lines': 0, 'fitted_lines': 0, 'dnp_or_hand_fit_lines': 0}, 'exclusions': [], 'lines': []}, 'empty inventory shape drift')
    rules = read_json(base/'integration-rules.json')
    require(rules == {'schema_version': 1, 'rules': []}, 'empty integration envelope drift')
    selection = read_json(base/'publication-selection.json')
    require(selection == {'recordIds': [], 'sourceIds': [], 'linkableSourceIds': [], 'documentSelections': [], 'expect': {'records': 0, 'sources': 0, 'integrationRules': 0}}, 'empty selection shape drift')
    stats['empty_data_seeds'] = 3

def unfenced(text):
    return re.sub(r'^```[^\n]*\n.*?^```\s*$', '', text, flags=re.M|re.S)

def check_documents():
    docs = sorted([*ROOT.rglob('*.md'), *ROOT.rglob('*.mdx')])
    links = 0
    for p in docs:
        text = unfenced(p.read_text(encoding='utf-8'))
        for target in re.findall(r'\]\(([^)\n]+)\)', text):
            target = target.strip().split(' "', 1)[0]
            if target.startswith('#') or urlsplit(target).scheme:
                continue
            raw = target.split('#',1)[0].split('?',1)[0]
            if not raw:
                continue
            local = (p.parent/unquote(raw)).resolve()
            links += 1
            require(local.is_relative_to(ROOT), f'{p.relative_to(ROOT)}: link escapes bundle {target}')
            require(local.exists(), f'{p.relative_to(ROOT)}: missing local link {target}')
    mdx = sorted((ROOT/'templates/project-docs').rglob('*.mdx'))
    require(len(mdx) == 10, 'expected ten authored MDX templates')
    for p in mdx:
        text=p.read_text(encoding='utf-8')
        match=re.match(r'^---\n(.*?)\n---\n', text, re.S)
        require(match is not None, f'{p.name}: missing frontmatter')
        if match:
            for key in ('title','description','sidebar_position'):
                require(re.search(r'^'+key+r':\s*\S',match[1],re.M) is not None, f'{p.name}: missing {key}')
        require('{' not in text and '}' not in text, f'{p.name}: unintended MDX expression')
    stats.update(authored_documents=len(docs), local_links=links, mdx_templates=len(mdx))

def main():
    try:
        check_json()
        check_sources()
        check_empty_data()
        check_documents()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors.append(str(exc))
    print(json.dumps({'result': 'failed' if errors else 'passed', 'checks': stats, 'errors': errors, 'scope': 'Seed integrity/structure only; no site build, full runtime, CAD, vendor or hardware validation.'}, indent=2))
    return 1 if errors else 0

if __name__ == '__main__':
    sys.exit(main())
