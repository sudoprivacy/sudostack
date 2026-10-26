#!/usr/bin/env python3
"""Retain verified offline images through K3s' managed, GC-pinned importer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import time

from artifacts import checksum

IMAGES_DIRECTORY = Path('/var/lib/rancher/k3s/agent/images')


class _PrefixReader:
    """Replay a layer header while keeping the containing archive sequential."""
    def __init__(self, prefix, stream):
        self.prefix, self.stream = prefix, stream

    def read(self, size=-1):
        if size < 0:
            prefix, self.prefix = self.prefix, b''
            return prefix + self.stream.read()
        prefix, self.prefix = self.prefix[:size], self.prefix[size:]
        return prefix + self.stream.read(size - len(prefix))


def archive_storage(path, block_size=4096):
    """Budget content blobs and expanded layer files without extracting them."""
    content_bytes, layers, links, manifest = 0, {}, {}, None

    def allocated(size):
        return ((size + block_size - 1) // block_size) * block_size

    with tarfile.open(path, 'r|*') as archive:
        for member in archive:
            if member.islnk():
                links[member.name] = member.linkname
                continue
            if not member.isfile():
                continue
            content_bytes += allocated(member.size)
            with archive.extractfile(member) as stream:
                if member.name == 'manifest.json':
                    if member.size > 1024 * 1024:
                        raise ValueError('Invalid image metadata: manifest.json')
                    manifest = json.load(stream)
                    continue
                prefix = stream.read(512)
                if prefix and not any(prefix):
                    layers[member.name] = 0
                    continue
                compressed = prefix.startswith((b'\x1f\x8b', b'BZh', b'\xfd7zXZ\x00'))
                try:
                    if not compressed:
                        tarfile.TarInfo.frombuf(prefix, 'utf-8', 'surrogateescape')
                    with tarfile.open(fileobj=_PrefixReader(prefix, stream), mode='r|*') as layer:
                        # Account for data blocks and an extra filesystem block
                        # per entry for inodes, directory entries and whiteouts.
                        layers[member.name] = sum(allocated(item.size) + block_size for item in layer)
                except (tarfile.TarError, EOFError):
                    layers[member.name] = None
    if not isinstance(manifest, list):
        raise ValueError('Image archive manifest is unavailable for capacity checks')
    unpack_bytes = 0
    for image in manifest:
        names = image.get('Layers', [])
        if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
            raise ValueError('Invalid image layer list')
        for name in names:
            visited = set()
            while name in links:
                if name in visited:
                    raise ValueError('Image layer hard-link cycle')
                visited.add(name)
                name = links[name]
            if layers.get(name) is None:
                raise ValueError('Cannot estimate expanded image layer: ' + name)
            # Shared layers may be unpacked into more than one image chain.
            # Counting every occurrence is conservative when caches are absent.
            unpack_bytes += layers[name]
    return {'contentBytes': content_bytes, 'unpackBytes': unpack_bytes}


def require_retention_space(directory, copy_bytes, storage=None):
    """Keep a working reserve as well as archive, content and unpack capacity."""
    existing = Path(directory)
    while not existing.exists():
        existing = existing.parent
    disk = shutil.disk_usage(existing)
    # K3s' default image GC target leaves 20% free. A fixed 2 GiB reserve can
    # already be below a node's eviction threshold, before any layer expands.
    reserve = max(2 * 1024**3, (disk.total + 4) // 5)
    storage = storage or {'contentBytes': 0, 'unpackBytes': 0}
    required = copy_bytes + storage['contentBytes'] + storage['unpackBytes'] + reserve
    if disk.free < required:
        raise ValueError('Insufficient space for image retention and expansion: '
                         f'available={disk.free}, required={required}, reserve={reserve}, '
                         f'archiveCopy={copy_bytes}, content={storage["contentBytes"]}, '
                         f'unpack={storage["unpackBytes"]}')


def canonical(ref):
    if '/' not in ref:
        return 'docker.io/library/' + ref
    first = ref.split('/')[0]
    return ref if '.' in first or ':' in first or first == 'localhost' else 'docker.io/' + ref


def archive_images(path):
    """Read config and OCI manifest identities without extracting image contents."""
    result = {}
    # Compressed tar seeks replay decompression from the beginning. Capture
    # bounded metadata in one forward pass, skipping large layer payloads.
    metadata, cached_bytes = {}, 0
    with tarfile.open(path, mode='r|*') as stream:
        for member in stream:
            content = None
            cached_bytes -= len(metadata.get(member.name, b'') or b'')
            if member.isfile() and member.size <= 1024 * 1024:
                cached_bytes += member.size
                if cached_bytes > 64 * 1024 * 1024:
                    raise ValueError('Image archive metadata exceeds 64 MiB')
                with stream.extractfile(member) as payload:
                    content = payload.read()
            metadata[member.name] = content
    if metadata:
        def read(name):
            content = metadata.get(name)
            if content is None:
                raise ValueError('Invalid image metadata: ' + name)
            return content
        for entry in json.loads(read('manifest.json')):
            content = read(entry['Config'])
            config = json.loads(content)
            value = {'id': 'sha256:' + hashlib.sha256(content).hexdigest(),
                     'architecture': config.get('architecture'), 'os': config.get('os')}
            for tag in entry.get('RepoTags') or []:
                tag = canonical(tag)
                if tag in result and result[tag] != value:
                    raise ValueError('Conflicting image identity: ' + tag)
                result[tag] = dict(value)
        if 'index.json' in metadata:
            if json.loads(read('oci-layout')).get('imageLayoutVersion') != '1.0.0':
                raise ValueError('Unsupported OCI image layout')
            index = json.loads(read('index.json'))
            if index.get('schemaVersion') != 2 or not isinstance(index.get('manifests'), list):
                raise ValueError('Invalid OCI image index')
            def configs(descriptor, depth=0):
                if depth > 4:
                    raise ValueError('OCI image index nesting is too deep')
                digest = descriptor.get('digest', '')
                if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
                    raise ValueError('Invalid OCI descriptor digest')
                content = read('blobs/sha256/' + digest.removeprefix('sha256:'))
                if len(content) != descriptor.get('size') or 'sha256:' + hashlib.sha256(content).hexdigest() != digest:
                    raise ValueError('OCI content does not match its descriptor')
                manifest = json.loads(content)
                media_type = descriptor.get('mediaType')
                if manifest.get('schemaVersion') != 2 or manifest.get('mediaType', media_type) != media_type:
                    raise ValueError('Invalid OCI image metadata')
                if media_type in ('application/vnd.oci.image.index.v1+json',
                                  'application/vnd.docker.distribution.manifest.list.v2+json'):
                    if not isinstance(manifest.get('manifests'), list):
                        raise ValueError('Invalid OCI image index')
                    return {value for child in manifest['manifests'] for value in configs(child, depth + 1)}
                if media_type not in (
                        'application/vnd.oci.image.manifest.v1+json',
                        'application/vnd.docker.distribution.manifest.v2+json'):
                    raise ValueError('Unsupported OCI image descriptor')
                config = manifest.get('config', {})
                config_digest = config.get('digest', '')
                if not re.fullmatch(r'sha256:[a-f0-9]{64}', config_digest):
                    raise ValueError('Invalid OCI config digest')
                config_content = read('blobs/sha256/' + config_digest.removeprefix('sha256:'))
                if len(config_content) != config.get('size') or 'sha256:' + hashlib.sha256(config_content).hexdigest() != config_digest:
                    raise ValueError('OCI config content does not match its descriptor')
                return {config_digest}

            manifests = []
            for descriptor in index['manifests']:
                config_ids = configs(descriptor)
                annotations = descriptor.get('annotations', {})
                reference = annotations.get('io.containerd.image.name') or annotations.get('org.opencontainers.image.ref.name')
                manifests.append({'digest': descriptor['digest'], 'configs': config_ids,
                                  'reference': canonical(reference) if reference else None})
            for tag, value in result.items():
                candidates = [row for row in manifests if value['id'] in row['configs']]
                named = [row for row in candidates if row['reference'] == tag]
                digests = {row['digest'] for row in named or candidates}
                if len(digests) != 1:
                    raise ValueError('Missing or ambiguous OCI manifest identity: ' + tag)
                value['manifestDigest'] = digests.pop()
    if not result:
        raise ValueError('Image archive contains no tagged images')
    return result


def inspect_image(tag):
    result = subprocess.run(['k3s', 'crictl', 'inspecti', '--output', 'json', tag],
                            capture_output=True, text=True, timeout=20)
    if result.returncode and 'no such image' in result.stderr:
        return None
    result.check_returncode()
    return json.loads(result.stdout)['status']


def digest_reference(tag, image):
    """Bind a repository to the verified archive's root manifest or image index."""
    digest = image.get('manifestDigest')
    if digest is None:
        return None
    repository = tag.split('@', 1)[0]
    if ':' in repository.rsplit('/', 1)[-1]:
        repository = repository.rsplit(':', 1)[0]
    return repository + '@' + digest


