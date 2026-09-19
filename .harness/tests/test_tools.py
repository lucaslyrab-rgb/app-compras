"""Behavioral checks for preservation, reproducibility and path boundaries."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from bootstrap import bootstrap, CONTENT
from common import ROOT, load_lock, load_local_lock, safe_path, sha256
from sources import restore_missing
from validate import validate


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='harness-skills-test-')
        self.base = Path(self.temp.name)
        self.source = self.base / 'source'
        self.source.mkdir()
        for name in CONTENT:
            path = self.source / name
            if '.' in name:
                path.write_text('sample\n', encoding='utf-8')
            else:
                path.mkdir()
                (path / 'example.txt').write_text(name, encoding='utf-8')
        (self.source / 'templates/AGENTS.project.md').write_bytes(
            b'<!-- harness-skills:start -->\nRead .harness/AGENTS.md\n<!-- harness-skills:end -->\n')
        self.destination = self.base / 'project'

    def tearDown(self):
        self.temp.cleanup()

    def run_bootstrap(self, apply=True, destination=None):
        with contextlib.redirect_stdout(io.StringIO()):
            bootstrap(destination or self.destination, apply, self.source)

    def test_preview_has_no_side_effects(self):
        self.run_bootstrap(apply=False)
        self.assertFalse(self.destination.exists())

    def test_install_preserves_existing_instructions_byte_for_byte(self):
        self.destination.mkdir()
        original = '\ufeff# Projeto\r\nInstruções próprias.\r\n'.encode('utf-8')
        (self.destination / 'AGENTS.md').write_bytes(original)
        self.run_bootstrap()
        new = (self.destination / 'AGENTS.md').read_bytes()
        self.assertTrue(new.startswith(original))
        self.assertEqual(new.count(b'<!-- harness-skills:start -->'), 1)
        self.assertEqual((self.destination / '.harness/skills/example.txt').read_text(), 'skills')

    def test_existing_library_refused_without_changes(self):
        self.run_bootstrap()
        sentinel = self.destination / '.harness/skills/example.txt'
        sentinel.write_text('local edit')
        with self.assertRaises(ValueError):
            self.run_bootstrap()
        self.assertEqual(sentinel.read_text(), 'local edit')

    def test_self_copy_refused(self):
        with self.assertRaises(ValueError):
            self.run_bootstrap(destination=self.source / 'nested')
        self.assertFalse((self.source / 'nested').exists())

    def test_existing_reference_refused(self):
        self.destination.mkdir()
        agents = self.destination / 'AGENTS.md'
        original = b'<!-- harness-skills:start -->'
        agents.write_bytes(original)
        with self.assertRaises(ValueError):
            self.run_bootstrap()
        self.assertEqual(agents.read_bytes(), original)

    def test_symlink_not_followed(self):
        self.destination.mkdir()
        outside = self.base / 'private.md'
        outside.write_text('preserve me')
        try:
            (self.destination / 'AGENTS.md').symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest('Symbolic links are unavailable on this host')
        with self.assertRaises(ValueError):
            self.run_bootstrap()
        self.assertEqual(outside.read_text(), 'preserve me')


class SourceTests(unittest.TestCase):
    def test_path_traversal_rejected(self):
        for path in ('../outside', '/absolute', 'C:/outside', 'upstream/../../outside', 'a\\b'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                safe_path(ROOT, path)

    def test_restore_validates_content_and_preserves_edits(self):
        content = b'original\n'
        source = {'repository': 'owner/repo', 'commit': 'a' * 40, 'files': [
            {'upstream_path': 'README.md', 'local_path': 'upstream/repo/README.md', 'sha256': sha256(content)}]}
        with tempfile.TemporaryDirectory(prefix='harness-restore-test-') as directory:
            root = Path(directory)
            target = root / 'upstream/repo/README.md'
            with self.assertRaises(ValueError):
                restore_missing(source, root, fetch=lambda url: b'wrong bytes')
            self.assertFalse(target.exists())
            self.assertEqual(restore_missing(source, root, fetch=lambda url: content), 1)
            self.assertEqual(restore_missing(source, root, fetch=lambda url: self.fail('Unnecessary network call')), 0)
            target.write_bytes(b'local edit')
            with self.assertRaises(ValueError):
                restore_missing(source, root, fetch=lambda url: content)
            self.assertEqual(target.read_bytes(), b'local edit')

    def test_curated_repository_is_consistent(self):
        errors, files, sources = validate()
        self.assertEqual(errors, [])
        self.assertGreater(files, 0)
        self.assertEqual(sources, len(load_lock()['sources']))

    def test_local_bundle_hashes_are_checked(self):
        local = load_local_lock()
        self.assertTrue(local['sources'])
        for source in local['sources']:
            self.assertEqual(source['kind'], 'local-bundle')
            self.assertNotIn('commit', source)
            for entry in source['files']:
                self.assertEqual(sha256((ROOT / entry['local_path']).read_bytes()), entry['sha256'])


if __name__ == '__main__':
    unittest.main()
