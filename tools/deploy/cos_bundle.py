#!/usr/bin/env python3
"""Prepare or fetch a complete offline bundle. Client needs only stdlib and curl."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
from urllib.parse import quote, urlparse

RELEASE = re.compile(r'sudostack-v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?')
SHA256 = re.compile(r'[a-f0-9]{64}')


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_path(root, name, flat=False):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or str(path) != name or name == '.':
        raise ValueError('Unsafe release path: ' + name)
    if flat and path.name != name:
        raise ValueError('Expected a release filename: ' + name)
    target = root / name
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Unsafe destination: ' + name)
    return target


def https_base(value):
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('An HTTPS base URL without credentials, query or fragment is required')
    return value.rstrip('/')


def descriptor(path):
    data = json.loads(path.read_text())
    if data.get('schemaVersion') != 1 or data.get('architecture') not in ('amd64', 'arm64') or not RELEASE.fullmatch(data.get('release', '')):
        raise ValueError('Invalid COS bundle descriptor')
    if not SHA256.fullmatch(data.get('manifestSha256', '')):
        raise ValueError('Missing pinned release manifest checksum')
    files = data.get('files', {})
    for name, item in files.items():
        safe_path(path.parent, name, flat=True)
        if not SHA256.fullmatch(item.get('sha256', '')) or type(item.get('size')) is not int or item['size'] < 0:
            raise ValueError('Invalid file metadata: ' + name)
    expected = 'sudostack-' + data['release'].removeprefix('sudostack-v') + '-linux-' + data['architecture'] + '.tar.gz'
    allowed = {expected, expected + '.sha256', 'cos_bundle.py', 'install-cos.sh', 'cleanup-atlas.sh', 'atlas-release.json', 'components.lock.json'}
    if data.get('bundle') != expected or allowed != files.keys():
        raise ValueError('Incomplete COS release')
    if files['atlas-release.json']['sha256'] != data['manifestSha256']:
        raise ValueError('Release manifest checksums disagree')
    return data


def matches(path, metadata):
    return path.is_file() and not path.is_symlink() and path.stat().st_size == metadata['size'] and checksum(path) == metadata['sha256']


def download(url, path, metadata):
    https_base(url)
    if matches(path, metadata):
        return
    if path.is_symlink():
        raise ValueError('Download destination is a symlink')
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = safe_path(path.parent, path.name + '.part', flat=True)
    if partial.exists() and partial.stat().st_size > metadata['size']:
        partial.unlink()
    command = ['curl', '--http1.1', '--fail', '--location', '--show-error', '--proto', '=https',
               '--proto-redir', '=https', '--retry', '3', '--retry-all-errors', '--connect-timeout', '20',
               '--max-time', '7200', '--continue-at', '-', '--output', str(partial), url]
    print('Download ' + path.name + ' (' + str(metadata['size']) + ' bytes; resumable)', flush=True)
    result = subprocess.run(command)
    # A complete .part may result in HTTP 416 after an interrupted final rename.
    if matches(partial, metadata):
        partial.replace(path)
        return
    if result.returncode == 33:
        partial.unlink(missing_ok=True)
        result = subprocess.run(command)
    if result.returncode:
        raise RuntimeError('Download interrupted; rerun to resume ' + str(partial))
    if not matches(partial, metadata):
        partial.unlink(missing_ok=True)
        raise ValueError('Bundle size/SHA256 mismatch: ' + path.name)
    partial.replace(path)


def release_manifest(raw, data):
    if hashlib.sha256(raw).hexdigest() != data['manifestSha256']:
        raise ValueError('Release manifest checksum mismatch')
    manifest = json.loads(raw)
    if manifest['release'] != data['release'] or 'atlas-release.json' in manifest['archives']:
        raise ValueError('Bundle belongs to a different release')
    if manifest.get('architecture') != data['architecture']:
        raise ValueError('Bundle architecture differs from the release manifest')
    for name, digest in manifest['archives'].items():
        if not SHA256.fullmatch(digest):
            raise ValueError('Invalid asset checksum: ' + name)
    if not {'install-atlas.sh', 'atlas.py', manifest['chart']} <= manifest['archives'].keys():
        raise ValueError('Bundle does not contain its local installer')
    return manifest


def validate_assets(destination, data):
    manifest = release_manifest(safe_path(destination, 'atlas-release.json').read_bytes(), data)
    for name, expected in manifest['archives'].items():
        path = safe_path(destination, name)
        if not path.is_file() or checksum(path) != expected:
            raise ValueError('Invalid local release asset: ' + name)
    return manifest


def unpack(archive_path, destination, data):
    if not matches(archive_path, data['files'][data['bundle']]):
        raise ValueError('Offline bundle size/SHA256 mismatch')
    if destination.is_symlink():
        raise ValueError('Extraction destination is a symlink')
    if destination.exists() and any(destination.iterdir()):
        validate_assets(destination, data)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.extract-', dir=destination.parent) as temporary:
        staging = Path(temporary) / 'assets'
        staging.mkdir(mode=0o700)
        with tarfile.open(archive_path, 'r:*') as archive:
            members = archive.getmembers()
            names = [member.name for member in members]
            if len(names) != len(set(names)) or any(not member.isfile() for member in members):
                raise ValueError('Bundle contains duplicate entries, links or special files')
            for name in names:
                safe_path(staging, name)
            manifest_member = archive.getmember('atlas-release.json')
            if manifest_member.size > 1024 * 1024:
                raise ValueError('Oversized release manifest')
            manifest = release_manifest(archive.extractfile(manifest_member).read(), data)
            if set(names) != {'atlas-release.json', *manifest['archives']}:
                raise ValueError('Bundle entries do not exactly match the pinned manifest')
            for member in members:
                path = safe_path(staging, member.name)
                path.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                with archive.extractfile(member) as source, path.open('wb') as output:
                    for block in iter(lambda: source.read(1024 * 1024), b''):
                        digest.update(block)
                        output.write(block)
                expected = data['manifestSha256'] if member.name == 'atlas-release.json' else manifest['archives'][member.name]
                if digest.hexdigest() != expected:
                    raise ValueError('Bundled asset checksum mismatch: ' + member.name)
                path.chmod(0o700 if member.mode & 0o111 else 0o600)
        if destination.exists():
            destination.rmdir()
        staging.replace(destination)
    print('Verified offline installation files: ' + str(destination), flush=True)


def fetch(descriptor_path, base, cache):
    data = descriptor(descriptor_path)
    base = https_base(base)
    cache.mkdir(parents=True, exist_ok=True)
    destination = safe_path(cache, 'assets')
    if destination.exists() and any(destination.iterdir()):
        validate_assets(destination, data)
        print('Using verified local installation: ' + str(destination), flush=True)
        return
    archive_path = safe_path(cache, data['bundle'], flat=True)
    download(base + '/' + quote(data['bundle']), archive_path, data['files'][data['bundle']])
    unpack(archive_path, destination, data)


def create(assets, output):
    # Only the producer needs the repository bundler; fetch/unpack stay standalone.
    from bundle import create_archive
    assets, output = assets.resolve(), output.resolve()
    manifest = json.loads((assets / 'atlas-release.json').read_text())
    if not RELEASE.fullmatch(manifest['release']):
        raise ValueError('A fixed sudostack release is required')
    arch = manifest.get('architecture')
    if arch not in ('amd64', 'arm64'):
        raise ValueError('Release architecture must be amd64 or arm64')
    if output.exists() and any(output.iterdir()):
        raise ValueError('COS output directory must be empty')
    for image in manifest.get('imageArchives', []):
        if not image.endswith('.tar.gz') or not (assets / image).is_file():
            raise ValueError('Image archive must be a .tar.gz file: ' + image)
        with (assets / image).open('rb') as source:
            if source.read(3) != b'\x1f\x8b\x08':
                raise ValueError('Image archive is not gzip-compressed: ' + image)
    output.mkdir(parents=True, exist_ok=True)
    name = 'sudostack-' + manifest['release'].removeprefix('sudostack-v') + '-linux-' + arch + '.tar.gz'
    create_archive(assets, output / name)
    with (output / name).open('rb') as source:
        if source.read(3) != b'\x1f\x8b\x08':
            raise ValueError('COS bundle is not gzip-compressed')
    source = Path(__file__).resolve().parent
    for filename in ('cos_bundle.py', 'cleanup-atlas.sh'):
        shutil.copyfile(source / filename, output / filename)
    launcher = (source / 'install-cos.sh').read_text().replace('@@ATLAS_RELEASE_TAG@@', manifest['release'])
    launcher = launcher.replace('@@ATLAS_RELEASE_ARCH@@', arch)
    (output / 'install-cos.sh').write_text(launcher)
    for filename in ('atlas-release.json', 'components.lock.json'):
        shutil.copyfile(assets / filename, output / filename)
    files = {p.name: {'sha256': checksum(p), 'size': p.stat().st_size} for p in sorted(output.iterdir()) if p.is_file()}
    data = {'schemaVersion': 1, 'release': manifest['release'], 'architecture': arch,
            'bundle': name, 'manifestSha256': checksum(assets / 'atlas-release.json'), 'files': files}
    (output / 'bundle.json').write_text(json.dumps(data, indent=2) + '\n')
    descriptor(output / 'bundle.json')
    (output / 'SHA256SUMS').write_text(''.join(checksum(p) + '  ' + p.name + '\n' for p in sorted(output.iterdir()) if p.is_file()))
    print('COS release ready: ' + str(output), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    build = commands.add_parser('create')
    build.add_argument('--assets', required=True, type=Path)
    build.add_argument('--output', required=True, type=Path)
    get = commands.add_parser('fetch')
    get.add_argument('--descriptor', required=True, type=Path)
    get.add_argument('--base', required=True)
    get.add_argument('--cache', required=True, type=Path)
    extract = commands.add_parser('unpack')
    extract.add_argument('--descriptor', required=True, type=Path)
    extract.add_argument('--archive', required=True, type=Path)
    extract.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == 'create':
        create(args.assets, args.output)
    elif args.action == 'fetch':
        fetch(args.descriptor, args.base, args.cache)
    else:
        unpack(args.archive, args.destination, descriptor(args.descriptor))


if __name__ == '__main__':
    main()
