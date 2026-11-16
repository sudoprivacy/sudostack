#!/usr/bin/env python3
"""Run the installed private Mac bundle using its bundled Python runtime."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from private_agent_activation import digest
from private_node_bootstrap import bootstrap


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('install', 'prepare', 'configure', 'doctor', 'executor', 'verifier'),
                        default='install', nargs='?')
    parser.add_argument('--resume', action='store_true',
                        help='Resume the latest native session in the selected Agent workspace')
    args = parser.parse_args()
    if args.resume and args.action not in ('executor', 'verifier'):
        parser.error('--resume requires executor or verifier')
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
    if args.action == 'configure' or (args.action == 'install' and not configured):
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
    if args.action in ('executor', 'verifier') and not configured:
        raise ValueError('Run Start.command configure before opening an Agent')
    result = bootstrap(spec, Path('/bin/bash'))
    if args.action in ('executor', 'verifier'):
        os.chdir(root / 'workspaces' / args.action)
        executable = str(root / 'bin/scode')
        command = [executable, '--auth', 'proxy', '--account', 'sudorouter',
                   '--permission-mode', 'workspace-write']
        if args.resume:
            command.extend(('--resume', 'latest'))
        os.execve(executable, command, env)
    print(json.dumps({'prepared': result['activated'], 'modelConfigured': configured,
                      'root': str(root), 'qualification': 'engineering-candidate',
                      'next': ['Start.command executor', 'Start.command verifier']}))


if __name__ == '__main__':
    main()