def image_exists(reference, digest=None):
    """Query exact containerd metadata through its native filters and quiet output."""
    selector = 'name==' + json.dumps(reference)
    if digest is not None:
        selector += ',target.digest==' + json.dumps(digest)
    result = subprocess.run(['k3s', 'ctr', '--namespace', 'k8s.io', 'images', 'list', '--quiet', selector],
                            capture_output=True, text=True, encoding='utf-8', timeout=20, check=True)
    names = result.stdout.splitlines()
    if names not in ([], [reference]):
        raise ValueError('Unexpected containerd image lookup: ' + reference)
    return bool(names)


def verify_manifest_reference(reference, digest):
    """Refuse a conflicting image even when it shares the expected config identity."""
    if image_exists(reference):
        if not image_exists(reference, digest):
            raise ValueError('Existing image manifest mismatch: ' + reference)
        return True
    return False


def materialize_digest_reference(tag, image):
    """Expose the exact imported manifest to CRI while preserving K3s' labels."""
    reference = digest_reference(tag, image)
    if reference is None:
        return
    digest = image['manifestDigest']
    if not verify_manifest_reference(tag, digest):
        raise ValueError('Imported image reference disappeared: ' + tag)
    if not verify_manifest_reference(reference, digest):
        # The local API copies the existing descriptor and managed pin labels.
        # It neither transfers content nor overwrites an existing reference.
        result = subprocess.run(['k3s', 'ctr', '--namespace', 'k8s.io', 'images', 'tag',
                                 '--local', tag, reference], capture_output=True, text=True,
                                encoding='utf-8', timeout=20)
        if result.returncode:
            # Another importer may have created the same immutable reference.
            if 'already exists' not in result.stderr:
                result.check_returncode()
    if not verify_manifest_reference(reference, digest):
        raise ValueError('Imported image digest reference disappeared: ' + reference)


