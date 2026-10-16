"""Protect immutable release promotion and automatic deployment documentation."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from cos_bundle import checksum
import prepare_publication
import release_docs
import test_release_notes


class PublicationTests(unittest.TestCase):
    def fixture(self):
        fixture = test_release_notes.ReleaseNotesTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.fixture('0.0.1-rc.8-arm64')
        self.fixture_data = fixture
        self.root = fixture.root
        self.delivery = self.root / 'delivery'
        self.delivery.mkdir()
        for name, source in fixture.manifest['sources'].items():
            if '/sudostack/releases/download/' in source['url']:
                asset = source['url'].rsplit('/', 1)[1]
                path = self.delivery / asset
                path.write_text('original bytes for ' + name)
                fixture.manifest['archives'][name] = source['sha256'] = checksum(path)
        fixture.write()
        (self.delivery / 'atlas-release.json').write_bytes(fixture.manifest_path.read_bytes())
        self.lock = self.root / 'lock.json'
        self.lock.write_text(json.dumps(fixture.manifest['sourceLock']))
        lock_dir = self.root / 'manifests/deployment'
        lock_dir.mkdir(parents=True)
        (lock_dir / '0.0.1-rc.8-arm64.json').write_bytes(self.lock.read_bytes())
        (self.delivery / 'components.lock.json').write_bytes(self.lock.read_bytes())
        self.write_sums()

    def write_sums(self):
        (self.delivery / 'SHA256SUMS').write_text(''.join(
            checksum(p) + '  ' + p.name + '\n' for p in sorted(self.delivery.iterdir()) if p.name != 'SHA256SUMS'))

    def test_promotion_preserves_every_original_asset_and_adds_readme(self):
        self.fixture()
        before = {p.name: p.read_bytes() for p in self.delivery.iterdir() if p.name != 'SHA256SUMS'}
        prepare_publication.prepare(self.delivery, self.fixture_data.bundle_path, self.lock, 'https://example.com/run')
        self.assertTrue((self.delivery / 'README.md').is_file())
        for name, data in before.items():
            self.assertEqual((self.delivery / name).read_bytes(), data)

    def test_self_consistent_replaced_asset_is_still_rejected_by_manifest(self):
        self.fixture()
        (self.delivery / 'install-atlas.sh').write_text('replacement')
        self.write_sums()
        with self.assertRaisesRegex(ValueError, 'qualified manifest'):
            prepare_publication.prepare(self.delivery, self.fixture_data.bundle_path, self.lock, 'https://example.com/run')

    def test_wrong_lock_and_modified_delivery_are_rejected(self):
        for mutation in ('lock', 'file'):
            with self.subTest(mutation=mutation):
                self.fixture()
                if mutation == 'lock':
                    self.lock.write_text('{}')
                else:
                    (self.delivery / 'install-atlas.sh').write_text('corrupt')
                with self.assertRaises(ValueError):
                    prepare_publication.prepare(self.delivery, self.fixture_data.bundle_path, self.lock, 'https://example.com/run')

    def test_cross_ref_promotion_requires_explicit_opt_in_and_qualified_same_repo(self):
        source = {'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/deployment-release.yml',
                  'head_repository': {'full_name': 'sudoprivacy/sudostack'}, 'head_branch': 'candidate', 'head_sha': 'a' * 40}
        jobs = {'jobs': [{'name': name, 'conclusion': 'success'} for name in ('assemble', 'qualify')]}
        with self.assertRaises(ValueError):
            prepare_publication.source_commit(source, jobs, 'sudoprivacy/sudostack', 'main')
        self.assertEqual(prepare_publication.source_commit(source, jobs, 'sudoprivacy/sudostack', 'main', True), 'a' * 40)
        for mutation in ('repository', 'qualify', 'conclusion'):
            s, j = copy.deepcopy(source), copy.deepcopy(jobs)
            if mutation == 'repository':
                s['head_repository']['full_name'] = 'external/fork'
            elif mutation == 'qualify':
                j['jobs'].pop()
            else:
                s['conclusion'] = 'failure'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                prepare_publication.source_commit(s, j, 'sudoprivacy/sudostack', 'main', True)

    def test_docs_sync_updates_only_target_row_and_is_repeatable(self):
        self.fixture()
        prefix, suffix = '# Deployment\n\n', '\n## Operations\nkeep this\n'
        index = ('\n\n| Version | Arch | Status | Tests |\n| --- | --- | --- | --- |\n'
                 '| [older](releases/older/README.md) | amd64 | keep | keep |\n\n')
        (self.root / 'DEPLOYMENT.md').write_text(prefix + release_docs.START + index + release_docs.END + suffix)
        publication = {'tagName': 'sudostack-v0.0.1-rc.8-arm64',
                       'url': release_docs.REPO + '/releases/tag/sudostack-v0.0.1-rc.8-arm64',
                       'isDraft': False, 'publishedAt': '2026-10-16T00:00:00Z'}
        for _ in range(2):
            release_docs.sync(self.root, self.fixture_data.manifest_path, self.fixture_data.bundle_path,
                              'https://example.com/run', publication, {'nexusd-cohost': '0.2.32'})
        text = (self.root / 'DEPLOYMENT.md').read_text()
        self.assertTrue(text.startswith(prefix) and text.endswith(suffix))
        self.assertIn('| [older]', text)
        self.assertEqual(text.count('| [0.0.1-rc.8-arm64]'), 1)
        self.assertIn('实机验收待记录', text)
        notes = (self.root / 'releases/0.0.1-rc.8-arm64/README.md').read_text()
        self.assertIn('/blob/main/DEPLOYMENT.md', notes)
        self.assertIn('`0.2.32`', notes)
        self.assertNotIn('.github/README', notes)

    def test_docs_cannot_claim_acceptance_of_another_bundle(self):
        self.fixture()
        with self.assertRaisesRegex(ValueError, 'exact published archive'):
            release_docs.documentation(self.fixture_data.manifest_path, self.fixture_data.bundle_path,
                                       'https://example.com/run', acceptance={'passed': True})

    def test_missing_or_duplicate_index_is_rejected(self):
        for body in ('# Old overview', release_docs.START * 2 + release_docs.END):
            with self.assertRaises(ValueError):
                release_docs.update_index(body, '1.2.3', 'arm64', 'CI passed')


if __name__ == '__main__':
    unittest.main()
