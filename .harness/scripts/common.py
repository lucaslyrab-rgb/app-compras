"""Shared, dependency-free helpers for the curation tools."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def safe_path(root, relative):
    """Resolve a portable relative path without escaping root, including via links."""
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or '\\' in relative or ':' in relative or '..' in path.parts:
        raise ValueError(f'Unsafe relative path: {relative}')
    root = Path(root).resolve()
    target = root.joinpath(*path.parts).resolve()
    if not target.is_relative_to(root) or target == root:
        raise ValueError(f'Path escapes root: {relative}')
    return target


def load_lock(root=ROOT):
    data = json.loads((Path(root) / 'sources.lock.json').read_text(encoding='utf-8'))
    if data.get('schema_version') != 1 or not isinstance(data.get('sources'), list):
        raise ValueError('Unsupported source manifest')
    seen = set()
    ids = set()
    for source in data['sources']:
        if source['id'] in ids:
            raise ValueError('Duplicate source id')
        ids.add(source['id'])
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', source['repository']):
            raise ValueError('Invalid repository')
        if not re.fullmatch(r'[0-9a-f]{40}', source['commit']):
            raise ValueError('Source must be pinned to a full commit')
        safe_path(root, source['inventory'])
        for entry in source['files']:
            for field in ('upstream_path', 'local_path'):
                safe_path(root, entry[field])
            if entry['local_path'].split('/')[0] not in {'skills', 'standards', 'upstream'}:
                raise ValueError('Import destination is outside content directories')
            if entry['local_path'] in seen or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256']):
                raise ValueError('Duplicate path or invalid SHA-256')
            seen.add(entry['local_path'])
    return data


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def load_local_lock(root=ROOT):
    """Local bundles have hashes and provenance, never invented Git commits."""
    data = json.loads((Path(root) / 'local-sources.lock.json').read_text(encoding='utf-8'))
    if data.get('schema_version') != 1 or not isinstance(data.get('sources'), list):
        raise ValueError('Unsupported local source manifest')
    ids, paths = set(), set()
    for source in data['sources']:
        if source.get('kind') != 'local-bundle' or source['id'] in ids or not source.get('origin'):
            raise ValueError('Invalid local bundle provenance')
        ids.add(source['id'])
        for entry in source['files']:
            safe_path(root, entry['upstream_path'])
            safe_path(root, entry['local_path'])
            if not entry['local_path'].startswith('skills/') or entry['local_path'] in paths:
                raise ValueError('Invalid or duplicate local bundle destination')
            if not re.fullmatch(r'[0-9a-f]{64}', entry['sha256']):
                raise ValueError('Invalid local bundle SHA-256')
            paths.add(entry['local_path'])
    return data


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Wittemberg-harness-skills'})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()
