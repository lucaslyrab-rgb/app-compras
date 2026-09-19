"""Read upstream status or restore absent pinned files; never overwrite edits."""
import argparse
import json
import sys
from urllib.parse import quote

from common import ROOT, download, load_lock, load_local_lock, safe_path, sha256


def restore_missing(source, root=ROOT, fetch=download):
    restored = 0
    for entry in source['files']:
        target = safe_path(root, entry['local_path'])
        if target.exists():
            if not target.is_file() or sha256(target.read_bytes()) != entry['sha256']:
                raise ValueError(f'Local modification preserved: {entry["local_path"]}')
            continue
        url = f'https://raw.githubusercontent.com/{source["repository"]}/{source["commit"]}/{quote(entry["upstream_path"], safe="/")}'
        content = fetch(url)
        if sha256(content) != entry['sha256']:
            raise ValueError(f'Download hash mismatch: {entry["local_path"]}')
        target.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation also protects a file created since the existence check.
        with target.open('xb') as stream:
            stream.write(content)
        restored += 1
    return restored


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check-upstream', action='store_true')
    mode.add_argument('--restore-missing', action='store_true')
    parser.add_argument('--source', help='Limit to one source id from sources.lock.json')
    args = parser.parse_args()
    sources = load_lock()['sources'] + load_local_lock()['sources']
    if args.source:
        sources = [s for s in sources if s['id'] == args.source]
        if not sources:
            parser.error('Unknown source id')
    failures = 0
    for source in sources:
        try:
            if source.get('kind') == 'local-bundle':
                if args.restore_missing:
                    for entry in source['files']:
                        path = safe_path(ROOT, entry['local_path'])
                        if not path.is_file() or sha256(path.read_bytes()) != entry['sha256']:
                            raise ValueError('Local snapshot missing or changed; restore it from this repository Git history')
                print(f'{source["id"]}: LOCAL SNAPSHOT; origin {source["origin"]}; no remote update endpoint')
                continue
            if args.check_upstream:
                base = 'https://api.github.com/repos/' + source['repository']
                metadata = json.loads(download(base))
                branch = quote(metadata['default_branch'], safe='')
                head = json.loads(download(base + '/commits/' + branch))['sha']
                state = 'CURRENT' if head == source['commit'] else 'UPDATE AVAILABLE'
                print(f'{source["id"]}: {state} ({source["commit"][:12]} -> {head[:12]})')
            else:
                count = restore_missing(source)
                print(f'{source["id"]}: restored {count} missing files')
        except Exception as exc:
            failures += 1
            print(f'{source["id"]}: ERROR: {exc}', file=sys.stderr)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
