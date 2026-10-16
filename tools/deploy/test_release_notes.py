"""Check that release inventories stay tied to the actual delivery metadata."""
import json
from pathlib import Path
import tempfile
import unittest

from artifacts import checksum, release_url
from release import required_assets
import release_notes

ROOT = Path(__file__).resolve().parents[2]


class ReleaseNotesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest_path = self.root / 'atlas-release.json'
        self.bundle_path = self.root / 'bundle.json'

    def fixture(self, version):
        lock = json.loads((ROOT / 'manifests/deployment' / (version + '.json')).read_text())
        arch, tag = lock['architecture'], 'sudostack-v' + version
        sources, inputs = {}, {}
        for component, names in required_assets(lock).items():
            c = lock['components'][component]
            repo = c.get('repository', {'k3s': 'k3s-io/k3s', 'gvisor': 'google/gvisor'}.get(component))
            inputs[component] = {name: {'url': release_url(repo, c.get('tag', c['version']), name),
                                        'sha256': 'a' * 64} for name in names}
            if component in ('moss', 'webui', 'router'):
                sources.update(inputs[component])
        helm = f'helm-{lock["components"]["helm"]["version"]}-linux-{arch}.tar.gz'
        chart = f'atlas-mvp-{version}.tgz'
        for name in (helm, chart, f'atlas-nexus-{version}-linux-{arch}.tar.gz',
                     f'caddy-2.10.2-linux-{arch}.tar.gz', 'install-atlas.sh', 'offline--runsc-' + arch):
            sources[name] = {'url': release_url(lock['repository'], tag, name), 'sha256': 'b' * 64}
        # Actual package paths differ from the flattened GitHub asset name.
        sources['offline/runsc-' + arch] = sources.pop('offline--runsc-' + arch)
        self.manifest = {'release': tag, 'architecture': arch, 'sourceLock': lock,
                         'components': lock['components'], 'sources': sources, 'buildInputs': inputs,
                         'archives': {name: item['sha256'] for name, item in sources.items()},
                         'helm': {'archive': helm}, 'chart': chart, 'chartVersion': version,
                         'installerVersion': version}
        bundle = f'sudostack-{version}-linux-{arch}.tar.gz'
        names = (bundle, bundle + '.sha256', 'atlas-release.json', 'components.lock.json',
                 'cos_bundle.py', 'install-cos.sh', 'cleanup-atlas.sh')
        self.data = {'schemaVersion': 1, 'release': tag, 'architecture': arch, 'bundle': bundle,
                     'files': {name: {'size': 123, 'sha256': 'c' * 64} for name in names}}
        self.write()

    def write(self):
        self.manifest_path.write_text(json.dumps(self.manifest))
        digest = checksum(self.manifest_path)
        self.data['manifestSha256'] = digest
        self.data['files']['atlas-release.json']['sha256'] = digest
        self.bundle_path.write_text(json.dumps(self.data))

    def test_every_component_and_actual_archive_url_on_both_architectures(self):
        for version in ('0.0.1-rc.7', '0.0.1-rc.8-arm64'):
            with self.subTest(version=version):
                self.fixture(version)
                notes = release_notes.render(self.manifest_path, self.bundle_path)
                for key, c in self.manifest['components'].items():
                    self.assertIn('| ' + release_notes.LABELS[key] + ' |', notes)
                    self.assertIn('`' + c['version'] + '`', notes)
                for name, item in self.manifest['sources'].items():
                    self.assertIn('`' + name + '`', notes)
                    self.assertIn('](' + item['url'] + ')', notes)
                    self.assertIn('`' + item['sha256'] + '`', notes)
                self.assertIn('集成于 Moss Runtime', notes)
                self.assertIn('PostgreSQL', notes)
                self.assertNotIn('/latest/', notes)

    def test_manifest_cannot_be_replaced_after_bundle_creation(self):
        self.fixture('0.0.1-rc.8-arm64')
        self.manifest_path.write_text(self.manifest_path.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'differs from the qualified bundle'):
            release_notes.render(self.manifest_path, self.bundle_path)

    def test_disagreeing_architecture_or_source_hash_is_rejected(self):
        for mutation in ('architecture', 'source'):
            self.fixture('0.0.1-rc.8-arm64')
            if mutation == 'architecture':
                self.manifest['architecture'] = 'amd64'
            else:
                self.manifest['sources']['install-atlas.sh']['sha256'] = 'd' * 64
            self.write()
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                release_notes.render(self.manifest_path, self.bundle_path)

    def test_new_components_cannot_be_silently_omitted(self):
        self.fixture('0.0.1-rc.8-arm64')
        self.manifest['components']['new-component'] = {'version': '1.0.0'}
        self.write()
        with self.assertRaisesRegex(ValueError, 'Add the new component'):
            release_notes.render(self.manifest_path, self.bundle_path)

    def test_custom_cos_prefix_is_used_for_every_delivery_link(self):
        self.fixture('0.0.1-rc.8-arm64')
        notes = release_notes.render(self.manifest_path, self.bundle_path, 'https://example.com/suite')
        self.assertNotIn(release_notes.COS_BASE, notes)
        for name in (*self.data['files'], 'bundle.json', 'SHA256SUMS'):
            self.assertIn('https://example.com/suite/releases/' + self.data['release'] + '/' + name, notes)


if __name__ == '__main__':
    unittest.main()
