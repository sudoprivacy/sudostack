"""Offline image retention must survive GC without admitting wrong or partial images."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import images
from artifacts import checksum


class ImageRetentionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'runtime.tar.gz'
        self.directory = self.root / 'k3s-images'
        self.config = b'{"architecture":"amd64","os":"linux"}'
        self.image_id = 'sha256:' + hashlib.sha256(self.config).hexdigest()
        self.tag = 'docker.io/library/runtime:1'
        self.make_archive()

    def make_archive(self, entries=None):
        entries = entries or [{'Config': 'config.json', 'RepoTags': ['runtime:1']}]
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, data in [('manifest.json', json.dumps(entries).encode()), ('config.json', self.config)]:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))

    def status(self, *, pinned=True, image_id=None):
        return subprocess.CompletedProcess([], 0, json.dumps({'status': {
            'id': image_id or self.image_id, 'pinned': pinned}}), '')

    def retain(self, **kwargs):
        return images.retain_archive(self.archive, checksum(self.archive), directory=self.directory, **kwargs)

    def test_waits_for_cri_pin_and_retains_exact_bytes_without_manual_import(self):
        responses = [subprocess.CompletedProcess([], 1, '', 'image not present'),
                     self.status(pinned=False), self.status()]
        def inspect(command, **kwargs):
            self.assertEqual(command, ['k3s', 'crictl', 'inspecti', '--output', 'json', self.tag])
            files = list(self.directory.iterdir())
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0].read_bytes(), self.archive.read_bytes())
            return responses.pop(0)
        with patch.object(images.subprocess, 'run', side_effect=inspect), patch.object(images.time, 'sleep'):
            result = self.retain()
        self.assertEqual(result['images'][self.tag], {'id': self.image_id, 'pinned': True})
        self.assertEqual(Path(result['archive']).name, checksum(self.archive) + '.tar.gz')
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            self.assertEqual(self.retain(), result)
        self.assertEqual(len(list(self.directory.iterdir())), 1)

    def test_checksum_failure_has_no_retention_or_cri_side_effect(self):
        with patch.object(images.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                images.retain_archive(self.archive, '0' * 64, directory=self.directory)
            run.assert_not_called()
        self.assertFalse(self.directory.exists())

    def test_wrong_existing_image_fails_instead_of_overwriting_tag(self):
        with patch.object(images.subprocess, 'run', return_value=self.status(image_id='sha256:' + '0' * 64)):
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                self.retain()

    def test_unpinned_image_cannot_pass_deployment_gate(self):
        with patch.object(images.subprocess, 'run', return_value=self.status(pinned=False)):
            with self.assertRaisesRegex(TimeoutError, 'imported and pinned'):
                self.retain(timeout=0)
        self.assertEqual(len(list(self.directory.iterdir())), 1)

    def test_corrupt_existing_archive_is_preserved_and_rejected(self):
        self.directory.mkdir()
        target = self.directory / (checksum(self.archive) + '.tar.gz')
        target.write_bytes(b'corrupted')
        with patch.object(images.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Retained image archive checksum mismatch'):
                self.retain()
            run.assert_not_called()
        self.assertEqual(target.read_bytes(), b'corrupted')

    def test_failed_copy_never_publishes_a_partial_archive(self):
        def fail(source, stream):
            stream.write(b'partial')
            raise OSError('interrupted copy')
        with patch.object(images.shutil, 'copyfileobj', side_effect=fail):
            with self.assertRaisesRegex(OSError, 'interrupted copy'):
                self.retain()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_metadata_symlink_is_rejected_without_extraction(self):
        with tarfile.open(self.archive, 'w:gz') as archive:
            member = tarfile.TarInfo('manifest.json')
            member.type, member.linkname = tarfile.SYMTYPE, '/etc/passwd'
            archive.addfile(member)
        with self.assertRaisesRegex(ValueError, 'Invalid image metadata'):
            images.archive_images(self.archive)

    def test_untagged_archive_is_rejected_before_publication(self):
        self.make_archive([{'Config': 'config.json', 'RepoTags': None}])
        with self.assertRaisesRegex(ValueError, 'no tagged images'):
            self.retain()
        self.assertFalse(self.directory.exists())


if __name__ == '__main__':
    unittest.main()
