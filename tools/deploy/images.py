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


def canonical(ref):
    if '/' not in ref:
        return 'docker.io/library/' + ref
    first = ref.split('/')[0]
    return ref if '.' in first or ':' in first or first == 'localhost' else 'docker.io/' + ref


def archive_images(path):
    """Read config identities without extracting or executing archive contents."""
    result = {}
    with tarfile.open(path) as archive:
        def read(name):
            member = archive.getmember(name)
            if not member.isfile() or member.size > 1024 * 1024:
                raise ValueError('Invalid image metadata: ' + name)
            with archive.extractfile(member) as stream:
                return stream.read()
        for entry in json.loads(read('manifest.json')):
            content = read(entry['Config'])
            config = json.loads(content)
            value = {'id': 'sha256:' + hashlib.sha256(content).hexdigest(),
                     'architecture': config.get('architecture'), 'os': config.get('os')}
            for tag in entry.get('RepoTags') or []:
                tag = canonical(tag)
                if tag in result and result[tag] != value:
                    raise ValueError('Conflicting image identity: ' + tag)
                result[tag] = value
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
    images = archive_images(path)
    # Content addressing prevents unrelated releases with the same asset name
    # from replacing one another. Hidden partial files are never import inputs.
    target = directory / (expected + '.tar.gz')
    if directory.is_symlink() or target.is_symlink():
        raise ValueError('Image retention paths must not be symlinks')
    if target.exists():
        if not target.is_file() or checksum(target) != expected:
            raise ValueError('Retained image archive checksum mismatch')
    # Refuse conflicting immutable tags and operational failures before K3s
    # can observe any new archive. Only an absent image is expected here.
    present = {}
    for tag, expected_image in images.items():
        status = inspect_image(tag)
        if status is not None and status.get('id') != expected_image['id']:
            raise ValueError('Existing image identity mismatch: ' + tag)
        if status is not None and status.get('pinned') is True:
            present[tag] = {'id': status['id'], 'pinned': True}
    if target.exists() and len(present) == len(images):
        return {'archive': str(target), 'sha256': expected, 'images': present}
    directory.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        if shutil.disk_usage(directory).free < path.stat().st_size + 2 * 1024**3:
            raise ValueError('Insufficient space to retain image archive with a 2 GiB reserve')
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
    pending, observed = set(images), {}
    while pending:
        for tag in tuple(pending):
            status = inspect_image(tag)
            if status is None:
                observed[tag] = 'not present'
                continue
            if status.get('id') != images[tag]['id']:
                raise ValueError('Imported image identity mismatch: ' + tag)
            observed[tag] = {'id': status['id'], 'pinned': status.get('pinned', False)}
            if status.get('pinned') is True:
                pending.remove(tag)
        if not pending:
            return {'archive': str(target), 'sha256': expected, 'images': observed}
        if time.monotonic() >= deadline:
            raise TimeoutError('K3s has not imported and pinned the retained images: ' + json.dumps(observed))
        time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    print(json.dumps(retain_archive(args.archive, args.sha256)))


if __name__ == '__main__':
    main()
