"""Offline image retention must survive GC without admitting wrong or partial images."""
import hashlib
import gzip
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
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
        self.disk = SimpleNamespace(total=100 * 1024**3, free=80 * 1024**3)
        disk_patch = patch.object(images.shutil, 'disk_usage', return_value=self.disk)
        disk_patch.start()
        self.addCleanup(disk_patch.stop)
        self.make_archive()

    def make_archive(self, entries=None, layers=None, manifest_last=False):
        layers = layers or {}
        entries = entries or [{'Config': 'config.json', 'RepoTags': ['runtime:1'], 'Layers': list(layers)}]
        metadata = [('manifest.json', json.dumps(entries).encode()), ('config.json', self.config)]
        members = list(layers.items()) + metadata if manifest_last else metadata + list(layers.items())
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, data in members:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))

    def layer(self, files):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as layer:
            for name, content in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(content)
                layer.addfile(member, io.BytesIO(content))
        return stream.getvalue()

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

    def test_observed_compute_headroom_is_rejected_before_cri_or_publication(self):
        self.disk.total, self.disk.free = 52_721_041_408, 8_459_059_200
        with patch.object(images.subprocess, 'run', return_value=self.status()) as run:
            with self.assertRaisesRegex(ValueError, 'Insufficient space'):
                self.retain()
            run.assert_not_called()
        self.assertFalse(self.directory.exists())

    def test_gzip_layer_expansion_is_budgeted_before_publication(self):
        layer = self.layer({'model.bin': b'0' * 1024**2})
        self.make_archive(layers={'layer.tar.gz': gzip.compress(layer)})
        self.assertLess(self.archive.stat().st_size, 64 * 1024)
        self.disk.free = 20 * 1024**3 + 512 * 1024
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            with self.assertRaisesRegex(ValueError, 'Insufficient space.*unpack='):
                self.retain()
        self.assertFalse(self.directory.exists())

    def test_cold_content_and_unpacked_snapshot_both_require_space(self):
        self.make_archive(layers={'layer.tar': self.layer({'model.bin': b'0' * 1024**2})})
        self.disk.free = 20 * 1024**3 + 1536 * 1024
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            with self.assertRaisesRegex(ValueError, 'Insufficient space'):
                self.retain()
        self.assertFalse(self.directory.exists())

    def test_small_layer_files_include_filesystem_allocation_overhead(self):
        self.make_archive(layers={'layer.tar': self.layer({f'files/{index}': b'x' for index in range(1024)})})
        self.disk.free = 20 * 1024**3 + 4 * 1024**2
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            with self.assertRaisesRegex(ValueError, 'Insufficient space'):
                self.retain()
        self.assertFalse(self.directory.exists())

    def test_capacity_loss_during_copy_does_not_publish_hidden_partial(self):
        self.make_archive(layers={'layer.tar': self.layer({'model.bin': b'0' * 1024**2})})
        copy = images.shutil.copyfileobj

        def consume_space(source, stream):
            copy(source, stream)
            self.disk.free = 20 * 1024**3 + 512 * 1024

        with patch.object(images.subprocess, 'run', return_value=self.status()), \
             patch.object(images.shutil, 'copyfileobj', side_effect=consume_space), \
             patch.object(images.os, 'utime', side_effect=AssertionError('Do not trigger K3s import')):
            with self.assertRaisesRegex(ValueError, 'Insufficient space'):
                self.retain()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_missing_image_reimport_requires_space_before_touching_retained_archive(self):
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            previous = self.retain()
        self.disk.free = 2 * 1024**3
        with patch.object(images.subprocess, 'run', return_value=self.status(pinned=False)), \
             patch.object(images.os, 'utime', side_effect=AssertionError('Do not trigger K3s import')):
            with self.assertRaisesRegex(ValueError, 'Insufficient space'):
                self.retain()
        self.assertEqual(Path(previous['archive']).read_bytes(), self.archive.read_bytes())

    def test_healthy_retained_image_is_a_noop_even_when_node_is_full(self):
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            previous = self.retain()
        self.disk.free = 0
        with patch.object(images.subprocess, 'run', return_value=self.status()), \
             patch.object(images, 'archive_storage', side_effect=AssertionError('No new import needs budgeting')), \
             patch.object(images.os, 'utime', side_effect=AssertionError('Do not reimport')):
            self.assertEqual(self.retain(), previous)

    def test_streamed_layers_can_precede_the_docker_manifest(self):
        self.make_archive(layers={'layer.tar.gz': gzip.compress(self.layer({'model.bin': b'x' * 8192}))}, manifest_last=True)
        storage = images.archive_storage(self.archive)
        self.assertEqual(storage['unpackBytes'], 8192 + 4096)
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            self.assertIn(self.tag, self.retain()['images'])

    def test_missing_layer_is_rejected_before_a_watched_archive_is_created(self):
        self.make_archive([{'Config': 'config.json', 'RepoTags': ['runtime:1'], 'Layers': ['missing.tar']}])
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            with self.assertRaisesRegex(ValueError, 'Cannot estimate expanded image layer: missing.tar'):
                self.retain()
        self.assertFalse(self.directory.exists())

    def test_unsupported_layer_compression_is_rejected_before_publication(self):
        self.make_archive(layers={'layer.zstd': b'\x28\xb5\x2f\xfd' + b'x' * 1024})
        with patch.object(images.subprocess, 'run', return_value=self.status()):
            with self.assertRaisesRegex(ValueError, 'Cannot estimate expanded image layer'):
                self.retain()
        self.assertFalse(self.directory.exists())

    def test_compressed_layers_are_read_once_without_backward_seeks(self):
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, data in [('config.json', self.config), ('layer.tar', b'x' * (2 * 1024 * 1024)),
                               ('manifest.json', json.dumps([{'Config': 'config.json', 'RepoTags': ['runtime:1']}]).encode())]:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        original_open = tarfile.open
        class ForwardOnly(io.BufferedReader):
            def seek(self, *args):
                raise AssertionError('Compressed image import must not replay a layer')
        with self.archive.open('rb') as raw, ForwardOnly(raw) as forward:
            def open_forward(path, **kwargs):
                return original_open(fileobj=forward, **kwargs)
            with patch.object(images.tarfile, 'open', side_effect=open_forward):
                self.assertEqual(images.archive_images(self.archive)[self.tag]['id'], self.image_id)


    def test_metadata_cache_is_bounded_before_any_cri_side_effect(self):
        with tarfile.open(self.archive, 'w:gz') as archive:
            raw = b'x' * (1024 * 1024)
            for number in range(65):
                member = tarfile.TarInfo('metadata-' + str(number))
                member.size = len(raw)
                archive.addfile(member, io.BytesIO(raw))
        with patch.object(images.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'metadata exceeds 64 MiB'):
                self.retain()
            run.assert_not_called()
        self.assertFalse(self.directory.exists())



class OCIArchiveIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'runtime.tar.gz'
        disk_patch = patch.object(images.shutil, 'disk_usage', return_value=SimpleNamespace(
            total=100 * 1024**3, free=80 * 1024**3))
        disk_patch.start()
        self.addCleanup(disk_patch.stop)
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

    def test_retention_waits_for_the_actual_cri_manifest_and_pin(self):
        self.write()
        reference = 'docker.io/library/runtime@' + self.manifest_id
        def status(pinned=True, digests=None):
            return {'id': self.config_id, 'pinned': pinned, 'repoDigests': digests or []}
        responses = [status(False), status(), status(), status(digests=[reference])]
        directory = self.root / 'retained'
        with patch.object(images, 'inspect_image', side_effect=responses), \
             patch.object(images, 'verify_manifest_reference', return_value=True), \
             patch.object(images, 'materialize_digest_reference') as materialize, \
             patch.object(images.time, 'sleep'):
            result = images.retain_archive(self.archive, checksum(self.archive), directory=directory)
        materialize.assert_called_once_with(self.tag, images.archive_images(self.archive)[self.tag])
        self.assertEqual(result['images'][self.tag], status(digests=[reference]))
        self.assertEqual(Path(result['archive']).read_bytes(), self.archive.read_bytes())
        with patch.object(images, 'inspect_image', return_value=status(digests=[reference])), \
             patch.object(images, 'verify_manifest_reference', return_value=True), \
             patch.object(images, 'materialize_digest_reference', side_effect=AssertionError('Already ready')), \
             patch.object(images.os, 'utime', side_effect=AssertionError('Already retained')):
            self.assertEqual(images.retain_archive(self.archive, checksum(self.archive), directory=directory), result)


    def test_correct_config_and_pin_cannot_replace_manifest_proof(self):
        self.write()
        with patch.object(images, 'inspect_image', return_value={'id': self.config_id, 'pinned': True}), \
             patch.object(images, 'verify_manifest_reference', return_value=True), \
             patch.object(images, 'materialize_digest_reference'):
            with self.assertRaisesRegex(TimeoutError, 'imported and pinned'):
                images.retain_archive(self.archive, checksum(self.archive), directory=self.root / 'retained', timeout=0)


    def test_manifest_conflict_is_rejected_before_retaining_any_archive(self):
        self.write()
        with patch.object(images, 'inspect_image', return_value={'id': self.config_id, 'pinned': True}), \
             patch.object(images, 'image_exists', side_effect=[True, False]), \
             patch.object(images, 'materialize_digest_reference') as materialize:
            with self.assertRaisesRegex(ValueError, 'manifest mismatch'):
                images.retain_archive(self.archive, checksum(self.archive), directory=self.root / 'retained')
            materialize.assert_not_called()
        self.assertFalse((self.root / 'retained').exists())


    def test_digest_alias_copies_metadata_locally_without_forcing_or_importing(self):
        identity = self.identity()
        reference = 'docker.io/library/runtime@' + self.manifest_id
        completed = subprocess.CompletedProcess([], 0, reference + '\n', '')
        with patch.object(images, 'verify_manifest_reference', side_effect=[True, False, True]), \
             patch.object(images.subprocess, 'run', return_value=completed) as run:
            images.materialize_digest_reference(self.tag, identity)
        self.assertEqual(run.call_args.args[0], ['k3s', 'ctr', '--namespace', 'k8s.io', 'images',
                                                'tag', '--local', self.tag, reference])


    def test_concurrent_alias_creation_requires_the_exact_manifest_afterwards(self):
        identity = self.identity()
        for exists in [True, False]:
            with self.subTest(exists=exists), \
                 patch.object(images, 'verify_manifest_reference', side_effect=[True, False, exists]), \
                 patch.object(images.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'already exists')):
                if exists:
                    images.materialize_digest_reference(self.tag, identity)
                else:
                    with self.assertRaisesRegex(ValueError, 'digest reference disappeared'):
                        images.materialize_digest_reference(self.tag, identity)


    def test_alias_permission_failure_is_preserved_without_retries(self):
        identity = self.identity()
        with patch.object(images, 'verify_manifest_reference', side_effect=[True, False]) as verify, \
             patch.object(images.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'permission denied')) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                images.materialize_digest_reference(self.tag, identity)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(verify.call_count, 2)


    def test_repository_port_is_kept_when_replacing_the_tag(self):
        identity = self.identity()
        self.assertEqual(images.digest_reference('localhost:5000/path/runtime:1', identity),
                         'localhost:5000/path/runtime@' + self.manifest_id)

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




class ContainerdLookupTests(unittest.TestCase):
    def test_native_filter_quotes_both_name_and_digest_and_uses_quiet_output(self):
        name, digest = 'docker.io/library/runtime:1', 'sha256:' + 'a' * 64
        with patch.object(images.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, name + '\n', '')) as run:
            self.assertTrue(images.image_exists(name, digest))
        self.assertEqual(run.call_args.args[0], ['k3s', 'ctr', '--namespace', 'k8s.io', 'images', 'list', '--quiet',
                                                'name==' + json.dumps(name) + ',target.digest==' + json.dumps(digest)])

    def test_unexpected_lookup_output_fails_closed(self):
        with patch.object(images.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'another:tag\n', '')):
            with self.assertRaisesRegex(ValueError, 'Unexpected containerd image lookup'):
                images.image_exists('runtime:1')


if __name__ == '__main__':
    unittest.main()
