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


def container_state(pin, running):
    """Inspect one pinned, non-root container without returning its environment."""
    if (not isinstance(pin, dict) or set(pin) != {'id','imageSha256','runtime','user','networkMode','binarySha256','deploymentId','mounts'} or
            not re.fullmatch('[a-f0-9]{64}', pin['id']) or
            not re.fullmatch('sha256:[a-f0-9]{64}', pin['imageSha256']) or
            not re.fullmatch('[a-f0-9]{64}', pin['binarySha256']) or
            not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}', pin['runtime']) or
            not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}', pin['networkMode']) or
            not re.fullmatch('[1-9][0-9]*:[1-9][0-9]*', pin['user']) or
            not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}', pin['deploymentId'])):
        raise ValueError('An exact non-root container placement pin is required')
    if not isinstance(pin['mounts'], list) or not pin['mounts']:
        raise ValueError('Pin every container bind mount')
    expected = []
    for mount in pin['mounts']:
        if set(mount) != {'source','target','readOnly'} or type(mount['readOnly']) is not bool:
            raise ValueError('Pin literal container source, destination and read-only mode')
        for key in ['source','target']:
            value = mount[key]
            if not isinstance(value, str) or not Path(value).is_absolute() or str(Path(value)) != value or '..' in Path(value).parts:
                raise ValueError('Container mounts require canonical absolute paths')
        source = Path(mount['source'])
        if source == Path.home() or not source.is_relative_to(Path.home()):
            raise ValueError('Container bind sources must be explicit device-owned home descendants')
        for parent in [source, *source.parents]:
            if parent.is_symlink():
                raise ValueError('Container bind sources must not traverse host symlinks')
            if parent == Path.home():
                break
        if not source.is_file() and not source.is_dir():
            raise ValueError('Container bind sources must be existing files or directories')
        expected.append((mount['source'], mount['target'], not mount['readOnly']))
    if len({item[1] for item in expected}) != len(expected):
        raise ValueError('Duplicate container mount destination')
    result = subprocess.run(['docker','inspect','--type','container',pin['id']],
                            capture_output=True, text=True, check=True, timeout=30)
    rows = json.loads(result.stdout)
    if len(rows) != 1:
        raise ValueError('The pinned container is ambiguous')
    value = rows[0]
    host, config, state = value['HostConfig'], value['Config'], value['State']
    if (value['Id'] != pin['id'] or value['Image'] != pin['imageSha256'] or
            host['Runtime'] != pin['runtime'] or host['NetworkMode'] != pin['networkMode'] or config['User'] != pin['user'] or
            (config.get('Labels') or {}).get('sudo.dev/deployment-id') != pin['deploymentId']):
        raise ValueError('Container identity, image, runtime or deployment owner differs')
    if (host.get('Privileged') or not host.get('ReadonlyRootfs') or
            host.get('CapAdd') or host.get('CapDrop') != ['ALL'] or
            host.get('PidMode') or host.get('Devices') or host.get('DeviceRequests') or
            host.get('RestartPolicy', {}).get('Name') not in ('', 'no') or
            'no-new-privileges' not in (host.get('SecurityOpt') or [])):
        raise ValueError('Container must retain a read-only root, dropped capabilities and explicit service lifetime')
    if any(item['Type'] != 'bind' for item in value['Mounts']):
        raise ValueError('Undeclared container volumes are not allowed')
    observed = sorted((item['Source'], item['Destination'], item['RW']) for item in value['Mounts'])
    if observed != sorted(expected):
        raise ValueError('Container bind mounts differ from the product plan')
    if state.get('Running') is not running or state.get('Restarting') or (not running and state.get('Pid')):
        raise ValueError('Container did not enter the requested running/stopped boundary')
    report = {'id':pin['id'],'imageSha256':value['Image'],'runtime':host['Runtime'],'running':running}
    if running:
        result = subprocess.run(['docker','exec',pin['id'],'/usr/bin/sha256sum','/proc/1/exe'],
                                capture_output=True, text=True, check=True, timeout=30)
        if result.stdout.split() != [pin['binarySha256'], '/proc/1/exe']:
            raise ValueError('The live container init executable differs from the pinned runtime')
        report['binarySha256'] = pin['binarySha256']
    return report


def attached_container(pid, pin):
    """A user unit must attach to the immutable container it actually owns."""
    report = container_state(pin, True)
    arguments = (Path('/proc')/str(pid)/'cmdline').read_bytes().decode().rstrip('\0').split('\0')
    if arguments[1:] != ['start','--attach',pin['id']]:
        raise ValueError('The service is not attached to its pinned container')
    return report


def container_unit(text, binary, pin):
    """Prepare an existing service to attach to one separately inspected container."""
    container_state(pin, False)
    lines = text.splitlines(keepends=True)
    section, starts, insertion = None, [], None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('[') and stripped.endswith(']'):
            if section == '[Service]':
                insertion = index
            section = stripped
        elif section == '[Service]':
            if stripped.startswith('ExecStart='):
                starts.append(index)
            if stripped.startswith(('ExecStop=', 'ExecStopPost=')):
                raise ValueError('Existing stop hooks need explicit native adaptation before container placement')
    if len(starts) != 1:
        raise ValueError('Expected exactly one existing service ExecStart')
    if section == '[Service]':
        insertion = len(lines)
    if insertion is None:
        raise ValueError('Existing service section is missing')
    lines[starts[0]] = 'ExecStart=' + ' '.join(quoted(value) for value in [str(binary),'start','--attach',pin['id']]) + '\n'
    lines.insert(insertion, 'ExecStop=' + ' '.join(quoted(value) for value in [str(binary),'stop','--time','60',pin['id']]) + '\n')
    return ''.join(lines).encode()


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
