#!/usr/bin/env python3
"""Run an approved existing-product deploy outside the controller's lifetime.

The device OS account authorizes this entry. Moss authenticates and authorizes
its own API before invoking it; caller-supplied labels are never credentials.
Only operator-installed, hash-pinned plans can select existing shared actions.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

import checkpoint
import product_qualification
import selection
from cohost import digest, private_directory, publish


IDENTIFIER = re.compile(r'[A-Za-z0-9_-]{1,128}')
SHA256 = re.compile(r'[a-f0-9]{64}')
IMPLEMENTATION = ('device_operation.py', 'cohost.py', 'checkpoint.py', 'configuration.py',
                  'selection.py', 'product_qualification.py')


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError('Expected a bounded operation or plan identifier')
    return value


def trusted_parents(path):
    for parent in path.parents:
        private_directory(parent)
        if parent == Path.home().resolve():
            break


def document(path, limit=262144):
    path = checkpoint.owned_path(str(path))
    trusted_parents(path)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077 or info.st_size > limit:
        raise ValueError('Use a private, bounded, owner-controlled regular document')
    return json.loads(path.read_bytes())


def registry(path):
    path = checkpoint.owned_path(str(path))
    value = document(path)
    if set(value) != {'schemaVersion', 'deploymentId', 'stateDirectory', 'plans'} or value['schemaVersion'] != 1:
        raise ValueError('Unsupported approved deployment registry')
    identifier(value['deploymentId'])
    state = checkpoint.owned_path(value['stateDirectory'])
    if not state.is_dir():
        raise ValueError('Operator must prepare the private deployment state directory')
    trusted_parents(state)
    private_directory(state)
    if stat.S_IMODE(state.stat().st_mode) & 0o077:
        raise ValueError('Deployment state must be private to the device account')
    if not isinstance(value['plans'], dict) or len(value['plans']) > 100:
        raise ValueError('Register a bounded set of approved plans')
    for key, item in value['plans'].items():
        identifier(key)
        if set(item) != {'path', 'sha256', 'ownerId', 'description'} or not SHA256.fullmatch(item['sha256']):
            raise ValueError('Every approved plan requires an immutable digest and owner')
        identifier(item['ownerId'])
        if not isinstance(item['description'], str) or not 1 <= len(item['description']) <= 256:
            raise ValueError('Use a bounded plan description')
    return path, value, state


def approved(path, plan_id):
    path, config, state = registry(path)
    item = config['plans'].get(identifier(plan_id))
    if item is None:
        raise ValueError('Deployment plan is not approved on this device')
    plan_path = checkpoint.owned_path(item['path'])
    if digest(plan_path) != item['sha256']:
        raise ValueError('Approved deployment plan changed')
    plan = document(plan_path)
    if set(plan) != {'schemaVersion', 'deploymentId', 'ownerId', 'selection', 'qualification'} or plan['schemaVersion'] != 1:
        raise ValueError('Unsupported existing-product deployment plan')
    if plan['deploymentId'] != config['deploymentId'] or plan['ownerId'] != item['ownerId']:
        raise ValueError('Plan differs from the approved deployment or owner')
    if plan['qualification'].get('session', {}).get('ownerId') != item['ownerId']:
        raise ValueError('Product qualification must retain the approved original owner')
    return path, config, state, item, plan


def location(config, state, operation_id):
    operation_id = identifier(operation_id)
    key = hashlib.sha256((config['deploymentId'] + '\0' + operation_id).encode()).hexdigest()
    return state / key, 'sudo-deploy-' + key[:40] + '.service'


def metadata(config, item, plan_id, operation_id, unit):
    implementation = {name: digest(Path(__file__).parent / name) for name in IMPLEMENTATION}
    return {'schemaVersion': 1, 'action': 'runtime.deploy', 'deploymentId': config['deploymentId'],
            'ownerId': item['ownerId'], 'planId': plan_id, 'planSha256': item['sha256'],
            'operationId': operation_id, 'unit': unit, 'osUid': os.getuid(),
            'runnerSha256': digest(Path(__file__)), 'implementationSha256': hashlib.sha256(
                json.dumps(implementation, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'domainJoinAccepted': False}


def query(path, operation_id):
    _, config, state = registry(path)
    output, _ = location(config, state, operation_id)
    request = document(output / 'request.json')
    if request.get('operationId') != operation_id or request.get('deploymentId') != config['deploymentId']:
        raise ValueError('Operation receipt binding differs')
    receipt = output / 'receipt.json'
    if receipt.exists():
        value = document(receipt)
        for key in ['operationId', 'deploymentId', 'ownerId', 'planId', 'planSha256', 'runnerSha256', 'implementationSha256']:
            if value.get(key) != request.get(key):
                raise ValueError('Operation receipt binding differs')
        return value
    # Absence, a stopped unit or a lost systemd reply never proves no effects.
    return {**request, 'status': 'unknown', 'outcome': 'unknown'}


def inspect(path, plan_id):
    _, config, state, item, plan = approved(path, plan_id)
    output = state / 'inspection-only'
    selection.inspect(plan['selection'], output)
    return {'schemaVersion': 1, 'deploymentId': config['deploymentId'], 'ownerId': item['ownerId'],
            'planId': plan_id, 'planSha256': item['sha256'], 'description': item['description'],
            'status': 'inspected', 'domainJoinAccepted': False}


def submit(path, plan_id, operation_id):
    path, config, state, item, plan = approved(path, plan_id)
    output, unit = location(config, state, operation_id)
    expected = metadata(config, item, plan_id, operation_id, unit)
    if output.exists():
        old = document(output / 'request.json')
        if old != expected:
            raise ValueError('Operation ID belongs to another immutable request')
        return query(path, operation_id)
    # Real process/configuration admission runs before reserving an effect.
    selection.inspect(plan['selection'], output / 'selection')
    try:
        output.mkdir(mode=0o700)
    except FileExistsError:
        # Another submitter owns the reservation, including partial publication.
        # Never start a worker from this branch or invent another operation ID.
        return query(path, operation_id)
    publish(output / 'request.json', (json.dumps(expected, sort_keys=True) + '\n').encode(), 0o600)
    publish(output / 'submitted.json', b'{"outcome":"unknown"}\n', 0o600)
    command = ['systemd-run', '--user', '--collect', '--unit=' + unit,
               '--property=Type=exec', '--property=Restart=no',
               str(Path(sys.executable).resolve()), str(Path(__file__).resolve()), 'execute',
               '--registry', str(path), '--operation-id', operation_id]
    # systemd owns the worker. Stopping/restarting the controller cannot kill it.
    # The unit receives no request bearer, human token or caller shell command.
    try:
        result = subprocess.run(command, capture_output=True, timeout=30)
        submission = {'exit': result.returncode, 'stdoutSha256': hashlib.sha256(result.stdout).hexdigest(),
                      'stderrSha256': hashlib.sha256(result.stderr).hexdigest()}
    except (OSError, subprocess.SubprocessError) as error:
        submission = {'outcome': 'unknown', 'errorType': type(error).__name__}
    publish(output / 'submission.json', (json.dumps(submission) + '\n').encode(), 0o600)
    return query(path, operation_id)


def execute(path, operation_id):
    path, config, state = registry(path)
    output, unit = location(config, state, operation_id)
    request = document(output / 'request.json')
    _, current, _, item, plan = approved(path, request['planId'])
    expected = metadata(current, item, request['planId'], operation_id, unit)
    if request != expected or not (output / 'submitted.json').is_file():
        raise ValueError('Deployment changed after its immutable submission')
    marker = output / 'worker-started.json'
    # No re-entry even if an earlier worker died or its final receipt is lost.
    publish(marker, (json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}) + '\n').encode(), 0o600)
    report = {**request, 'status': 'unknown', 'outcome': 'unknown', 'selectionAccepted': False,
              'productQualificationAccepted': False}
    try:
        with (state / '.deploy-operation.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Recheck approval and implementation after taking the device fence.
            _, current, _, item, plan = approved(path, request['planId'])
            if request != metadata(current, item, request['planId'], operation_id, unit):
                raise ValueError('Deployment changed before device admission')
            selected = selection.select(plan['selection'], output / 'selection', True)
            if selected.get('status') != 'process-selection-activated':
                raise ValueError('Shared service selection did not complete')
            report['selectionAccepted'] = True
            proof = product_qualification.qualify(plan['qualification'], output / 'product', True)
            if proof.get('status') != 'product-qualification-accepted':
                raise ValueError('Original product qualification did not complete')
            report.update(status='completed', outcome='completed', productQualificationAccepted=True,
                          originalSessionId=plan['qualification']['session']['id'],
                          modelTurnsCompleted=proof['modelTurnsCompleted'],
                          nativeBindingPreserved=proof['nativeBindingPreserved'])
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        publish(output / 'failure.private.txt', (str(error) + '\n').encode(), 0o600)
    finally:
        publish(output / 'receipt.json', (json.dumps(report, sort_keys=True) + '\n').encode(), 0o600)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect', 'submit', 'query', 'execute'])
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--plan-id')
    parser.add_argument('--operation-id')
    args = parser.parse_args()
    if args.command in ['inspect', 'submit'] and args.plan_id is None:
        parser.error('--plan-id is required')
    if args.command != 'inspect' and args.operation_id is None:
        parser.error('--operation-id is required')
    if args.command == 'inspect':
        result = inspect(args.registry, args.plan_id)
    elif args.command == 'submit':
        result = submit(args.registry, args.plan_id, args.operation_id)
    elif args.command == 'execute':
        result = execute(args.registry, args.operation_id)
    else:
        result = query(args.registry, args.operation_id)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
