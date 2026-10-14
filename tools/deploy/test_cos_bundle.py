import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import cos_bundle
import publish_cos


class CosBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='atlas-cos-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.assets = self.root / 'source'
        self.assets.mkdir()
        files = {'install-atlas.sh': b'#!/bin/sh\necho local-install\n', 'atlas.py': b'# installer\n',
                 'chart.tgz': b'chart', 'offline/k3s': b'binary', 'components.lock.json': b'{}'}
        for name, content in files.items():
            path = self.assets / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        manifest = {'release': 'sudostack-v0.0.1-rc.5', 'chart': 'chart.tgz',
                    'archives': {name: hashlib.sha256(content).hexdigest() for name, content in files.items()},
                    'sources': {name: {'url': 'https://github.com/owner/release/' + name} for name in files}}
        (self.assets / 'atlas-release.json').write_text(json.dumps(manifest))
        (self.assets / 'credentials.json').write_text('PRIVATE CUSTOMER DATA')
        self.output = self.root / 'release'
        cos_bundle.create(self.assets, self.output)
        self.data = cos_bundle.descriptor(self.output / 'bundle.json')
        self.archive = self.output / self.data['bundle']

    def rewrite_archive(self, changes):
        with tarfile.open(self.archive) as source:
            entries = [(member, source.extractfile(member).read()) for member in source.getmembers()]
        changes(entries)
        with tarfile.open(self.archive, 'w:gz') as target:
            for member, content in entries:
                target.addfile(member, io.BytesIO(content) if member.isfile() else None)
        self.data['files'][self.data['bundle']] = {'size': self.archive.stat().st_size, 'sha256': cos_bundle.checksum(self.archive)}

    def test_round_trip_preserves_owner_bytes_and_excludes_customer_files(self):
        destination = self.root / 'unpacked'
        cos_bundle.unpack(self.archive, destination, self.data)
        manifest = cos_bundle.validate_assets(destination, self.data)
        self.assertFalse((destination / 'credentials.json').exists())
        for name in manifest['archives']:
            self.assertEqual((destination / name).read_bytes(), (self.assets / name).read_bytes())
        self.assertNotIn('@@ATLAS_RELEASE_TAG@@', (self.output / 'install-cos.sh').read_text())
        publish_cos.local_files(self.output)

    def test_packaging_is_reproducible(self):
        another = self.root / 'another'
        cos_bundle.create(self.assets, another)
        self.assertEqual(cos_bundle.checksum(self.archive), cos_bundle.checksum(another / self.data['bundle']))

    def test_checksum_failure_leaves_destination_untouched(self):
        self.archive.write_bytes(b'corrupt')
        target = self.root / 'unpacked'
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            cos_bundle.unpack(self.archive, target, self.data)
        self.assertFalse(target.exists())

    def test_rejects_archive_traversal_links_duplicates_and_extra_files(self):
        original = self.archive.read_bytes()
        for kind in ('traversal', 'symlink', 'duplicate', 'extra'):
            with self.subTest(kind=kind):
                self.archive.write_bytes(original)
                def mutate(entries):
                    member = tarfile.TarInfo('../outside' if kind == 'traversal' else 'extra')
                    if kind == 'symlink':
                        member.type = tarfile.SYMTYPE
                        member.linkname = '/etc/passwd'
                    entries.append(entries[0] if kind == 'duplicate' else (member, b''))
                self.rewrite_archive(mutate)
                target = self.root / ('unpacked-' + kind)
                with self.assertRaises(ValueError):
                    cos_bundle.unpack(self.archive, target, self.data)
                self.assertFalse(target.exists())
                self.assertFalse((self.root / 'outside').exists())

    def test_inner_asset_corruption_is_rejected_even_with_valid_outer_hash(self):
        def mutate(entries):
            for index, (member, content) in enumerate(entries):
                if member.name == 'offline/k3s':
                    entries[index] = (member, b'broken')
        self.rewrite_archive(mutate)
        with self.assertRaisesRegex(ValueError, 'Bundled asset checksum'):
            cos_bundle.unpack(self.archive, self.root / 'unpacked', self.data)

    def test_valid_cache_needs_no_network_and_corrupt_cache_is_not_used(self):
        cache = self.root / 'cache'
        cos_bundle.unpack(self.archive, cache / 'assets', self.data)
        with patch.object(cos_bundle, 'download') as download:
            cos_bundle.fetch(self.output / 'bundle.json', 'https://cos.example/releases/version', cache)
            download.assert_not_called()
            (cache / 'assets/offline/k3s').write_text('corrupted')
            with self.assertRaisesRegex(ValueError, 'Invalid local release asset'):
                cos_bundle.fetch(self.output / 'bundle.json', 'https://cos.example/releases/version', cache)
            download.assert_not_called()

    def test_interrupted_download_can_resume_and_hash_is_checked(self):
        path = self.root / 'download.tar.gz'
        content = b'complete bundle'
        expected = {'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
        def interrupt(command):
            Path(command[command.index('--output') + 1]).write_bytes(content[:5])
            return subprocess.CompletedProcess(command, 28)
        with patch.object(cos_bundle.subprocess, 'run', side_effect=interrupt):
            with self.assertRaisesRegex(RuntimeError, 'resume'):
                cos_bundle.download('https://cos.example/file', path, expected)
        self.assertFalse(path.exists())
        self.assertEqual(path.with_name(path.name + '.part').read_bytes(), content[:5])
        def resume(command):
            self.assertIn('--continue-at', command)
            Path(command[command.index('--output') + 1]).write_bytes(content)
            return subprocess.CompletedProcess(command, 0)
        with patch.object(cos_bundle.subprocess, 'run', side_effect=resume):
            cos_bundle.download('https://cos.example/file', path, expected)
        self.assertEqual(path.read_bytes(), content)

    def test_unsafe_descriptor_and_http_source_are_rejected(self):
        data = copy.deepcopy(self.data)
        data['files']['credentials.json'] = {'size': 1, 'sha256': '0' * 64}
        (self.output / 'bundle.json').write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            cos_bundle.descriptor(self.output / 'bundle.json')
        for url in ('http://cos.example', 'https://user:password@cos.example', 'https://cos.example?token=x'):
            with self.assertRaises(ValueError):
                cos_bundle.https_base(url)

    def test_immutable_conflict_is_detected_before_any_upload(self):
        with patch.object(publish_cos, 'head', return_value={'content-length': '1', 'x-cos-meta-sha256': '0' * 64}), \
             patch.object(publish_cos.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'overwrite'):
                publish_cos.publish(self.output, 'test-12345', 'ap-beijing', 'sudostack', 'https://cos.example', 'all')
            run.assert_not_called()

    def test_launcher_downloads_only_from_cos_then_prepares_local_install(self):
        bindir = self.root / 'bin'
        bindir.mkdir()
        curl = bindir / 'curl'
        curl.write_text('#!' + sys.executable + '\n' + '''import os,sys,shutil
from pathlib import Path
from urllib.parse import urlparse
args=sys.argv[1:]
url=next(x for x in args if x.startswith('https://'))
parsed=urlparse(url)
assert parsed.hostname=='cos.test', 'Unexpected external dependency: '+url
with open(os.environ['COS_TEST_LOG'],'a') as log:log.write(url+'\\n')
destination=args[args.index('-o')+1] if '-o' in args else args[args.index('--output')+1]
shutil.copyfile(Path(os.environ['COS_TEST_RELEASE'])/parsed.path.rsplit('/',1)[1],destination)
''')
        curl.chmod(0o755)
        flock = bindir / 'flock'
        flock.write_text('#!/bin/sh\nexit 0\n')
        flock.chmod(0o755)
        log = self.root / 'requests.log'
        cache = self.root / 'cache'
        env = {**os.environ, 'PATH': str(bindir) + os.pathsep + os.environ['PATH'],
               'ATLAS_COS_BASE': 'https://cos.test/sudostack', 'ATLAS_CACHE_DIR': str(cache),
               'COS_TEST_RELEASE': str(self.output), 'COS_TEST_LOG': str(log)}
        result = subprocess.run(['bash', str(self.output / 'install-cos.sh'), '--download-only'],
                                env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(log.read_text().splitlines()), 3)
        destination = cache / self.data['release'] / 'assets'
        cos_bundle.validate_assets(destination, self.data)
        self.assertTrue((destination / 'install-atlas.sh').is_file())


if __name__ == '__main__':
    unittest.main()
