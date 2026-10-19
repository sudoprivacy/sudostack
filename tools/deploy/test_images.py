"""Offline image retention must survive GC without admitting wrong or partial images."""
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
        responses = [subprocess.CompletedProcess([], 1, '', 'no such image'),
                     self.status(pinned=False), self.status()]
        def inspect(command, **kwargs):
            self.assertEqual(command, ['k3s', 'crictl', 'inspecti', '--output', 'json', self.tag])
            if len(responses) == 3:
                self.assertFalse(self.directory.exists())
            else:
                files = list(self.directory.iterdir())
                self.assertEqual(len(files), 1)
                self.assertEqual(files[0].read_bytes(), self.archive.read_bytes())
            return responses.pop(0)
        with patch.object(images.subprocess, 'run', side_effect=inspect), patch.object(images.time, 'sleep'):
            result = self.retain()
        self.assertEqual(result['images'][self.tag], {'id': self.image_id, 'pinned': True})
        self.assertEqual(Path(result['archive']).name, checksum(self.archive) + '.tar.gz')
        with patch.object(images.subprocess, 'run', return_value=self.status()), \
             patch.object(images.os, 'utime', side_effect=AssertionError('Do not reimport already pinned images')):
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
        self.assertFalse(self.directory.exists())

    def test_cri_permission_failure_is_not_retried_or_published(self):
        refused = subprocess.CompletedProcess([], 1, '', 'permission denied connecting to containerd')
        with patch.object(images.subprocess, 'run', return_value=refused) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                self.retain()
            self.assertEqual(run.call_count, 1)
        self.assertFalse(self.directory.exists())

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
        with patch.object(images.subprocess, 'run', return_value=self.status()), \
             patch.object(images.shutil, 'copyfileobj', side_effect=fail):
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


class OCIArchiveIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'runtime.tar.gz'
        self.config = b'{"architecture":"amd64","os":"linux"}'
        self.config_id = 'sha256:' + hashlib.sha256(self.config).hexdigest()
        self.tag = 'docker.io/library/runtime:1'
        self.blobs = {self.config_id: self.config}
        self.manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                         'config': {'mediaType': 'application/vnd.oci.image.config.v1+json',
                                    'digest': self.config_id, 'size': len(self.config)}, 'layers': []}
        descriptor = self.descriptor(self.manifest)
        self.manifest_id = descriptor['digest']
        self.index = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json',
                      'manifests': [descriptor]}

    def descriptor(self, value):
        raw = json.dumps(value, separators=(',', ':')).encode()
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        self.blobs[digest] = raw
        return {'mediaType': value['mediaType'], 'digest': digest, 'size': len(raw)}

    def write(self, symlink=None):
        metadata = {'manifest.json': json.dumps([{'Config': 'blobs/sha256/' + self.config_id[7:],
                                                 'RepoTags': ['runtime:1']}]).encode(),
                    'oci-layout': b'{"imageLayoutVersion":"1.0.0"}',
                    'index.json': json.dumps(self.index).encode(),
                    **{'blobs/sha256/' + digest[7:]: raw for digest, raw in self.blobs.items()}}
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, raw in metadata.items():
                member = tarfile.TarInfo(name)
                if name == symlink:
                    member.type, member.linkname = tarfile.SYMTYPE, '/etc/passwd'
                    archive.addfile(member)
                else:
                    member.size = len(raw)
                    archive.addfile(member, io.BytesIO(raw))

    def identity(self):
        self.write()
        return images.archive_images(self.archive)[self.tag]

    def test_manifest_identity_is_bound_to_the_config_and_differs_from_config_identity(self):
        self.assertNotEqual(self.config_id, self.manifest_id)
        self.assertEqual(self.identity(), {'id': self.config_id, 'architecture': 'amd64',
                                           'os': 'linux', 'manifestDigest': self.manifest_id})

    def test_nested_image_index_keeps_the_root_digest_reported_by_cri(self):
        root = self.descriptor(self.index)
        self.index = {'schemaVersion': 2, 'manifests': [root]}
        self.assertEqual(self.identity()['manifestDigest'], root['digest'])
        self.assertNotEqual(root['digest'], self.manifest_id)

    def test_descriptor_supplies_the_optional_manifest_media_type(self):
        raw = json.dumps({key: value for key, value in self.manifest.items() if key != 'mediaType'}).encode()
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        self.blobs[digest] = raw
        self.index['manifests'] = [{**self.index['manifests'][0], 'digest': digest, 'size': len(raw)}]
        self.assertEqual(self.identity()['manifestDigest'], digest)

    def test_conflicting_unnamed_manifests_are_rejected(self):
        self.index['manifests'].append(self.descriptor({**self.manifest, 'annotations': {'variant': 'other'}}))
        with self.assertRaisesRegex(ValueError, 'ambiguous OCI manifest'):
            self.identity()

    def test_exact_name_resolves_multiple_encodings_of_one_config(self):
        self.index['manifests'][0]['annotations'] = {'io.containerd.image.name': self.tag}
        self.index['manifests'].append(self.descriptor({**self.manifest, 'annotations': {'variant': 'other'}}))
        self.assertEqual(self.identity()['manifestDigest'], self.manifest_id)

    def test_corrupt_manifest_is_rejected_before_cri_or_retention(self):
        self.blobs[self.manifest_id] += b' '
        self.write()
        directory = self.root / 'retained'
        with patch.object(images.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'OCI content does not match'):
                images.retain_archive(self.archive, checksum(self.archive), directory=directory)
            run.assert_not_called()
        self.assertFalse(directory.exists())

    def test_corrupt_config_is_rejected_even_when_the_manifest_descriptor_matches(self):
        self.blobs[self.config_id] += b' '
        with self.assertRaisesRegex(ValueError, 'OCI config content does not match'):
            self.identity()

    def test_symlink_manifest_blob_is_not_followed(self):
        self.write(symlink='blobs/sha256/' + self.manifest_id[7:])
        with self.assertRaisesRegex(ValueError, 'Invalid image metadata'):
            images.archive_images(self.archive)

    def test_wrong_config_link_is_rejected(self):
        other = b'{"architecture":"arm64","os":"linux"}'
        other_id = 'sha256:' + hashlib.sha256(other).hexdigest()
        self.blobs[other_id] = other
        self.index['manifests'] = [self.descriptor({**self.manifest, 'config': {
            **self.manifest['config'], 'digest': other_id, 'size': len(other)}})]
        with self.assertRaisesRegex(ValueError, 'Missing or ambiguous OCI manifest'):
            self.identity()

    def test_inspect_cli_is_read_only_and_works_without_k3s(self):
        self.write()
        result = subprocess.run([sys.executable, images.__file__, '--inspect', '--archive', str(self.archive)],
                                capture_output=True, text=True, cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[self.tag]['manifestDigest'], self.manifest_id)
        self.assertEqual(list(self.root.iterdir()), [self.archive])


if __name__ == '__main__':
    unittest.main()
