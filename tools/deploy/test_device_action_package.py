"""Real committed-source package -> standalone verified unpack -> native entry."""
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

import cos_bundle
import publish_cos

ROOT = Path(__file__).resolve().parents[2]


class DeviceActionPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='device-action-package-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.commit = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
        self.output = self.root / 'release'
        cos_bundle.create_actions(ROOT, self.commit, 'arm64', self.output)
        self.data = cos_bundle.descriptor(self.output / 'bundle.json')
        self.archive = self.output / self.data['bundle']

    def rewrite_archive(self, mutate):
        with tarfile.open(self.archive) as archive:
            entries = [(member, archive.extractfile(member).read()) for member in archive.getmembers()]
        mutate(entries)
        with tarfile.open(self.archive, 'w:gz') as archive:
            for member, raw in entries:
                archive.addfile(member, io.BytesIO(raw))
        self.data['files'][self.data['bundle']] = {'size': self.archive.stat().st_size,
                                                  'sha256': cos_bundle.checksum(self.archive)}

    def test_round_trip_uses_committed_closure_without_models_images_or_checkout(self):
        target = self.root / 'installed actions'
        # Only the existing standalone client, descriptor and archive are used.
        result = subprocess.run([sys.executable, str(self.output / 'cos_bundle.py'), 'unpack',
            '--archive', str(self.archive), '--descriptor', str(self.output / 'bundle.json'),
            '--destination', str(target)], cwd=self.root, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = cos_bundle.validate_assets(target, self.data)
        self.assertEqual(manifest['sourceCommit'], self.commit)
        self.assertEqual(manifest['deviceActions']['entry'], 'tools/deploy/device_operation.py')
        self.assertEqual(len(manifest['archives']), 6)
        self.assertFalse((target / '.git').exists())
        self.assertFalse((target / 'install-atlas.sh').exists())
        for name in manifest['archives']:
            expected = subprocess.check_output(['git', '-C', str(ROOT), 'cat-file', 'blob', self.commit + ':' + name])
            self.assertEqual((target / name).read_bytes(), expected)
        self.assertEqual(set(manifest['archives']), set(manifest['deviceActions']['files']))

    @unittest.skipIf(os.name == 'nt', 'Device actions run on the Linux device')
    def test_all_packaged_entrypoints_run_without_source_checkout_or_pythonpath(self):
        target = self.root / 'installation'
        cos_bundle.unpack(self.archive, target, self.data)
        environment = {name: value for name, value in os.environ.items() if name != 'PYTHONPATH'}
        manifest = cos_bundle.validate_assets(target, self.data)
        for name in manifest['archives']:
            result = subprocess.run([sys.executable, str(target / name), '--help'], cwd=self.root,
                env=environment, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, name + ': ' + result.stderr)
            self.assertIn('usage:', result.stdout)

    def test_packaging_is_reproducible_and_has_no_atlas_installer(self):
        other = self.root / 'again'
        cos_bundle.create_actions(ROOT, self.commit, 'arm64', other)
        self.assertEqual(self.archive.read_bytes(), (other / self.data['bundle']).read_bytes())
        self.assertNotIn('install-cos.sh', self.data['files'])
        self.assertNotIn('components.lock.json', self.data['files'])
        with self.assertRaisesRegex(ValueError, 'Atlas publisher'):
            publish_cos.local_files(self.output)

    def test_source_commit_cannot_be_a_mutable_alias(self):
        for commit in ('main', 'HEAD', self.commit[:12]):
            with self.subTest(commit=commit), self.assertRaisesRegex(ValueError, 'full commit'):
                cos_bundle.create_actions(ROOT, commit, 'arm64', self.root / 'bad')
        self.assertFalse((self.root / 'bad').exists())

    def test_kind_and_source_cannot_be_relabelled_on_recovery(self):
        target = self.root / 'bad'
        wrong = copy.deepcopy(self.data)
        wrong['sourceCommit'] = '0' * 40
        with self.assertRaisesRegex(ValueError, 'source closure'):
            cos_bundle.unpack(self.archive, target, wrong)
        self.assertFalse(target.exists())
        wrong = copy.deepcopy(self.data)
        wrong['kind'] = 'unknown'
        path = self.root / 'wrong.json'
        path.write_text(json.dumps(wrong))
        with self.assertRaisesRegex(ValueError, 'Unknown bundle kind'):
            cos_bundle.descriptor(path)

    def test_tampered_action_never_becomes_an_installed_tree(self):
        def change(entries):
            for member, raw in entries:
                if member.name.endswith('/device_operation.py'):
                    member.size = len(raw + b'\n# changed')
                    entries[entries.index((member, raw))] = (member, raw + b'\n# changed')
                    return
        self.rewrite_archive(change)
        target = self.root / 'bad'
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            cos_bundle.unpack(self.archive, target, self.data)
        self.assertFalse(target.exists())

    def test_duplicate_link_and_traversal_entries_are_refused(self):
        original = self.archive.read_bytes()
        metadata = copy.deepcopy(self.data)
        for shape in ('duplicate', 'link', 'traversal'):
            self.archive.write_bytes(original)
            self.data = copy.deepcopy(metadata)
            def change(entries):
                member, raw = copy.deepcopy(entries[-1])
                if shape == 'link':
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/tmp/outside'
                    member.size = 0
                    raw = b''
                elif shape == 'traversal':
                    member.name = '../outside'
                entries.append((member, raw))
            self.rewrite_archive(change)
            target = self.root / shape
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                cos_bundle.unpack(self.archive, target, self.data)
            self.assertFalse(target.exists())
        self.assertFalse((self.root / 'outside').exists())


if __name__ == '__main__':
    unittest.main()
