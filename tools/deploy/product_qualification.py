#!/usr/bin/env python3
"""Run the pinned product producer against an ORIGINAL owned session.

The producer owns authentication, recovery and the model protocol. This shared
action owns release pins, process selection, before/after comparison and a
durable receipt. It never implements another product client or domain join.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess

import checkpoint
from cohost import digest, private_directory, publish
from selection import verify_candidate

PRODUCER_BUDGET_SECONDS = 1080


def pinned(item, source=False):
    fields = {'path','sha256'} | ({'source'} if source else set())
    if set(item) != fields or not re.fullmatch('[a-f0-9]{64}',item['sha256']):
        raise ValueError('Supply one exact producer/runtime/configuration pin')
    if source and not re.fullmatch('[a-f0-9]{40}',item['source']):
        raise ValueError('The product producer needs its full source revision')
    path = checkpoint.owned_path(item['path'])
    if not path.is_file() or digest(path) != item['sha256']:
        raise ValueError('Product qualification input checksum mismatch')
    return path


def inspect(plan, output):
    if set(plan) != {'schemaVersion','producer','runtime','configuration','service','session'} or plan['schemaVersion'] != 1:
        raise ValueError('Unsupported product qualification plan')
    producer = pinned(plan['producer'],True)
    runtime = pinned(plan['runtime'])
    configuration = pinned(plan['configuration'])
    if configuration.stat().st_mode & 0o077:
        raise ValueError('The existing product configuration must be owner-only')
    session = plan['session']
    if set(session) != {'id','ownerId','agentId','durableSessionId','repositoryPath','messagesSha256'}:
        raise ValueError('Supply the original native session binding and history hash')
    if not all(isinstance(value,str) and value for value in session.values()) or not re.fullmatch('[a-f0-9]{64}',session['messagesSha256']):
        raise ValueError('Invalid existing session identity or history hash')
    service = plan['service']
    if set(service) != {'name','binary','sha256','argumentFiles'} or service['sha256'] != plan['runtime']['sha256']:
        raise ValueError('Pin the actual running product runtime and entry')
    pinned({'path':service['binary'],'sha256':service['sha256']})
    for item in service['argumentFiles']:
        pinned(item)
    if not service['argumentFiles']:
        raise ValueError('Pin the running product application entry')
    selected = verify_candidate(service)
    if not isinstance(selected['pid'],int) or selected['pid'] <= 0:
        raise ValueError('No actual product process selected')
    output = checkpoint.owned_path(str(output))
    if output.exists() or any(output == path or output in path.parents for path in [producer,runtime,configuration]):
        raise ValueError('Use new evidence separate from the product inputs')
    return producer,runtime,configuration,selected,output


def producer_call(plan, selected, producer, runtime, configuration, output, verb):
    # Match the real application's environment, without serializing its values.
    # Model/configuration resolution stays with the product producer.
    environment = dict(item.split('=',1) for item in
        (Path('/proc')/str(selected['pid'])/'environ').read_text().split('\0') if '=' in item)
    # The native producer checks its canonical binding before execution. This
    # expectation is neither authority nor a grant; adoption stays native.
    result = subprocess.run([str(runtime),str(producer),str(configuration),str(output),verb,plan['session']['id'],
        '--expected-binding',str(output.parent/'expected-binding.json')],
        env=environment,capture_output=True,timeout=PRODUCER_BUDGET_SECONDS)
    publish(output.parent/(output.name+'.stdout.private.log'),result.stdout,0o600)
    publish(output.parent/(output.name+'.stderr.private.log'),result.stderr,0o600)
    if result.returncode:
        raise ValueError('The native product producer did not accept this qualification; retain its private evidence')
    value = json.loads((output/'receipt.json').read_bytes())
    if value.get('schemaVersion') != 1 or value.get('ownerId') != plan['session']['ownerId']:
        raise ValueError('The producer did not prove the expected actual owner')
    for key in ['accountCreated','agentCreated','sessionCreated']:
        if value.get(key) is not False:
            raise ValueError('Qualification cannot create a replacement identity/session')
    if value.get('probeTokenLoggedOut') is not True:
        raise ValueError('The producer did not release its own login token')
    return value


def qualify(plan, output, execute=False):
    producer,runtime,configuration,selected,output = inspect(plan,output)
    report = {'schemaVersion':1,'action':'deploy.product-qualification','status':'inspected',
        'producer':plan['producer'],'runtime':plan['runtime'],'service':selected,
        'originalSessionId':plan['session']['id'],'modelTurnsMayHaveBeenSubmitted':False,
        'authenticatedProductReady':False,'modelJourneyAccepted':False,
        'nativeHistorySemanticRecallClaimed':False,'domainJoinAccepted':False}
    if not execute:
        return report
    private_directory(output.parent)
    with (output.parent/'.checkpoint.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        producer,runtime,configuration,selected,output = inspect(plan,output)
        output.mkdir(mode=0o700)
        publish(output/'submitted.json',(json.dumps(report)+'\n').encode(),0o600)
        binding = {key:plan['session'][key] for key in ['ownerId','agentId','durableSessionId','repositoryPath']}
        publish(output/'expected-binding.json',(json.dumps(binding)+'\n').encode(),0o600)
        try:
            before = producer_call(plan,selected,producer,runtime,configuration,output/'inspection','--inspect-existing')
            reads = before.get('existingHistoryReads',[])
            matching = [item for item in reads if item.get('sessionId') == plan['session']['id']]
            if len(matching) != 1 or matching[0].get('messagesSha256') != plan['session']['messagesSha256']:
                raise ValueError('Original product history changed before a model turn; no turn submitted')
            if before.get('turnSubmitted') is not False or before.get('nativeExecutionResumeRequested') is not False:
                raise ValueError('Read-only product inspection unexpectedly selected execution')
            if before.get('nativeBindingObserved') != binding:
                raise ValueError('Native original binding differs before a model command')
            if verify_candidate(plan['service'])['pid'] != selected['pid'] or digest(configuration) != plan['configuration']['sha256']:
                raise ValueError('The selected product changed before qualification')
            report['modelTurnsMayHaveBeenSubmitted'] = True
            # Persist uncertainty BEFORE a model command, never only after it.
            publish(output/'model-submitted.json',(json.dumps(report)+'\n').encode(),0o600)
            proof = producer_call(plan,selected,producer,runtime,configuration,output/'model','--exercise-existing')
            if proof.get('nativeBindingPreserved') != binding or proof.get('originalHistoryBeforeJourneySha256') != plan['session']['messagesSha256']:
                raise ValueError('Original native binding or pre-journey history differs')
            if not all(proof.get(key) is True for key in ['resumeHttpAccepted','projectedContextPreserved','modelJourneyAccepted','dependentReplyAndReattachAccepted']):
                raise ValueError('Native product recovery/conversation was not fully accepted')
            if proof.get('modelTurnsCompleted') != 3 or proof.get('modelConfigurationChanged') is not False:
                raise ValueError('Unexpected model journey or configuration change')
            if verify_candidate(plan['service'])['pid'] != selected['pid'] or digest(configuration) != plan['configuration']['sha256']:
                raise ValueError('The selected product changed during qualification')
            report.update(status='product-qualification-accepted',authenticatedProductReady=True,
                modelJourneyAccepted=True,modelTurnsCompleted=3,nativeBindingPreserved=binding,
                nativeProducerReceiptSha256=digest(output/'model/receipt.json'))
        except (ValueError,OSError,subprocess.SubprocessError) as error:
            report['status'] = 'unknown' if report['modelTurnsMayHaveBeenSubmitted'] else 'product-qualification-refused'
            publish(output/'failure.private.txt',(str(error)+'\n').encode(),0o600)
        report['executionLeftOwnedByProduct'] = True
        publish(output/'receipt.json',(json.dumps(report,indent=2)+'\n').encode(),0o600)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['inspect','apply'])
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    options = parser.parse_args()
    path = checkpoint.owned_path(str(options.plan))
    if path.stat().st_mode & 0o022:
        raise ValueError('Use an owner-controlled qualification plan')
    report = qualify(json.loads(path.read_bytes()),options.output,options.action == 'apply')
    print(json.dumps(report,indent=2))
    return 0 if report['status'] in ['inspected','product-qualification-accepted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
