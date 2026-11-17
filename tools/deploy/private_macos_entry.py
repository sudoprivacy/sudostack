#!/usr/bin/env python3
"""Run the installed private Mac bundle using its bundled Python runtime."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from private_agent_activation import digest
from private_cloud_config import install_configuration, read_projection
from private_node_bootstrap import bootstrap


def agent_command(executable, workspace, env, *, resume=False, recover=False):
    """Use the native session catalogue; never keep a second session index."""
    command = [str(executable), '--auth', 'proxy', '--account', 'sudorouter',
               '--permission-mode', 'workspace-write']
    if recover:
        guidance = ('No new session was opened. Check access to ' + str(workspace / '.scode/sessions')
                    + ' and run Start.command doctor before trying again.')
        try:
            result = subprocess.run([str(executable), '--resume', 'list', '--output-format', 'json'],
                                    env=env, cwd=workspace, capture_output=True, text=True,
                                    check=True, timeout=15)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('Reading saved sessions timed out. ' + guidance) from exc
        except subprocess.CalledProcessError as exc:
            raise ValueError('Could not read saved sessions (exit ' + str(exc.returncode) + '). '
                             + guidance) from exc
        try:
            catalogue = json.loads(result.stdout)
            if not isinstance(catalogue, dict) or not isinstance(catalogue.get('sessions'), list):
                raise ValueError('Invalid catalogue shape')
        except ValueError as exc:
            raise ValueError('The saved-session catalogue returned an invalid response. '
                             + guidance) from exc
        resume = bool(catalogue['sessions'])
    if resume:
        command.extend(('--resume', 'latest'))
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('start', 'install', 'prepare', 'configure', 'configure-cloud', 'doctor', 'executor', 'verifier'),
                        default='install', nargs='?')
    parser.add_argument('--resume', action='store_true',
                        help='Resume the latest native session in the selected Agent workspace')
    parser.add_argument('--cloud-user', help='Current member ID from the native desktop login')
    parser.add_argument('--cloud-organization', help='Current organization ID from the native desktop login')
    args = parser.parse_args()
    cloud_files = None
    if args.action == 'configure-cloud':
        if sys.stdin.isatty() or not args.cloud_user or not args.cloud_organization:
            parser.error('configure-cloud requires the native login parent and a projection on stdin')
        cloud_files = read_projection(sys.stdin.buffer, user_id=args.cloud_user,
                                      organization_id=args.cloud_organization)
    elif args.cloud_user or args.cloud_organization:
        parser.error('Cloud account arguments require configure-cloud')
    if args.resume and args.action not in ('executor', 'verifier'):
        parser.error('--resume requires executor or verifier')
    if args.action == 'start' and not (sys.stdin.isatty() and sys.stdout.isatty()):
        parser.error('Open Start.command in Terminal; automation can use install or prepare')
    if os.uname().sysname != 'Darwin' or os.getuid() == 0:
        raise ValueError('Run this Mac bundle as the desktop user, without sudo')
    bundle = Path(__file__).resolve().parent
    manifest = json.loads((bundle / 'native-bundle.json').read_bytes())
    machine = {'x86_64': 'macos-x64', 'arm64': 'macos-arm64'}.get(os.uname().machine)
    if manifest['platform'] != machine or manifest['qualification'] != 'engineering-candidate':
        raise ValueError('This candidate does not match the current Mac architecture')
    for name, expected in manifest['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Bundle contains a path outside its root')
        source = bundle / name
        if not source.is_file() or digest(source) != expected:
            raise ValueError('Bundle checksum differs: ' + name)
    home = Path.home().resolve(strict=True)
    selected = Path(os.environ.get('SUDO_PRIVATE_HOME', str(home / '.local/share/sudoprivate/personal-macos')))
    if not selected.is_absolute() or selected.is_symlink():
        raise ValueError('Choose an absolute non-symlink deployment directory')
    root = selected.resolve()
    if root == home or root in home.parents or root == Path(root.anchor):
        raise ValueError('The deployment directory cannot be HOME or one of its parents')
    if root.exists() and root.stat().st_uid != os.getuid():
        raise ValueError('The deployment directory must belong to the desktop user')
    discovery = home / '.nexus/run/node.json'
    expected_record = {'version': 1, 'endpoint': manifest['endpoint'],
                       'agents_dir': str(root / 'node/data/agents'), 'role': 'founder', 'zone': manifest['zone']}
    if discovery.is_symlink() or (discovery.exists() and json.loads(discovery.read_bytes()) != expected_record):
        raise ValueError('An existing Nexus owner is selected; keep it and arrange explicit integration')
    if args.action == 'doctor' and not root.is_dir():
        raise ValueError('No installed private deployment to diagnose')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Install immutable payload only; user configuration and Node state are never
    # replaced. An interrupted copy can continue, but different bytes are refused.
    for name in [*manifest['files'], 'native-bundle.json', 'SHA256SUMS']:
        source, target = bundle / name, root / name
        parent = target.parent
        while parent != root:
            if parent.is_symlink():
                raise ValueError('Refusing redirected installed payload')
            parent = parent.parent
        if target.is_symlink():
            raise ValueError('Refusing redirected installed file')
        if target.exists():
            if digest(target) != digest(source):
                raise ValueError('An explicit owner upgrade is required: ' + name)
        else:
            if args.action == 'doctor':
                raise ValueError('Installed payload is incomplete: ' + name)
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(prefix='.install-', dir=target.parent, delete=False) as outgoing:
                temporary = Path(outgoing.name)
                try:
                    with source.open('rb') as incoming:
                        shutil.copyfileobj(incoming, outgoing)
                    outgoing.flush()
                    os.fsync(outgoing.fileno())
                    temporary.chmod(0o755 if name.startswith('bin/') or name.endswith(('.sh', '.command')) else 0o600)
                    os.link(temporary, target)  # Complete-file publication without clobber.
                finally:
                    temporary.unlink()
    config = root / 'config'
    if config.is_symlink():
        raise ValueError('Refusing redirected model configuration')
    if cloud_files is not None:
        install_configuration(config, cloud_files)
        print(json.dumps({'modelConfigured': True, 'source': 'cloud-local-runtime'}))
        return
    if args.action == 'doctor' and not config.is_dir():
        raise ValueError('No installed private configuration directory')
    config.mkdir(mode=0o700, exist_ok=True)
    for role in ('executor', 'verifier'):
        workspace = root / 'workspaces' / role
        if workspace.parent.is_symlink() or workspace.is_symlink():
            raise ValueError('Refusing redirected workspace')
        if args.action == 'doctor':
            continue
        workspace.mkdir(mode=0o700, parents=True, exist_ok=True)
        instructions = workspace / 'AGENTS.md'
        if instructions.is_symlink():
            raise ValueError('Refusing redirected workspace instructions')
        if not instructions.exists():
            with instructions.open('xb') as stream:
                stream.write((root / 'roles' / (role + '.md')).read_bytes())
            instructions.chmod(0o600)
    env = {key: value for key, value in os.environ.items() if not key.startswith((
        'ANTHROPIC_', 'OPENAI_', 'PROXY_', 'CLAUDE_CODE_OAUTH', 'NEXUS_', 'SCODE_', 'SUDO_CODE_'))}
    env.update(SUDO_CODE_CONFIG_HOME=str(config), SCODE_SERVICE_ROOT=str(root / 'service-owner'))
    configured = all((config / name).is_file() for name in ('sudocode.json', 'settings.json'))
    if args.action == 'configure' or (args.action in ('start', 'install') and not configured):
        subprocess.run(['/bin/bash', str(root / 'scode-setup.sh'), '--config-dir', str(config)],
                       env=env, cwd=root, check=True)
        configured = all((config / name).is_file() for name in ('sudocode.json', 'settings.json'))
        if not configured:
            raise ValueError('Model configuration is incomplete; no Node was started')
    if args.action == 'configure':
        return
    spec = {name: {'path': str(root / artifact['file']), 'sha256': artifact['sha256']}
            for name, artifact in manifest['artifacts'].items()}
    spec.update(schemaVersion=1, root=str(root), home=str(home), dataDir=str(root / 'node/data'),
                identityDir=str(root / 'node/identity'), nexusRepo=str(root / 'native'),
                publisherRepo=str(root / 'native'), endpoint=manifest['endpoint'],
                zone=manifest['zone'], hostname='localhost', acceptEnrollments=True)
    spec.update(manifest['sourcePins'])
    if args.action == 'doctor':
        subprocess.run([str(root / 'bin/scode'), 'setup', '--check', '--output-format', 'json'],
                       env=env, cwd=root, check=True)
        subprocess.run([str(root / 'bin/scode'), '--auth', 'proxy', '--account', 'sudorouter', 'doctor'],
                       env=env, cwd=(root / 'workspaces/executor') if (root / 'workspaces/executor').is_dir() else root,
                       check=True)
        return
    if args.action in ('start', 'executor', 'verifier') and not configured:
        raise ValueError('Run Start.command configure before opening an Agent')
    result = bootstrap(spec, Path('/bin/bash'))
    if args.action in ('start', 'executor', 'verifier'):
        role = 'executor' if args.action == 'start' else args.action
        workspace = root / 'workspaces' / role
        executable = str(root / 'bin/scode')
        command = agent_command(executable, workspace, env, resume=args.resume,
                                recover=args.action == 'start')
        if args.action == 'start':
            print('环境已准备好。现在可以直接与部署助手对话，例如：帮我检查当前环境，继续下一步。', flush=True)
        os.chdir(workspace)
        os.execve(executable, command, env)
    print(json.dumps({'prepared': result['activated'], 'modelConfigured': configured,
                      'root': str(root), 'qualification': 'engineering-candidate',
                      'next': ['Start.command executor', 'Start.command verifier']}))


def cli():
    """Present expected installation/runtime failures without a Python traceback."""
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print('SudoPrivate: ' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(cli())
