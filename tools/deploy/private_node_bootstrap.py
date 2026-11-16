#!/usr/bin/env python3
"""Prepare a private founder with the native launcher, then hand off to SudoCode.

This is a bounded installer action, not a supervisor. Only the child started by
this invocation is stopped. Persistent recovery belongs to SudoCode service-host.
"""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import uuid

from private_agent_activation import digest, environment, run, validate, write_new


@contextmanager
def installer_lock(path):
    if path.is_symlink():
        raise ValueError('Refusing redirected installer lock')
    with path.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield  # Closing releases the OS lock even after an interrupted installer.


def bootstrap(spec, bash):
    if os.name == 'nt':
        raise ValueError('Fresh founder handoff requires POSIX exec semantics; Windows is not qualified')
    paths, binaries = validate(spec, fresh=True)
    root, home, data = paths['root'], paths['home'], paths['dataDir']
    launcher = paths['nexusRepo'] / 'scripts/cluster/start-founder.sh'
    common = launcher.with_name('start-common.sh')
    for key, source in (('launcherSha256', launcher), ('launcherCommonSha256', common)):
        if digest(source) != spec[key]:
            raise ValueError('Source pin differs: ' + key)
    if not Path(bash).is_absolute() or not Path(bash).is_file():
        raise ValueError('Select an existing absolute Bash executable')
    state = root / 'activation'
    if state.is_symlink():
        raise ValueError('Refusing redirected activation directory')
    state.mkdir(mode=0o700, exist_ok=True)
    with installer_lock(state / 'bootstrap.lock'):
        declaration = state / 'bootstrap.json'
        if declaration.is_symlink():
            raise ValueError('Refusing redirected bootstrap declaration')
        if declaration.exists():
            if json.loads(declaration.read_bytes()) != spec:
                raise ValueError('Bootstrap declaration changed; an explicit upgrade is required')
        else:
            # Never infer ownership from a reachable port or preexisting data.
            if any(directory.exists() and any(directory.iterdir())
                   for directory in (data, paths['identityDir'])):
                raise ValueError('Existing Node state requires its original activation owner')
            if (home / '.nexus/run/node.json').exists():
                raise ValueError('Existing discovery requires its original activation owner')
            write_new(declaration, spec)
        if (home / '.nexus/run/node.json').exists():
            return run(spec)  # Includes authenticated recovery through its owner.
        port = int(spec['endpoint'].split(':')[1])
        if port == 65535:
            raise ValueError('The native enrollment neighbour port is unavailable')
        # Check both native listeners without contacting or adopting another Node.
        with socket.socket() as first, socket.socket() as second:
            first.bind(('127.0.0.1', port))
            second.bind(('127.0.0.1', port + 1))
        env = environment(home, root)
        env.update(NEXUSD_BIN=binaries['daemon'].as_posix(), NEXUS_DATA_DIR=data.as_posix(),
                   NEXUS_IDENTITY_DIR=paths['identityDir'].as_posix(),
                   NEXUS_ADVERTISE_ADDR=spec['endpoint'], NEXUS_BIND_ADDR=spec['endpoint'],
                   NEXUS_CLUSTER_INIT=spec['zone'], NEXUS_HOSTNAME=spec['hostname'],
                   NEXUS_ACCEPT_ENROLLMENTS=str(spec.get('acceptEnrollments', False)).lower(),
                   RUST_LOG='info', NO_COLOR='1')
        log = state / ('bootstrap-' + uuid.uuid4().hex + '.log')
        # Initial logs can contain enrollment tokens. Keep the entire directory
        # private; never print its contents or ship it with a public receipt.
        with log.open('xb') as stream:
            if os.name != 'nt':
                log.chmod(0o600)
            child = subprocess.Popen([str(bash), launcher.as_posix()], cwd=root, env=env,
                                     stdout=stream, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 120
                while True:
                    if child.poll() is not None:
                        raise RuntimeError('Native founder exited; inspect the private bootstrap log')
                    text = log.read_text(errors='replace')
                    if all(marker in text for marker in (
                            'CA holder armed MintAgent RPC', 'Static topology applied')):
                        break
                    if time.monotonic() > deadline:
                        raise TimeoutError('Native founder readiness; private state retained for retry')
                    time.sleep(0.1)
                # Actual readiness is established by MintAgent and the six native
                # publisher mTLS probes. Log markers alone do not qualify it.
                result = run(spec)
                if not result['activated']:
                    raise RuntimeError('Native activation did not complete')
            finally:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=10)
        result = run(spec)
        if not result['owner']['managed'] or not result['owner']['running']:
            raise RuntimeError('Native service ownership handoff was not confirmed')
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--declaration', type=Path, required=True)
    parser.add_argument('--bash', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(bootstrap(json.loads(args.declaration.read_bytes()), args.bash)))


if __name__ == '__main__':
    main()
