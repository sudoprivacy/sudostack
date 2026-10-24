#!/usr/bin/env python3
"""Install a verified Linux user-service cohost; never interrupt a live runtime.

This is the shared executable-placement step of deploy. Identity, authenticated
readiness, domain joining and Agent creation remain native component operations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import tempfile


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def systemctl(*args, check=True):
    return subprocess.run(['systemctl', '--user', *args], check=check,
                          capture_output=True, text=True, timeout=30)


def private_directory(path):
    if path.is_symlink():
        raise ValueError('A managed directory cannot be a symlink: ' + str(path))
    if not path.exists():
        private_directory(path.parent)
        path.mkdir(mode=0o700)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError('A managed directory must belong to the current user: ' + str(path))
    if stat.S_IMODE(info.st_mode) & 0o022:
        raise ValueError('A managed directory cannot be writable by other users: ' + str(path))
    # Do not repair or narrow existing operator directories as a side effect.


def quoted(value):
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Control characters are not permitted in service values')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def unit_path(value):
    """A single native path directive, not an ExecStart argument list."""
    if not Path(value).is_absolute() or value != value.strip() or '\\' in value or any(ord(c)<32 or ord(c)==127 for c in value):
        raise ValueError('Use a literal absolute unit path without controls or backslashes')
    return value.replace('%','%%')


def publish(path, payload, mode):
    """Publish complete bytes without overwriting a competing destination."""
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def properties(unit):
    result = systemctl('show', unit, '--property=LoadState,ActiveState,SubState,MainPID,FragmentPath')
    return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)


def validate(options):
    if platform.system() != 'Linux':
        raise ValueError('This adapter requires Linux user systemd; other placements use their native adapter')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', options.unit):
        raise ValueError('Expected a simple user-service name without .service')
    if not re.fullmatch(r'[a-f0-9]{64}', options.sha256):
        raise ValueError('The authenticated artifact SHA256 is required')
    if not re.fullmatch(r'[a-f0-9]{40}', options.source):
        raise ValueError('A full source commit is required')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,62}', options.zone):
        raise ValueError('Expected a nonempty deployment zone name')
    for path in (options.binary, options.root, options.config, options.install_root):
        if not path.is_absolute():
            raise ValueError('Deployment paths must be absolute')
        quoted(str(path))
    quoted(options.bind)
    if options.binary.is_symlink() or not options.binary.is_file():
        raise ValueError('The source executable must be a regular file')
    if digest(options.binary) != options.sha256:
        raise ValueError('Source executable checksum mismatch')
    version = subprocess.run([str(options.binary), '--version'], check=True,
                             capture_output=True, text=True, timeout=10).stdout.strip()
    stamp = re.search(r'\(sudocode ([a-f0-9]{7,40}), nexus-vfs v([0-9.]+)\)', version)
    if not version.startswith('nexusd-cohost ') or not stamp or not options.source.startswith(stamp[1]):
        raise ValueError('Executable does not identify the expected cohost source')
    return version


def inspect(options):
    version = validate(options)
    unit = options.unit + '.service'
    state = properties(unit)
    pid = int(state.get('MainPID', '0'))
    running = digest(Path('/proc') / str(pid) / 'exe') if pid else None
    expected = {'NEXUS_DATA_DIR':str(options.root/'data'),
                'NEXUS_IDENTITY_DIR':str(options.root/'id'),
                'SUDO_CODE_CONFIG_HOME':str(options.config)}
    observed = {}
    if pid:
        environment = (Path('/proc')/str(pid)/'environ').read_bytes()
        values = dict(item.split('=',1) for item in environment.decode().split('\0') if '=' in item)
        observed = {key:values.get(key) for key in expected}
    return {'schemaVersion': 1, 'action': 'deploy.cohost', 'unit': unit,
            'sourceCommit': options.source, 'binarySha256': options.sha256,
            'binaryVersion': version, 'existingService': state,
            'runningBinarySha256': running,
            'sameBinaryRunning': running == options.sha256,
            'expectedStatePaths':expected, 'observedStatePaths':observed,
            'stateBindingVerified':bool(pid) and observed == expected,
            'identityOrDataMigration': False, 'authenticatedReady': False,
            'domainJoinAccepted': False}


def stage(options):
    private_directory(options.install_root)
    version_dir = options.install_root / options.sha256
    private_directory(version_dir)
    target = version_dir / 'nexusd-cohost'
    if target.exists():
        if target.is_symlink() or digest(target) != options.sha256:
            raise ValueError('An existing versioned executable is corrupt; refusing replacement')
    else:
        # The artifact remains hash-bound even if its input changes after inspect.
        with options.binary.open('rb') as stream:
            payload = stream.read()
        if hashlib.sha256(payload).hexdigest() != options.sha256:
            raise ValueError('Source executable changed before staging')
        try:
            publish(target, payload, 0o755)
        except FileExistsError:
            if target.is_symlink() or digest(target) != options.sha256:
                raise ValueError('A conflicting executable appeared during staging')
    return target


def fresh_unit(options, target):
    environment = {'NEXUS_DATA_DIR': str(options.root / 'data'),
                   'NEXUS_IDENTITY_DIR': str(options.root / 'id'),
                   'NEXUS_CLUSTER_INIT': options.zone,
                   'NEXUS_CLUSTER_INIT_MOUNTS': '/agents=' + options.zone,
                   'NEXUS_ADVERTISE_ADDR': options.bind,
                   'SUDO_CODE_CONFIG_HOME': str(options.config), 'RUST_LOG': 'info'}
    return ('[Unit]\nDescription=Shared cohost runtime\nAfter=network-online.target\n'
            'Wants=network-online.target\n\n[Service]\nType=simple\n'
            'WorkingDirectory=' + unit_path(str(options.root)) + '\n' +
            ''.join('Environment=' + quoted(k + '=' + v) + '\n' for k, v in environment.items()) +
            'ExecStart=' + quoted(str(target)) + ' --bind-addr ' + quoted(options.bind) +
            '\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n').encode()


def install(options):
    report = inspect(options)
    if options.command == 'inspect':
        return dict(report, status='inspected')
    if options.command == 'stage':
        return dict(report, status='staged', executable=str(stage(options)))
    state = report['existingService']
    if state.get('LoadState') == 'loaded':
        # A placement installer cannot attest an existing runtime's session,
        # owner or admission barrier. It therefore cannot stop it for an upgrade.
        if report['sameBinaryRunning'] and report['stateBindingVerified']:
            return dict(report, status='already-running')
        raise ValueError('Existing service requires its owner-controlled drain and adoption; inspect/stage is available, install does not overwrite or restart it')
    if int(state.get('MainPID', '0')) or state.get('LoadState') not in ('not-found', None):
        raise ValueError('Ambiguous service state; refusing installation')
    target = stage(options)
    for directory in (options.root / 'data', options.root / 'id', options.root / 'model-cache', options.config):
        private_directory(directory)
    unit_dir = Path.home() / '.config/systemd/user'
    private_directory(unit_dir)
    unit = unit_dir / report['unit']
    if unit.exists() or unit.is_symlink():
        raise ValueError('An existing unit file cannot be replaced')
    # Serialize cooperating installers and preserve another owner's unit.
    import fcntl
    with (options.install_root / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if properties(report['unit']).get('LoadState') == 'loaded' or unit.exists():
            raise ValueError('Another installation appeared before activation')
        payload = fresh_unit(options, target)
        publish(unit, payload, 0o600)
        systemctl('daemon-reload')
        systemctl('enable', '--now', report['unit'])
    # Hash the live executable, not the copied file or the reported version.
    import time
    for _ in range(20):
        report = inspect(options)
        if report['sameBinaryRunning'] and report['stateBindingVerified']:
            return dict(report, status='process-activated', executable=str(target))
        time.sleep(0.1)
    raise ValueError('The requested executable did not become the running service; retain the staged files and inspect the native unit')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect', 'stage', 'install'])
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--unit', required=True)
    parser.add_argument('--bind', required=True)
    parser.add_argument('--zone', required=True)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--install-root', type=Path, required=True)
    options = parser.parse_args()
    try:
        print(json.dumps(install(options), indent=2))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'not-completed', 'error': str(error),
                          'authenticatedReady': False, 'domainJoinAccepted': False}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