def image_observation(tag, image, status):
    observation = {'id': status['id'], 'pinned': status.get('pinned', False)}
    reference = digest_reference(tag, image)
    if reference is not None:
        observation['repoDigests'] = status.get('repoDigests') or []
    return observation


def image_ready(tag, image, status):
    reference = digest_reference(tag, image)
    return status.get('pinned') is True and (reference is None or reference in (status.get('repoDigests') or []))


def retain_archive(path, expected, *, directory=IMAGES_DIRECTORY, timeout=300):
    """Publish atomically, then require CRI to report every exact image as pinned.

    K3s watches this directory and also reimports its archives on restart. A
    retained archive is intentional deployment state; removal is an explicit
    retirement operation after all consumers and rollback references are gone.
    """
    path, directory = Path(path), Path(directory)
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise ValueError('An archive SHA256 is required')
    if path.is_symlink() or not path.is_file() or checksum(path) != expected:
        raise ValueError('Image archive checksum mismatch: ' + str(path))
    # Content addressing prevents unrelated releases with the same asset name
    # from replacing one another. Hidden partial files are never import inputs.
    target = directory / (expected + '.tar.gz')
    if directory.is_symlink() or target.is_symlink():
        raise ValueError('Image retention paths must not be symlinks')
    if target.exists():
        if not target.is_file() or checksum(target) != expected:
            raise ValueError('Retained image archive checksum mismatch')
    else:
        # Refuse obviously undersized nodes before scanning large layer blobs
        # or creating anything inside K3s' watched directory.
        require_retention_space(directory, path.stat().st_size)
    images = archive_images(path)
    # Refuse conflicting immutable tags and operational failures before K3s
    # can observe any new archive. Only an absent image is expected here.
    present = {}
    for tag, expected_image in images.items():
        status = inspect_image(tag)
        if status is not None and status.get('id') != expected_image['id']:
            raise ValueError('Existing image identity mismatch: ' + tag)
        reference = digest_reference(tag, expected_image)
        has_references = True
        if reference is not None:
            has_tag = verify_manifest_reference(tag, expected_image['manifestDigest'])
            has_digest = verify_manifest_reference(reference, expected_image['manifestDigest'])
            has_references = has_tag and has_digest
        if status is not None and has_references and image_ready(tag, expected_image, status):
            present[tag] = image_observation(tag, expected_image, status)
    if target.exists() and len(present) == len(images):
        return {'archive': str(target), 'sha256': expected, 'images': present}
    storage = archive_storage(path)
    require_retention_space(directory, 0 if target.exists() else path.stat().st_size, storage)
    directory.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with tempfile.NamedTemporaryFile(dir=directory, prefix='.', suffix='.part', delete=False) as stream:
            temporary = Path(stream.name)
        try:
            with temporary.open('wb') as stream:
                with path.open('rb') as source:
                    shutil.copyfileobj(source, stream)
                stream.flush()
                os.fsync(stream.fileno())
            if checksum(temporary) != expected:
                raise ValueError('Image archive changed during retention')
            # Another process may have used space while the hidden copy was
            # written. Refuse before exposing it to K3s' automatic importer.
            require_retention_space(directory, 0, storage)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        if os.name == 'posix':
            descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    # Also repairs an externally pruned image when conditional import caching
    # is enabled. Do not change K3s' cache, GC settings, or service lifecycle.
    os.utime(target, None)
    deadline = time.monotonic() + timeout
    pending, observed, materialized = set(images), {}, set()
    while pending:
        for tag in tuple(pending):
            status = inspect_image(tag)
            if status is None:
                observed[tag] = 'not present'
                continue
            if status.get('id') != images[tag]['id']:
                raise ValueError('Imported image identity mismatch: ' + tag)
            observed[tag] = image_observation(tag, images[tag], status)
            if digest_reference(tag, images[tag]) is not None and status.get('pinned') is True and tag not in materialized:
                materialize_digest_reference(tag, images[tag])
                materialized.add(tag)
                # The CRI cache consumes asynchronous containerd image events.
                status = inspect_image(tag)
                if status is None:
                    continue
                if status.get('id') != images[tag]['id']:
                    raise ValueError('Imported image identity mismatch: ' + tag)
                observed[tag] = image_observation(tag, images[tag], status)
            if image_ready(tag, images[tag], status):
                pending.remove(tag)
        if not pending:
            return {'archive': str(target), 'sha256': expected, 'images': observed}
        if time.monotonic() >= deadline:
            raise TimeoutError('K3s has not imported and pinned the retained images: ' + json.dumps(observed))
        time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--inspect', action='store_true', help='Read archive identities without importing or retaining images')
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(archive_images(args.archive)))
        return
    if not args.sha256:
        parser.error('--sha256 is required when retaining an image archive')
    print(json.dumps(retain_archive(args.archive, args.sha256)))


if __name__ == '__main__':
    main()
