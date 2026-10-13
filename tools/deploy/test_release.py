import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import artifacts
import atlas
import package
import release

ROOT = Path(__file__).resolve().parents[2]


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='atlas-release-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.lock = json.loads((ROOT / 'manifests/deployment/0.0.1.json').read_text())

    def read_lock(self, value):
        path = self.root / 'lock.json'
        path.write_text(json.dumps(value))
        return release.read_lock(path)

    def test_fixed_versions_and_owner_tags(self):
        self.assertEqual(self.read_lock(self.lock)['version'], '0.0.1')
        for name, field, value in [('moss', 'version', 'latest'), ('webui', 'tag', 'v9.9.9'),
                                   ('nexus', 'repository', 'sudoprivacy/moss'), ('caddy', 'image', 'caddy:latest'),
                                   ('caddy', 'image', 'docker.io/library/caddy:2.10.3-alpine')]:
            with self.subTest(component=name, field=field):
                lock = copy.deepcopy(self.lock)
                lock['components'][name][field] = value
                with self.assertRaises(ValueError):
                    self.read_lock(lock)

    def test_release_preflight_rejects_missing_assets_before_assembly(self):
        metadata = {'tag_name': 'v1.0.0', 'assets': []}
        with patch.object(release, 'github', return_value=metadata):
            with self.assertRaisesRegex(ValueError, 'missing CI release assets: image.tar.gz'):
                release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])

    def test_release_metadata_requires_digest_and_exact_published_tag(self):
        asset = {'name': 'image.tar.gz', 'id': 123,
                 'browser_download_url': 'https://github.com/owner/component/releases/download/v1.0.0/image.tar.gz',
                 'digest': 'sha256:' + 'a' * 64}
        metadata = {'tag_name': 'v1.0.0', 'assets': [asset]}
        with patch.object(release, 'github', return_value=metadata):
            result = release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])
            self.assertEqual(result['image.tar.gz']['sha256'], 'a' * 64)
            asset['digest'] = None
            with self.assertRaises(ValueError):
                release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])
            asset['digest'] = 'sha256:' + 'a' * 64
            metadata['draft'] = True
            with self.assertRaises(ValueError):
                release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])

    def test_download_cache_and_checksum_failure_are_atomic(self):
        target = self.root / 'image.tar.gz'
        target.write_bytes(b'existing')
        expected = hashlib.sha256(b'correct image').hexdigest()

        def transfer(command, **kwargs):
            Path(command[command.index('--output') + 1]).write_bytes(b'truncated image')

        with patch.object(artifacts.subprocess, 'run', side_effect=transfer):
            with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
                artifacts.download('https://github.com/owner/repo/image.tar.gz', target, expected)
        self.assertEqual(target.read_bytes(), b'existing')
        self.assertEqual(list(self.root.glob('*.part')), [])
        target.write_bytes(b'correct image')
        with patch.object(artifacts.subprocess, 'run') as transfer:
            artifacts.download('https://github.com/owner/repo/image.tar.gz', target, expected)
            transfer.assert_not_called()

    def test_image_archive_must_contain_every_locked_image_and_architecture(self):
        path = self.root / 'webui.tar.gz'
        def bundle(architecture):
            files = {'manifest.json': [{'Config': 'config.json', 'RepoTags': ['sudowork-webui:0.2.28']}],
                     'config.json': {'architecture': architecture, 'os': 'linux'}}
            with tarfile.open(path, 'w:gz') as archive:
                for name, value in files.items():
                    raw = json.dumps(value).encode()
                    member = tarfile.TarInfo(name)
                    member.size = len(raw)
                    archive.addfile(member, io.BytesIO(raw))
        bundle('amd64')
        release.verify_image_archive(path, ['docker.io/library/sudowork-webui:0.2.28'])
        with self.assertRaisesRegex(ValueError, 'locked image'):
            release.verify_image_archive(path, ['sudowork-webui:0.2.29'])
        with self.assertRaisesRegex(ValueError, 'locked image'):
            release.verify_image_archive(path, ['sudowork-webui:0.2.28', 'postgres:16-alpine'])
        bundle('arm64')
        with self.assertRaisesRegex(ValueError, 'linux/amd64'):
            release.verify_image_archive(path, ['sudowork-webui:0.2.28'])

    def test_fetch_rejects_paths_before_network_access(self):
        for name in ('../outside', '/absolute', 'offline/../../outside', './file'):
            with self.subTest(name=name), patch.object(artifacts, 'download') as download:
                with self.assertRaises(ValueError):
                    artifacts.fetch({'archives': {name: 'a' * 64}}, self.root)
                download.assert_not_called()
        outside = self.root / 'outside'
        outside.mkdir()
        assets = self.root / 'assets'
        assets.mkdir()
        (assets / 'link').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            artifacts.asset_path(assets, 'link/file')

    def test_another_installation_root_cannot_replace_cluster_credentials(self):
        existing = {'metadata': {'annotations': {'sudostack.io/install-root': '/data/original'}}}
        with patch.object(atlas, 'kube', return_value=json.dumps(existing)), patch.object(atlas, 'apply') as apply:
            with self.assertRaisesRegex(ValueError, 'already managed'):
                atlas.claim_namespace(Path('/data/another-root'))
            apply.assert_not_called()
            atlas.claim_namespace(Path('/data/original'))
            apply.assert_called_once()

    def test_package_round_trip_preserves_owner_sources_and_versions(self):
        assets, publish, destination = (self.root / name for name in ('assets', 'publish', 'customer'))
        assets.mkdir()
        (assets / 'offline').mkdir()
        for name in ('moss.tar.gz', 'webui.tar.gz', 'nexus.tar.gz', 'offline/runsc-amd64'):
            (assets / name).write_bytes(name.encode())
        # Unrelated local state must not become release material.
        (assets / 'credentials.json').write_text('{"password":"not-a-release-asset"}')
        sources = {name: {'url': f'https://github.com/owner/component/releases/download/v1.0.0/{name}',
                          'sha256': artifacts.checksum(assets / name)} for name in ('moss.tar.gz', 'webui.tar.gz')}
        metadata = {'release': 'sudostack-v0.0.1', 'version': '0.0.1', 'sourceLock': self.lock,
                    'sources': sources, 'imageArchives': ['moss.tar.gz', 'webui.tar.gz', 'nexus.tar.gz']}
        (assets / 'build-input.json').write_text(json.dumps(metadata))
        package.package(assets, publish)
        manifest = json.loads((publish / 'atlas-release.json').read_text())
        self.assertEqual(manifest['sources']['moss.tar.gz'], sources['moss.tar.gz'])
        self.assertNotIn('moss.tar.gz', [p.name for p in publish.iterdir()])
        self.assertNotIn('credentials.json', manifest['archives'])
        self.assertIn('/sudostack-v0.0.1/offline--runsc-amd64', manifest['sources']['offline/runsc-amd64']['url'])
        self.assertNotIn('@@ATLAS_RELEASE_TAG@@', (publish / 'install-atlas.sh').read_text())
        with tarfile.open(publish / manifest['chart']) as chart:
            text = chart.extractfile('atlas-mvp/Chart.yaml').read().decode()
            self.assertIn('version: 0.0.1\n', text)
            self.assertIn('appVersion: "0.0.1"', text)

        remote = {source['url']: (assets / name).read_bytes() for name, source in manifest['sources'].items()}

        def transfer(command, **kwargs):
            url = command[command.index('--output') - 1]
            Path(command[command.index('--output') + 1]).write_bytes(remote[url])

        with patch.object(artifacts.subprocess, 'run', side_effect=transfer):
            artifacts.fetch(manifest, destination)
        for name, expected in manifest['archives'].items():
            self.assertEqual(artifacts.checksum(destination / name), expected)
        # The same downloaded layout must also form a complete offline bundle.
        (destination / 'atlas-release.json').write_text(json.dumps(manifest))
        bundle = self.root / 'offline.tar'
        subprocess.run([sys.executable, str(ROOT / 'tools/deploy/bundle.py'), '--assets', str(destination), '--output', str(bundle)], check=True, capture_output=True)
        with tarfile.open(bundle) as archive:
            self.assertIn('offline/runsc-amd64', archive.getnames())
            self.assertNotIn('credentials.json', archive.getnames())


if __name__ == '__main__':
    unittest.main()
