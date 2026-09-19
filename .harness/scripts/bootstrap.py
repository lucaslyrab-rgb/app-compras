"""Copy the library into a project while preserving existing instructions."""
import argparse
import os
from pathlib import Path
import shutil
import sys
import tempfile

from common import ROOT

CONTENT = ('AGENTS.md', 'README.md', 'THIRD_PARTY_NOTICES.md', 'sources.lock.json', 'local-sources.lock.json',
           'skills', 'standards', 'catalog', 'upstream', 'docs', 'templates', 'scripts', 'tests')
START = b'<!-- harness-skills:start -->'
END = b'<!-- harness-skills:end -->'


def bootstrap(destination, apply=False, source=ROOT):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    if destination == source or destination.is_relative_to(source):
        raise ValueError('Destination cannot be inside the source library')
    if destination.exists() and not destination.is_dir():
        raise ValueError('Destination is not a directory')
    library = destination / '.harness'
    if library.exists() or library.is_symlink():
        raise ValueError('Existing .harness preserved; review updates manually')
    agents = destination / 'AGENTS.md'
    if agents.is_symlink() or (agents.exists() and not agents.is_file()):
        raise ValueError('AGENTS.md must be a regular file, not a symbolic link')
    old = agents.read_bytes() if agents.exists() else b''
    if START in old or END in old:
        raise ValueError('Existing harness reference preserved; inspect the project first')
    for name in CONTENT:
        item = source / name
        if not item.exists():
            raise ValueError(f'Missing library content: {name}')
        items = [item, *item.rglob('*')] if item.is_dir() else [item]
        if any(p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()) for p in items):
            raise ValueError(f'Library links are not copied: {name}')
    block = (source / 'templates/AGENTS.project.md').read_bytes()
    print(f'Destination: {destination}')
    print('Copy library to .harness/; ' + ('append to' if agents.exists() else 'create') + ' AGENTS.md')
    if not apply:
        print('Preview only. Use --apply to write.')
        return
    destination.mkdir(parents=True, exist_ok=True)
    # Stage in the destination filesystem; cleanup is confined to this temp directory.
    with tempfile.TemporaryDirectory(prefix='.harness-stage-', dir=destination) as staging:
        staged_library = Path(staging) / 'library'
        staged_library.mkdir()
        for name in CONTENT:
            origin = source / name
            target = staged_library / name
            if origin.is_dir():
                shutil.copytree(origin, target, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            else:
                shutil.copy2(origin, target)
        # Confirm no concurrent change before replacing the instructions.
        if agents.is_symlink() or (agents.read_bytes() if agents.exists() else b'') != old:
            raise ValueError('AGENTS.md changed during copy; no instructions were replaced')
        new_agents = Path(staging) / 'AGENTS.md'
        new_agents.write_bytes(old + (b'\n\n' if old else b'') + block)
        # mkdir gives exclusive ownership and refuses an existing library.
        library.mkdir()
        try:
            for item in staged_library.iterdir():
                shutil.move(str(item), library / item.name)
            os.replace(new_agents, agents)
        except Exception:
            # We created this directory; never remove a pre-existing destination.
            resolved_library = library.resolve()
            if resolved_library == destination / '.harness' and not library.is_symlink():
                shutil.rmtree(resolved_library)
            raise
    print('Installed. No external packages, hooks or MCP servers were activated.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', required=True, help='Project directory')
    parser.add_argument('--apply', action='store_true', help='Write the displayed installation')
    args = parser.parse_args()
    try:
        bootstrap(args.dest, args.apply)
    except (ValueError, OSError) as exc:
        parser.exit(1, f'Error: {exc}\n')


if __name__ == '__main__':
    main()
