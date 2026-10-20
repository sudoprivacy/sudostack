#!/usr/bin/env python3
"""Publish a verified offline release to COS without replacing immutable objects."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote

from cos_bundle import checksum, descriptor, https_base, matches


def local_files(directory):
    data = descriptor(directory / 'bundle.json')
    files = dict(data['files'])
    for name in ('bundle.json', 'SHA256SUMS'):
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise ValueError('Missing publication file: ' + name)
        files[name] = {'size': path.stat().st_size, 'sha256': checksum(path)}
    for name, expected in files.items():
        if not matches(directory / name, expected):
            raise ValueError('Publication checksum mismatch: ' + name)
    with (directory / data['bundle']).open('rb') as archive:
        if archive.read(3) != b'\x1f\x8b\x08':
            raise ValueError('COS bundle is not gzip-compressed')
    sums = {}
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        if name in sums:
            raise ValueError('Duplicate checksum entry')
        sums[name] = digest
    if sums != {name: item['sha256'] for name, item in files.items() if name != 'SHA256SUMS'}:
        raise ValueError('SHA256SUMS differs from the complete publication plan')
    stamp = 'ATLAS_RELEASE_TAG="${ATLAS_RELEASE_TAG:-' + data['release'] + '}"'
    launcher = (directory / 'install-cos.sh').read_text()
    if stamp not in launcher:
        raise ValueError('COS installer is not pinned to the bundle release')
    # Legacy amd64 launchers predate the architecture stamp.
    if ('ATLAS_RELEASE_ARCH=' in launcher or data['architecture'] == 'arm64') and 'ATLAS_RELEASE_ARCH="' + data['architecture'] + '"' not in launcher:
        raise ValueError('COS installer is not pinned to the bundle architecture')
    return data, files


def head(url):
    result = subprocess.run(['curl', '--http1.1', '--silent', '--show-error', '--head', '--location',
                             '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15',
                             '--max-time', '60', '--retry', '2', '--write-out', '\n%{http_code}', url],
                            text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('COS HEAD failed: ' + result.stderr.strip())
    headers, status = result.stdout.rsplit('\n', 1)
    if status == '404':
        return None
    if status != '200':
        raise RuntimeError('COS HEAD returned HTTP ' + status + ': ' + url)
    fields = {}
    for line in headers.splitlines():
        if line.startswith('HTTP/'):
            fields = {}
        elif ':' in line:
            name, value = line.split(':', 1)
            fields[name.lower()] = value.strip()
    return fields


def remote_matches(headers, expected):
    return headers is not None and headers.get('content-length') == str(expected['size']) and headers.get('x-cos-meta-sha256') == expected['sha256']


def plan_release(base, files):
    pending = []
    for name, expected in files.items():
        headers = head(base + '/' + quote(name))
        if headers is None:
            pending.append(name)
        elif not remote_matches(headers, expected):
            raise ValueError('Refusing to overwrite a different immutable COS object: ' + name)
    return pending


def publish(directory, bucket, region, prefix, public_base, mode, config=None):
    if not re.fullmatch(r'[a-z0-9-]+-\d+', bucket):
        raise ValueError('Use the full COS bucket name including APPID')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*', prefix):
        raise ValueError('Invalid COS prefix')
    public_base = https_base(public_base)
    data, files = local_files(directory)
    release_key = prefix + '/releases/' + data['release']
    release_base = public_base + '/' + release_key
    command = ['coscmd', '-b', bucket, '-r', region]
    if config:
        command += ['-c', str(config)]

    def upload(name, key, immutable, source=None, expected=None):
        source = source or directory / name
        expected = expected or files[name]
        headers = {'Cache-Control': 'public, max-age=31536000, immutable' if immutable else 'no-cache, no-store, must-revalidate',
                   'x-cos-meta-sha256': expected['sha256']}
        if name.endswith('.sh'):
            headers['Content-Type'] = 'text/x-shellscript; charset=utf-8'
        print('Upload ' + key, flush=True)
        subprocess.run([*command, 'upload', '-H', json.dumps(headers), str(source), key], check=True)
        if not remote_matches(head(public_base + '/' + key), expected):
            raise RuntimeError('Uploaded COS object failed size/SHA256 metadata verification: ' + key)

    # Preflight every object before the first write. Publish the descriptor last.
    pending = plan_release(release_base, files)
    entrypoint_key = prefix + '/entrypoints/' + data['release'] + '/install-cos.sh'
    launcher = (directory / 'install-cos.sh').read_text().replace(
        'sudowork-release-1309794936.cos.accelerate.myqcloud.com',
        'sudowork-release-1309794936.cos.ap-beijing.myqcloud.com')
    if 'sudowork-release-1309794936.cos.ap-beijing.myqcloud.com' not in launcher:
        raise ValueError('COS installer lacks the Beijing regional download URL')
    with tempfile.TemporaryDirectory(prefix='atlas-entrypoint-') as temporary:
        entrypoint = Path(temporary) / 'install-cos.sh'
        entrypoint.write_text(launcher)
        entrypoint_meta = {'size': entrypoint.stat().st_size, 'sha256': checksum(entrypoint)}
        existing_entrypoint = head(public_base + '/' + entrypoint_key)
        if existing_entrypoint is not None and not remote_matches(existing_entrypoint, entrypoint_meta):
            raise ValueError('Refusing to overwrite a different immutable COS entrypoint: ' + entrypoint_key)
        if mode == 'latest-only' and pending:
            raise ValueError('Complete the immutable release before updating latest')
        if mode != 'latest-only':
            pending.sort(key=lambda name: (name in ('bundle.json', 'SHA256SUMS'), name))
            for name in pending:
                upload(name, release_key + '/' + name, True)
        if plan_release(release_base, files):
            raise RuntimeError('COS release verification found missing objects')
        if existing_entrypoint is None:
            upload('install-cos.sh', entrypoint_key, True, entrypoint, entrypoint_meta)
        if mode != 'release-only':
            latest_keys = [prefix + '/latest/' + data['architecture']]
            if data['architecture'] == 'amd64':
                latest_keys.append(prefix + '/latest')
            for latest_key in latest_keys:
                upload('install-cos.sh', latest_key + '/install-cos.sh', False, entrypoint, entrypoint_meta)
                upload('cleanup-atlas.sh', latest_key + '/cleanup-atlas.sh', False)
    print('Published COS release: ' + release_base, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--bucket', default='sudowork-release-1309794936')
    parser.add_argument('--region', default='ap-beijing')
    parser.add_argument('--prefix', default='sudostack')
    parser.add_argument('--public-base', default='https://sudowork-release-1309794936.cos.accelerate.myqcloud.com')
    parser.add_argument('--config', type=Path)
    parser.add_argument('--mode', choices=('release-only', 'latest-only', 'all'), default='all')
    args = parser.parse_args()
    publish(args.directory.resolve(), args.bucket, args.region, args.prefix, args.public_base, args.mode, args.config)


if __name__ == '__main__':
    main()
