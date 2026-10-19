#!/usr/bin/env python3
"""Download release assets atomically, checking every cached or downloaded byte."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from urllib.parse import quote, urlparse

RUNTIME_SCRIPTS = ('atlas.py', 'artifacts.py', 'images.py', 'smoke.py', 'webui-smoke.cjs',
                   'mock-openai-server.mjs', 'snapshot.py', 'router.py', 'cleanup-atlas.sh',
                   'diagnostics.py', 'moss-diagnostics.cjs')


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def release_url(repository, tag, asset):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid GitHub repository')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*', tag) or tag in ('latest', 'main', 'master', 'dev', 'edge', 'stable'):
        raise ValueError('An explicit release tag is required')
    if PurePosixPath(asset).name != asset or asset in ('.', '..'):
        raise ValueError('Invalid release asset name')
    return f'https://github.com/{repository}/releases/download/{quote(tag, safe="")}/{quote(asset, safe="")}'


def asset_path(root, name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or str(path) != name:
        raise ValueError('Unsafe asset path: ' + name)
    target = root / name
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Unsafe asset destination: ' + name)
    return target


def download(url, path, expected):
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise ValueError('A SHA256 checksum is required for ' + path.name)
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Release downloads require HTTPS URLs without credentials')
    if path.is_file() and not path.is_symlink() and checksum(path) == expected:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.part', delete=False) as stream:
        temporary = Path(stream.name)
    try:
        subprocess.run(['curl', '--http1.1', '--fail', '--location', '--silent', '--show-error',
                        '--proto', '=https', '--proto-redir', '=https', '--retry', '3',
                        '--retry-all-errors',
                        '--connect-timeout', '20', '--max-time', '1800',
                        url, '--output', str(temporary)], check=True)
        if checksum(temporary) != expected:
            raise ValueError('Checksum mismatch: ' + path.name)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def fetch(manifest, root):
    archives, sources = manifest['archives'], manifest.get('sources', {})
    # Validate the entire plan before starting any download.
    paths = {name: asset_path(root, name) for name in archives}
    for name, expected in archives.items():
        if not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise ValueError('Invalid SHA256 for ' + name)
        if name not in sources and (not paths[name].is_file() or checksum(paths[name]) != expected):
            raise ValueError('No release source for missing/invalid asset: ' + name)
    for name, expected in archives.items():
        if name in sources:
            print('Verify/download ' + name, flush=True)
            download(sources[name]['url'], paths[name], expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--assets', required=True, type=Path)
    args = parser.parse_args()
    fetch(json.loads(args.manifest.read_text()), args.assets.resolve())


if __name__ == '__main__':
    main()
