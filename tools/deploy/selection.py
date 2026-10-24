#!/usr/bin/env python3
"""Checkpoint and select exact producer-prepared existing user-service versions.

The product adapter owns native unit preparation, draining, readiness and data
compatibility. Before selection fails, originals can restart. Once configuration
selection begins, a failure stops the declared services and requires inspection;
old code is never automatically started over possibly migrated state.
"""
import argparse
import datetime
import fcntl
import json
from pathlib import Path
import re
import subprocess
import sys

import checkpoint
from cohost import digest, private_directory, publish
from configuration import replace_configuration


def inspect(plan, output):
    if set(plan) != {'schemaVersion','checkpoint','selections','candidates'} or plan['schemaVersion'] != 1:
        raise ValueError('Unsupported service selection plan')
    units, roots, output = checkpoint.inspect(plan['checkpoint'], output)
    if not plan['selections'] or len(plan['candidates']) != len(units):
        raise ValueError('Supply exact configurations and every selected service candidate')
    selected = set()
    pins = {item['path']:item['sha256'] for item in plan['checkpoint']['pins']}
    for item in plan['selections']:
        if set(item) != {'path','expectedSha256','prepared','sha256'}:
            raise ValueError('Supply exact old and prepared file selections')
        original = checkpoint.owned_path(item['path'])
        prepared = checkpoint.owned_path(item['prepared'])
        if str(original) in selected or pins.get(str(original)) != item['expectedSha256']:
            raise ValueError('Selected original must be a unique pinned checkpoint file')
        selected.add(str(original))
        if original == prepared or not prepared.is_file() or output == prepared or output in prepared.parents:
            raise ValueError('Keep prepared files distinct from originals and evidence')
        if not re.fullmatch('[a-f0-9]{64}',item['sha256']) or digest(prepared) != item['sha256']:
            raise ValueError('Prepared selection checksum mismatch')
    names = set()
    for item in plan['candidates']:
        if set(item) != {'name','binary','sha256','argumentFiles'} or item['name'] in names:
            raise ValueError('Each candidate service needs one executable and pinned argument file list')
        names.add(item['name'])
        binary = checkpoint.owned_path(item['binary'])
        if not binary.is_file() or not re.fullmatch('[a-f0-9]{64}',item['sha256']) or digest(binary) != item['sha256']:
            raise ValueError('Candidate executable checksum mismatch')
        for argument in item['argumentFiles']:
            if set(argument) != {'path','sha256'}:
                raise ValueError('Invalid candidate argument file pin')
            path = checkpoint.owned_path(argument['path'])
            if not path.is_file() or digest(path) != argument['sha256']:
                raise ValueError('Candidate argument file checksum mismatch')
    if names != {unit['name'] for unit in units}:
        raise ValueError('Candidate names differ from the checkpoint services')
    return units, roots, output


def verify_candidate(candidate):
    current = checkpoint.state(candidate['name'])
    pid = int(current.get('MainPID','0'))
    if not pid or current.get('ActiveState') != 'active' or digest(Path('/proc')/str(pid)/'exe') != candidate['sha256']:
        raise ValueError('Selected executable is not the running service: '+candidate['name'])
    arguments = (Path('/proc')/str(pid)/'cmdline').read_bytes().decode().rstrip('\0').split('\0')
    for argument in candidate['argumentFiles']:
        if argument['path'] not in arguments or digest(Path(argument['path'])) != argument['sha256']:
            raise ValueError('Selected application entry is not the running service: '+candidate['name'])
    return {'unit':candidate['name'],'pid':pid,'binarySha256':candidate['sha256'],
            'argumentFiles':candidate['argumentFiles']}


def select(plan, output, execute=False):
    units, roots, output = inspect(plan, output)
    report = {'schemaVersion':1,'action':'deploy.selection','status':'inspected',
              'authenticatedReady':False,'nativeHistoryRecoveryAccepted':False,'domainJoinAccepted':False,
              'automaticDataRollback':False,'stopOrder':[unit['name'] for unit in units]}
    if not execute:
        return report
    private_directory(output.parent)
    with (output.parent/'.checkpoint.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        units, roots, output = inspect(plan, output)
        output.mkdir(mode=0o700)
        stopped = []
        selection_started = False
        try:
            for unit in units:
                stopped.append(unit)
                checkpoint.control('stop',unit['name'])
                checkpoint.stopped(unit['name'])
            snapshot = output/'checkpoint'
            snapshot.mkdir(mode=0o700)
            inventory = checkpoint.copy_stopped(plan['checkpoint'],units,roots,snapshot)
            publish(snapshot/'inventory.json',(json.dumps(inventory,indent=2)+'\n').encode(),0o600)
            report['checkpointCreated'] = True
            report['selectedConfigurations'] = []
            for index,item in enumerate(plan['selections']):
                # Set this before admission: a failed replacement can still
                # have changed a file. Never infer rollback safety from Err.
                selection_started = True
                selected = replace_configuration(item['path'],item['expectedSha256'],item['prepared'],item['sha256'],
                                                 output/('selection-'+str(index)),True)
                report['selectedConfigurations'].append(selected)
            checkpoint.control('daemon-reload')
            candidates = {item['name']:item for item in plan['candidates']}
            report['processes'] = []
            for unit in reversed(units):
                checkpoint.control('start',unit['name'])
                report['processes'].append(verify_candidate(candidates[unit['name']]))
            report['status'] = 'process-selection-activated'
        except (ValueError,OSError,subprocess.SubprocessError) as error:
            report.update(status='not-completed',error=str(error))
        finally:
            if report['status'] not in ('process-selection-activated','not-completed'):
                report.update(status='not-completed',error='Selection interrupted before completion')
            if report['status'] == 'not-completed':
                if not selection_started:
                    report['restoration'], failed = checkpoint.restore_original(stopped)
                    report['operatorAttentionRequired'] = failed
                else:
                    report['operatorAttentionRequired'] = True
                    report['failureStops'] = []
                    for unit in units:
                        try:
                            checkpoint.control('stop',unit['name'])
                            checkpoint.stopped(unit['name'])
                            report['failureStops'].append({'unit':unit['name'],'stopped':True})
                        except (ValueError,OSError,subprocess.SubprocessError) as error:
                            report['failureStops'].append({'unit':unit['name'],'stopped':False,'error':str(error)})
            report['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            publish(output/'selection.json',(json.dumps(report,indent=2)+'\n').encode(),0o600)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['inspect','apply'])
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    result = select(json.loads(args.plan.read_text()),args.output,args.command=='apply')
    print(json.dumps(result,indent=2))
    sys.exit(1 if result['status']=='not-completed' else 0)
