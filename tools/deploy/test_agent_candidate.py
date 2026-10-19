import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import agent_candidate as candidate
from artifacts import checksum


class AgentCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Candidate Test')
        self.git('config', 'user.email', 'candidate@example.test')
        self.git('config', 'commit.gpgsign', 'false')
        (self.repo / 'file').write_text('committed\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Initial fixture')
        self.revision = self.git('rev-parse', 'HEAD').decode().strip()

    def git(self, *args):
        return candidate.git(self.repo, *args)

    def lock(self):
        sources = {}
        for name, owner in candidate.OWNERS.items():
            path = self.root / (name + '-source.tar')
            candidate.export_source(self.repo, self.revision, path)
            sources[name] = {'repository': 'https://github.com/' + owner, 'revision': self.revision,
                             'archive': path.name, 'sha256': checksum(path)}
        files = {}
        for name in ('http-agent-provider.mjs', 'artifact-manifest.json'):
            (self.root / name).write_text('fixture\n')
            files[name] = checksum(self.root / name)
        lock = {'schema_version': 1, 'kind': 'LocalAgentCandidate', 'architecture': 'arm64',
                'assembler_revision': self.revision, 'sources': sources, 'provider_files': files}
        candidate.json_write(self.root / 'candidate.lock.json', lock)
        return lock

    def image(self, component, lock):
        config = json.dumps({'architecture': 'arm64', 'os': 'linux', 'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + hashlib.sha256(b'fixture').hexdigest()]}}).encode()
        image_id = 'sha256:' + hashlib.sha256(config).hexdigest()
        reference = 'sudo-agent-candidate/' + component + ':fixture'
        entries = [{'Config': 'config.json', 'RepoTags': [reference], 'Layers': ['layer.tar']}]
        path = self.root / (component + '-image.tar.gz')
        with tarfile.open(path, 'w:gz') as archive:
            for name, raw in [('manifest.json', json.dumps(entries).encode()), ('config.json', config), ('layer.tar', b'fixture')]:
                entry = tarfile.TarInfo(name)
                entry.size = len(raw)
                archive.addfile(entry, io.BytesIO(raw))
        record = {'component': component, 'candidate_lock_sha256': checksum(self.root / 'candidate.lock.json'),
                  'source_revision': lock['sources'][candidate.COMPONENTS[component][0]]['revision'],
                  'architecture': 'arm64', 'image': reference, 'image_config_digest': image_id,
                  'archive': path.name, 'sha256': checksum(path)}
        candidate.json_write(self.root / (component + '-image.json'), record)
        return record

    def test_export_uses_committed_bytes_and_excludes_untracked_credentials(self):
        (self.repo / 'file').write_text('dirty\n')
        (self.repo / 'private-token').write_text('must never leave checkout')
        path = self.root / 'source.tar'
        candidate.export_source(self.repo, self.revision, path)
        with tarfile.open(path) as archive:
            self.assertEqual(archive.getnames(), ['file'])
            self.assertEqual(archive.extractfile('file').read(), b'committed\n')
        with self.assertRaises(ValueError):
            candidate.export_source(self.repo, 'main', path)

    def test_lfs_requires_exact_materialized_object(self):
        raw = b'actual large asset'
        pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:' + hashlib.sha256(raw).hexdigest() + '\nsize ' + str(len(raw)) + '\n'
        (self.repo / 'asset').write_text(pointer)
        self.git('add', 'asset')
        self.git('commit', '-qm', 'LFS fixture')
        revision = self.git('rev-parse', 'HEAD').decode().strip()
        path = self.root / 'source.tar'
        with self.assertRaisesRegex(ValueError, 'LFS object'):
            candidate.export_source(self.repo, revision, path)
        (self.repo / 'asset').write_bytes(raw)
        candidate.export_source(self.repo, revision, path)
        with tarfile.open(path) as archive:
            self.assertEqual(archive.extractfile('asset').read(), raw)

    def test_nested_submodule_requires_its_own_checkout_and_exact_tree(self):
        inner = self.root / 'inner'
        middle = self.root / 'middle'
        for repo in (inner, middle):
            repo.mkdir()
            candidate.git(repo, 'init', '-q')
            candidate.git(repo, 'config', 'user.name', 'Candidate Test')
            candidate.git(repo, 'config', 'user.email', 'candidate@example.test')
            candidate.git(repo, 'config', 'commit.gpgsign', 'false')
        (inner / 'inner-file').write_text('pinned inner bytes')
        candidate.git(inner, 'add', '.')
        candidate.git(inner, 'commit', '-qm', 'Inner fixture')
        candidate.git(middle, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', str(inner), 'nested')
        candidate.git(middle, 'commit', '-qam', 'Middle fixture')
        self.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', str(middle), 'vendor')
        self.git('commit', '-qam', 'Outer fixture')
        revision = self.git('rev-parse', 'HEAD').decode().strip()
        path = self.root / 'source.tar'
        with self.assertRaisesRegex(ValueError, r'Initialize pinned submodule checkout: .*vendor/nested at [a-f0-9]{40}'):
            candidate.export_source(self.repo, revision, path)
        self.git('-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive')
        candidate.export_source(self.repo, revision, path)
        with tarfile.open(path) as archive:
            self.assertEqual(archive.extractfile('vendor/nested/inner-file').read(), b'pinned inner bytes')
        missing = '1' * 40
        candidate.git(self.repo / 'vendor', 'update-index', '--cacheinfo', '160000,' + missing + ',nested')
        candidate.git(self.repo / 'vendor', '-c', 'user.name=Candidate Test', '-c', 'user.email=candidate@example.test',
                      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Missing pin fixture')
        self.git('add', 'vendor')
        self.git('commit', '-qm', 'Update fixture')
        with self.assertRaisesRegex(ValueError, 'Missing pinned source tree: .*vendor/nested at ' + missing):
            candidate.export_source(self.repo, self.git('rev-parse', 'HEAD').decode().strip(), path)

    def test_changed_archives_artifacts_and_foreign_owners_fail_before_build(self):
        lock = self.lock()
        self.assertEqual(candidate.load_lock(self.root), lock)
        (self.root / 'moss-source.tar').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'Changed source'):
            candidate.load_lock(self.root)
        lock = self.lock()
        lock['sources']['moss']['repository'] = 'https://example.test/foreign'
        candidate.json_write(self.root / 'candidate.lock.json', lock)
        with self.assertRaisesRegex(ValueError, 'source identity'):
            candidate.load_lock(self.root)
        self.lock()
        (self.root / 'http-agent-provider.mjs').write_text('changed')
        with patch.object(subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Changed Provider'):
                candidate.build(self.root, 'http-provider')
            run.assert_not_called()

    def test_assembly_requires_all_components_and_rejects_stale_records(self):
        lock = self.lock()
        (self.root / 'candidate-images.json').write_text('old success')
        with self.assertRaises(FileNotFoundError):
            candidate.assemble(self.root)
        self.assertFalse((self.root / 'candidate-images.json').exists())
        for component in candidate.COMPONENTS:
            self.image(component, lock)
        self.assertEqual(set(candidate.assemble(self.root)['images']), set(candidate.COMPONENTS))
        record = self.image('webui', lock)
        record['candidate_lock_sha256'] = '0' * 64
        candidate.json_write(self.root / 'webui-image.json', record)
        with self.assertRaisesRegex(ValueError, 'Stale'):
            candidate.assemble(self.root)
        self.assertFalse((self.root / 'candidate-images.json').exists())

    def test_image_config_and_archive_bytes_must_match_record(self):
        lock = self.lock()
        for component in candidate.COMPONENTS:
            self.image(component, lock)
        record = self.image('moss', lock)
        record['image_config_digest'] = 'sha256:' + '0' * 64
        candidate.json_write(self.root / 'moss-image.json', record)
        with self.assertRaisesRegex(ValueError, 'config digest'):
            candidate.assemble(self.root)
        self.image('moss', lock)
        with (self.root / 'moss-image.tar.gz').open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaisesRegex(ValueError, 'Changed image'):
            candidate.assemble(self.root)


if __name__ == '__main__':
    unittest.main()
