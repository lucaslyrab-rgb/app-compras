"""Validate curated paths, pinned bytes, inventories, core skills and local links."""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

from common import ROOT, load_lock, load_local_lock, safe_path, sha256


def validate(root=ROOT):
    root = Path(root).resolve()
    errors = []
    data = load_lock(root)
    imported = set()
    urls = set()
    for source in data['sources']:
        urls.update(source['requested_urls'])
        inventory = json.loads(safe_path(root, source['inventory']).read_text(encoding='utf-8'))
        if inventory['commit'] != source['commit'] or inventory['repository'] != source['repository'] or inventory['tree_truncated']:
            errors.append(f'Incomplete or mismatched inventory: {source["id"]}')
        blobs = {x['path']: x for x in inventory['files']}
        for entry in source['files']:
            relative = entry['local_path']
            imported.add(relative)
            path = safe_path(root, relative)
            if not path.is_file():
                errors.append(f'Missing import: {relative}')
                continue
            content = path.read_bytes()
            if sha256(content) != entry['sha256']:
                errors.append(f'Changed import: {relative}')
            blob = blobs.get(entry['upstream_path'])
            git_hash = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
            if not blob or blob['blob'] != git_hash:
                errors.append(f'Content differs from upstream Git blob: {relative}')
    for source in load_local_lock(root)['sources']:
        for entry in source['files']:
            relative = entry['local_path']
            if relative in imported:
                errors.append(f'Duplicate import across manifests: {relative}')
            imported.add(relative)
            path = safe_path(root, relative)
            if not path.is_file() or sha256(path.read_bytes()) != entry['sha256']:
                errors.append(f'Missing or changed local bundle file: {relative}')
    expected_skills = set(data.get('core_skills', []))
    if not expected_skills:
        errors.append('No core skills registered in sources.lock.json')
    for path in (root / 'skills').glob('*/SKILL.md'):
        text = path.read_text(encoding='utf-8')
        front = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', text, re.S)
        if not front:
            errors.append(f'Missing skill frontmatter: {path.relative_to(root)}')
            continue
        name = re.search(r'^name:\s*([a-z0-9-]+)\s*$', front[1], re.M)
        if not name or name[1] != path.parent.name or len(name[1]) > 64:
            errors.append(f'Invalid skill name: {path.relative_to(root)}')
        if not re.search(r'^description:\s*\S', front[1], re.M):
            errors.append(f'Missing description: {path.relative_to(root)}')
    actual_skills = {p.parent.name for p in (root / 'skills').glob('*/SKILL.md')}
    if actual_skills != expected_skills:
        errors.append(f'Core skill registry mismatch: {sorted(actual_skills ^ expected_skills)}')
    # Upstream relative links are intentionally unmodified and may point outside snapshots.
    own_docs = [root / 'README.md', root / 'AGENTS.md', root / 'THIRD_PARTY_NOTICES.md']
    own_docs += list((root / 'docs').rglob('*.md')) + list((root / 'catalog').rglob('*.md'))
    own_docs += [p for p in (root / 'skills').rglob('*.md') if p.relative_to(root).as_posix() not in imported]
    for path in own_docs:
        if not path.is_file():
            errors.append(f'Missing document: {path.relative_to(root)}')
            continue
        text = re.sub(r'```.*?```', '', path.read_text(encoding='utf-8'), flags=re.S)
        for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
            link = link.strip('<>')
            parts = urlsplit(link)
            if parts.scheme or parts.netloc or not parts.path:
                continue
            target = (path.parent / unquote(parts.path)).resolve()
            if not target.is_relative_to(root) or not target.exists():
                errors.append(f'Broken local link in {path.relative_to(root)}: {link}')
    return errors, len(imported), len(data['sources'])


if __name__ == '__main__':
    try:
        errors, files, sources = validate()
        for error in errors:
            print(error, file=sys.stderr)
        print(f'{sources} GitHub sources + local bundles, {files} pinned files; {len(errors)} errors')
        sys.exit(bool(errors))
    except (ValueError, OSError, KeyError) as exc:
        print(f'Validation failed: {exc}', file=sys.stderr)
        sys.exit(1)
