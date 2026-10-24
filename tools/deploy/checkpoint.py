#!/usr/bin/env python3
"""Cold checkpoint of explicitly selected Linux user services and private state.

The product adapter supplies stop order, executable/config pins and owned paths.
This action never selects new binaries, mutates a database, or starts an Agent.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

from cohost import digest, private_directory, publish


def control(*args):
    return subprocess.run(['systemctl', '--user', *args], capture_output=True,
                          text=True, check=True, timeout=120).stdout


def state(unit):
    fields = 'LoadState,ActiveState,MainPID,ControlGroup,TriggeredBy'
    return dict(line.split('=', 1) for line in control('show', unit, '--property='+fields).splitlines() if '=' in line)


def owned_path(value):
    path = Path(value)
    home = Path.home().resolve()
    if not path.is_absolute() or not path.is_relative_to(home) or path == home:
        raise ValueError('Checkpoint paths must be explicit descendants of the current home')
    for part in [path, *path.parents]:
        if part == home.parent:
            break
        if part.is_symlink():
            raise ValueError('Symlink in checkpoint path: '+str(part))
        if part.exists() and part.stat().st_uid != os.getuid():
            raise ValueError('Checkpoint paths must belong to the current user: '+str(part))
    return path


def files_below(path):
    paths = [path] if path.is_file() else path.rglob('*')
    result = []
    for item in paths:
        info = item.lstat()
        if info.st_uid != os.getuid() or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError('Only owned directories and regular files can be checkpointed: '+str(item))
        if stat.S_ISREG(info.st_mode):
            result.append(item)
    return result


def inventory(roots):
    return {label: {str(item.relative_to(path)) if path.is_dir() else '.':
                    {'sha256': digest(item), 'bytes': item.stat().st_size}
                    for item in files_below(path)} for label, path in roots.items()}


def inspect(plan, output):
    if set(plan) != {'schemaVersion', 'units', 'paths', 'pins'} or plan['schemaVersion'] != 1:
        raise ValueError('Unsupported checkpoint plan')
    output = owned_path(str(output))
    if output.exists():
        raise ValueError('Use a new checkpoint destination; existing evidence is never overwritten')
    if not plan['units'] or not plan['paths'] or not plan['pins']:
        raise ValueError('Explicit services, state paths and configuration pins are required')
    units = []
    for item in plan['units']:
        if set(item) != {'name', 'binarySha256'} or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*\.service', item['name']):
            raise ValueError('Expected a pinned user-service name')
        if not re.fullmatch('[0-9a-f]{64}', item['binarySha256']):
            raise ValueError('Expected full executable SHA256')
        current = state(item['name'])
        pid = int(current.get('MainPID', '0'))
        if current.get('LoadState') != 'loaded' or current.get('ActiveState') != 'active' or not pid:
            raise ValueError('Checkpoint requires the declared service to be running: '+item['name'])
        if current.get('TriggeredBy'):
            raise ValueError('Socket/trigger activation needs an explicit product maintenance procedure')
        if digest(Path('/proc')/str(pid)/'exe') != item['binarySha256']:
            raise ValueError('Running executable differs from the product plan: '+item['name'])
        units.append(dict(item, before=current))
    if len({u['name'] for u in units}) != len(units):
        raise ValueError('Duplicate service in stop order')
    roots = {}
    for label, value in plan['paths'].items():
        if not re.fullmatch('[A-Za-z0-9_-]+', label):
            raise ValueError('Expected a simple checkpoint path label')
        path = owned_path(value)
        if not path.exists() or output.is_relative_to(path) or path.is_relative_to(output):
            raise ValueError('Missing source or source/destination overlap')
        files_below(path)  # Reject symlinks/devices before stopping anything.
        roots[label] = path
    for pin in plan['pins']:
        if set(pin) != {'path', 'sha256'} or not re.fullmatch('[a-f0-9]{64}', pin['sha256']):
            raise ValueError('Invalid configuration pin')
        path = owned_path(pin['path'])
        if not any(path == root or path.is_relative_to(root) for root in roots.values()):
            raise ValueError('Every pinned configuration must be in the checkpoint')
        if digest(path) != pin['sha256']:
            raise ValueError('Pinned configuration changed: '+str(path))
    return units, roots, output


def stopped(unit):
    current = state(unit)
    if int(current.get('MainPID', '0')) or current.get('ActiveState') != 'inactive':
        raise ValueError('Service did not enter the stopped maintenance boundary: '+unit)
    group = current.get('ControlGroup')
    if group:
        path = Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.procs'
        if path.exists() and path.read_text().strip():
            raise ValueError('Service still has workers: '+unit)
    return current


def checkpoint(plan, output, execute):
    units, roots, output = inspect(plan, output)
    report = {'schemaVersion': 1, 'action': 'deploy.checkpoint', 'status': 'inspected',
              'stopOrder': [unit['name'] for unit in units], 'destination': str(output),
              'paths': {label:str(path) for label,path in roots.items()},
              'authenticatedReady': False, 'nativeHistoryRecoveryAccepted': False,
              'domainJoinAccepted': False}
    if not execute:
        return report
    private_directory(output.parent)
    with (output.parent/'.checkpoint.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        # Recheck pins after serialization, before the first stop.
        units, roots, output = inspect(plan, output)
        output.mkdir(mode=0o700)
        restore, failure, restoration = [], None, []
        try:
            for unit in units:
                restore.append(unit)  # A failed stop may still have stopped it.
                control('stop', unit['name'])
                stopped(unit['name'])
            for pin in plan['pins']:
                if digest(owned_path(pin['path'])) != pin['sha256']:
                    raise ValueError('Pinned configuration changed during maintenance')
            before = inventory(roots)
            for label, path in roots.items():
                target = output/label
                if path.is_dir():
                    shutil.copytree(path, target)
                else:
                    shutil.copy2(path, target)
                # Copies of secret material never become group/world readable.
                for item in [target, *target.rglob('*')] if target.is_dir() else [target]:
                    item.chmod(0o700 if item.is_dir() else 0o600)
            copied = inventory({label:output/label for label in roots})
            if copied != before or inventory(roots) != before:
                raise ValueError('Checkpoint/source bytes changed while services were stopped')
            for unit in units:
                stopped(unit['name'])
            report.update(status='cold-checkpoint-created', inventory=copied,
                          planSha256=hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            failure = str(error)
        finally:
            if report['status'] != 'cold-checkpoint-created' and failure is None:
                failure = 'Checkpoint interrupted before completion'
            restore_failed = False
            for unit in reversed(restore):
                if restore_failed:
                    restoration.append({'unit':unit['name'], 'status':'blocked-by-dependency-restoration'})
                    continue
                try:
                    control('start', unit['name'])
                    current = state(unit['name'])
                    pid = int(current.get('MainPID', '0'))
                    if not pid or current.get('ActiveState') != 'active' or digest(Path('/proc')/str(pid)/'exe') != unit['binarySha256']:
                        raise ValueError('Original executable is not active after restoration')
                    restoration.append({'unit':unit['name'], 'status':'original-process-started', 'pid':pid})
                except (ValueError, OSError, subprocess.SubprocessError) as error:
                    restoration.append({'unit':unit['name'], 'status':'restore-failed', 'error':str(error)})
                    restore_failed = True
            if restore_failed:
                report['checkpointError'] = failure
                failure = 'Original service restoration needs operator attention'
            report.update(restoration=restoration, at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            if failure:
                report.update(status='not-completed', error=failure)
            publish(output/'checkpoint.json', (json.dumps(report, indent=2)+'\n').encode(), 0o600)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect', 'checkpoint'])
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    try:
        report = checkpoint(json.loads(options.plan.read_text()), options.output, options.command == 'checkpoint')
        print(json.dumps({key:value for key,value in report.items() if key != 'inventory'}, indent=2))
        return 0 if report['status'] != 'not-completed' else 1
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'status':'not-completed', 'error':str(error)}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
