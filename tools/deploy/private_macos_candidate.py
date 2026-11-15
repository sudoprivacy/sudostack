#!/usr/bin/env python3
"""Stage a self-contained Mac engineering candidate from exact component pins."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import tarfile

from artifacts import download
from macos_candidate import committed


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('profile', 'scode', 'nexus', 'publisher'):
        parser.add_argument('--' + name + '-repo', type=Path, required=True)
        parser.add_argument('--' + name + '-commit', required=True)
    parser.add_argument('--stack-commit', required=True)
    parser.add_argument('--components', type=Path, required=True,
                        help='Private paths, exact hashes/provenance and pinned Python archive URL')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    components = json.loads(args.components.read_bytes())
    platform = components['platform']
    if platform not in ('macos-x64', 'macos-arm64'):
        raise ValueError('Expected a single explicit Mac architecture')
    artifacts = {}
    for name in ('scode', 'daemon', 'operator', 'grpcurl'):
        component = components[name]
        path = Path(component['path'])
        if not component.get('source') or digest(path) != component['sha256']:
            raise ValueError('A pinned binary and its provenance are required: ' + name)
        header = path.read_bytes()[:8]
        expected_cpu = 0x01000007 if platform == 'macos-x64' else 0x0100000C
        if header[:4] != b'\xcf\xfa\xed\xfe' or int.from_bytes(header[4:], 'little') != expected_cpu:
            raise ValueError('The binary does not match this Mac architecture: ' + name)
        artifacts[name] = {'file': 'bin/' + {'daemon': 'nexusd-cluster', 'operator': 'nexus-agent-enroll'}.get(name, name),
                           'sha256': component['sha256'], 'source': component['source']}
    runtime = components['python']
    runtime_target = 'x86_64-apple-darwin' if platform == 'macos-x64' else 'aarch64-apple-darwin'
    if (not re.fullmatch(r'[0-9a-f]{64}', runtime['sha256']) or
            not runtime['url'].startswith('https://github.com/astral-sh/python-build-standalone/releases/download/') or
            not runtime['url'].endswith('-' + runtime_target + '-install_only_stripped.tar.gz')):
        raise ValueError('Pin an official standalone Python release archive')
    stack = Path(__file__).resolve().parents[2]
    files = {}
    for filename in ('private_agent_activation.py', 'private_node_bootstrap.py', 'private_macos_entry.py'):
        files[filename] = committed(stack, args.stack_commit, 'tools/deploy/' + filename)
    files['Start.command'] = committed(stack, args.stack_commit, 'tools/deploy/private-native-start.command')
    files['scode-setup.sh'] = committed(args.scode_repo, args.scode_commit, 'packaging/macos/scode-setup.sh')
    profile = 'profiles/personal-macos/'
    files['PROFILE.md'] = committed(args.profile_repo, args.profile_commit, profile + 'README.md')
    for role in ('executor', 'verifier'):
        files['roles/' + role + '.md'] = committed(args.profile_repo, args.profile_commit, profile + 'agents/' + role + '.md')
    for filename in ('start-founder.sh', 'start-common.sh'):
        files['native/scripts/cluster/' + filename] = committed(args.nexus_repo, args.nexus_commit, 'scripts/cluster/' + filename)
    files['native/scripts/cluster/publish-node-record.py'] = committed(args.publisher_repo, args.publisher_commit,
                                                                      'scripts/cluster/publish-node-record.py')
    files['native/proto/nexus/grpc/vfs/vfs.proto'] = committed(args.nexus_repo, args.nexus_commit, 'proto/nexus/grpc/vfs/vfs.proto')
    files['licenses/SudoCode-LICENSE'] = committed(args.scode_repo, args.scode_commit, 'LICENSE')
    files['licenses/SudoCode-THIRD_PARTY_NOTICES.txt'] = committed(args.scode_repo, args.scode_commit, 'THIRD_PARTY_NOTICES.txt')
    files['licenses/grpcurl-LICENSE'] = Path(components['grpcurl']['licensePath']).read_bytes()
    args.output.mkdir(parents=True, exist_ok=False)
    args.output.chmod(0o700)
    for name, payload in files.items():
        target = args.output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    for name, artifact in artifacts.items():
        target = args.output / artifact['file']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(components[name]['path'], target)
    archive = args.output / 'python-runtime.tar.gz'
    download(runtime['url'], archive, runtime['sha256'])
    # The consumer uses macOS tar before Python is available. Inspect the pinned
    # archive here so it cannot contain devices or escape the private temp root.
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'python':
                raise ValueError('Python archive path escapes its root')
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError('Unsupported Python archive member')
            if member.issym() or member.islnk():
                target = posixpath.normpath(posixpath.join(str(name.parent) if member.issym() else '', member.linkname))
                if not target.startswith('python/'):
                    raise ValueError('Python archive link escapes its root')
    source_names = {'publisherSha256': 'native/scripts/cluster/publish-node-record.py',
                    'protoSha256': 'native/proto/nexus/grpc/vfs/vfs.proto',
                    'launcherSha256': 'native/scripts/cluster/start-founder.sh',
                    'launcherCommonSha256': 'native/scripts/cluster/start-common.sh'}
    manifest = {'schemaVersion': 1, 'qualification': 'engineering-candidate', 'platform': platform,
                'endpoint': '127.0.0.1:2126', 'zone': 'private', 'artifacts': artifacts,
                'sourcePins': {key: digest(args.output / name) for key, name in source_names.items()},
                'python': runtime, 'sources': {name: getattr(args, name + '_commit')
                    for name in ('profile', 'stack', 'scode', 'nexus', 'publisher')},
                'files': {path.relative_to(args.output).as_posix(): digest(path)
                    for path in sorted(args.output.rglob('*')) if path.is_file()}}
    (args.output / 'native-bundle.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    checksums = ''.join(digest(path) + '  ' + path.relative_to(args.output).as_posix() + '\n'
                        for path in sorted(args.output.rglob('*')) if path.is_file())
    (args.output / 'SHA256SUMS').write_text(checksums, encoding='utf-8', newline='\n')
    for path in args.output.rglob('*'):
        relative = path.relative_to(args.output).as_posix()
        path.chmod(0o700 if path.is_dir() else 0o755 if relative.startswith('bin/') or path.suffix in ('.sh', '.command') else 0o600)
    print(json.dumps({'staged': True, 'output': str(args.output), 'platform': platform,
                      'signed': False, 'notarized': False, 'deploymentVerified': False}))


if __name__ == '__main__':
    main()
