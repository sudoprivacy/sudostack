#!/usr/bin/env python3
"""Stage a self-contained Mac engineering candidate from exact component pins."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile

from artifacts import download
from macos_candidate import committed


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sign_staged_component(path, identity, team, *, run=subprocess.run):
    """Sign a staged, input-pinned Mach-O before computing its delivery pins."""
    inspect = ['codesign', '--display', '--verbose=4', str(path)]
    before = run(inspect, capture_output=True, text=True)
    metadata = ['--preserve-metadata=identifier,entitlements'] if before.returncode == 0 else []
    run(['codesign', '--force', '--timestamp', '--options', 'runtime', *metadata,
         '--sign', identity, str(path)], check=True)
    run(['codesign', '--verify', '--strict', str(path)], check=True)
    signature = run(inspect, capture_output=True, text=True, check=True).stderr
    if (not re.search(r'^Authority=Developer ID Application:', signature, re.M)
            or not re.search(r'^TeamIdentifier=' + re.escape(team) + r'$', signature, re.M)
            or not re.search(r'^CodeDirectory .*flags=.*\bruntime\b', signature, re.M)
            or not re.search(r'^Timestamp=.+$', signature, re.M)):
        raise ValueError('The staged binary lacks the required Developer ID signature: ' + path.name)


def write_bundle_pins(directory, manifest):
    paths = sorted(path for path in directory.rglob('*') if path.is_file()
                   and path.relative_to(directory).as_posix() not in ('native-bundle.json', 'SHA256SUMS'))
    manifest['files'] = {path.relative_to(directory).as_posix(): digest(path) for path in paths}
    metadata = directory / 'native-bundle.json'
    metadata.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    checksums = ''.join(digest(path) + '  ' + path.relative_to(directory).as_posix() + '\n'
                        for path in sorted([*paths, metadata]))
    (directory / 'SHA256SUMS').write_text(checksums, encoding='utf-8', newline='\n')


def sign_and_pin(target, component, identity, team):
    sign_staged_component(target, identity, team)
    component.setdefault('sourceSha256', component['sha256'])
    component['sha256'] = digest(target)


def sign_verified_staging_copy(directory, identity, team):
    """Finalize a fresh, verified packaging copy on the signing runner."""
    manifest = json.loads((directory / 'native-bundle.json').read_bytes())
    for name, filename in {'scode': 'scode', 'daemon': 'nexusd-cluster',
                           'operator': 'nexus-agent-enroll', 'grpcurl': 'grpcurl'}.items():
        component = manifest['artifacts'][name]
        relative = 'bin/' + filename
        target = directory / relative
        if (component['file'] != relative or target.is_symlink() or target.parent.is_symlink()
                or digest(target) != component['sha256'] or component['sha256'] != manifest['files'][relative]):
            raise ValueError('Component differs from verified source: ' + name)
        sign_and_pin(target, component, identity, team)
    write_bundle_pins(directory, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('profile', 'scode', 'nexus', 'publisher'):
        parser.add_argument('--' + name + '-repo', type=Path, required=True)
        parser.add_argument('--' + name + '-commit', required=True)
    parser.add_argument('--stack-commit', required=True)
    parser.add_argument('--components', type=Path, required=True,
                        help='Private paths, exact hashes/provenance and pinned Python archive URL')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sign-identity', help='Developer ID Application identity in the Mac Keychain')
    parser.add_argument('--team-id', help='Expected Apple team for signed native components')
    parser.add_argument('--port', type=int, default=2126,
                        help='Declared loopback port; isolated engineering tests may select another free pair')
    args = parser.parse_args()
    if bool(args.sign_identity) != bool(args.team_id):
        parser.error('--sign-identity and --team-id are required together')
    if args.sign_identity and (sys.platform != 'darwin' or not re.fullmatch(r'[A-Z0-9]{10}', args.team_id)):
        parser.error('Component signing requires macOS and a ten-character Apple team ID')
    if not 0 < args.port < 65535:
        raise ValueError('Select a Node port with room for the native enrollment neighbour')
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
    for filename in ('private_agent_activation.py', 'private_node_bootstrap.py', 'private_macos_entry.py',
                     'private_cloud_config.py'):
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
        if digest(target) != artifact['sha256']:
            raise ValueError('Component changed while staging: ' + name)
        if args.sign_identity:
            sign_and_pin(target, artifact, args.sign_identity, args.team_id)
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
                'endpoint': '127.0.0.1:' + str(args.port), 'zone': 'private', 'artifacts': artifacts,
                'sourcePins': {key: digest(args.output / name) for key, name in source_names.items()},
                'python': runtime, 'sources': {name: getattr(args, name + '_commit')
                    for name in ('profile', 'stack', 'scode', 'nexus', 'publisher')}}
    write_bundle_pins(args.output, manifest)
    for path in args.output.rglob('*'):
        relative = path.relative_to(args.output).as_posix()
        path.chmod(0o700 if path.is_dir() else 0o755 if relative.startswith('bin/') or path.suffix in ('.sh', '.command') else 0o600)
    print(json.dumps({'staged': True, 'output': str(args.output), 'platform': platform,
                      'componentsSigned': bool(args.sign_identity),
                      'signed': False, 'notarized': False, 'deploymentVerified': False}))


if __name__ == '__main__':
    main()
