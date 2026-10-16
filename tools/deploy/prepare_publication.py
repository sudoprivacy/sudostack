#!/usr/bin/env python3
"""Verify the original CI GitHub delivery and add current release documentation."""
import argparse
import json
from pathlib import Path
import re

from cos_bundle import checksum, descriptor
from release_notes import render


def source_commit(source, jobs, repository, ref, allow_cross_ref=False):
    if (source.get('status') != 'completed' or source.get('conclusion') != 'success'
            or source.get('path') != '.github/workflows/deployment-release.yml'
            or source.get('head_repository', {}).get('full_name') != repository
            or (not allow_cross_ref and source.get('head_branch') != ref)
            or not re.fullmatch(r'[a-f0-9]{40}', source.get('head_sha', ''))):
        raise ValueError('Source must be a successful qualification run from this repository/ref')
    if not all(any(j['name'] == name and j['conclusion'] == 'success' for j in jobs['jobs'])
               for name in ('assemble', 'qualify')):
        raise ValueError('Source run must have successful assemble and qualify jobs')
    return source['head_sha']


def prepare(directory, bundle_path, lock_path, run_url):
    data = descriptor(bundle_path)
    manifest_path = directory / 'atlas-release.json'
    lock = json.loads(lock_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    if manifest['sourceLock'] != lock or json.loads((directory / 'components.lock.json').read_text()) != lock:
        raise ValueError('Original qualified delivery must match the committed lock')
    expected = {}
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        if (not re.fullmatch(r'[a-f0-9]{64}', digest) or Path(name).name != name
                or name in expected or name == 'SHA256SUMS'):
            raise ValueError('Invalid GitHub delivery checksum entry')
        expected[name] = digest
    actual = {p.name: checksum(p) for p in directory.iterdir() if p.is_file() and p.name != 'SHA256SUMS'}
    if not expected or actual != expected or any(p.is_symlink() or not p.is_file() for p in directory.iterdir()):
        raise ValueError('Original GitHub delivery files differ from their CI checksums')
    if checksum(manifest_path) != data['manifestSha256']:
        raise ValueError('GitHub delivery differs from the qualified COS archive')
    release_prefix = f'https://github.com/{lock["repository"]}/releases/download/{data["release"]}/'
    for name, source in manifest['sources'].items():
        if source['url'].startswith(release_prefix):
            asset = source['url'][len(release_prefix):]
            if Path(asset).name != asset or actual.get(asset) != manifest['archives'][name]:
                raise ValueError('GitHub asset differs from the qualified manifest: ' + name)
    # README is external documentation. All manifest-bound installation files
    # retain their exact bytes from the successful source run.
    notes = render(manifest_path, bundle_path, run_url=run_url)
    (directory / 'README.md').write_text(notes)
    (directory / 'SHA256SUMS').write_text(''.join(
        checksum(p) + '  ' + p.name + '\n' for p in sorted(directory.iterdir()) if p.name != 'SHA256SUMS'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--lock', type=Path, required=True)
    parser.add_argument('--run-url', required=True)
    args = parser.parse_args()
    prepare(args.directory, args.bundle, args.lock, args.run_url)


if __name__ == '__main__':
    main()
