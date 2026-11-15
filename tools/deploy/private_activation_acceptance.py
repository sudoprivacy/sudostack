#!/usr/bin/env python3
"""Exercise the private activation entry against real native Node/SDK binaries."""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

from private_agent_activation import digest, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--declaration', type=Path, required=True,
                        help='Exact binary/source pins; fixture substitutes placement paths only')
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    spec = json.loads(args.declaration.read_bytes())
    for name in ('scode', 'daemon', 'operator', 'grpcurl'):
        assert digest(Path(spec[name]['path'])) == spec[name]['sha256'], name + ' pin differs'
    native_path = Path(spec['nexusRepo']) / 'scripts/e2e/operator_agent_enrollment.py'
    module = importlib.util.spec_from_file_location('native', native_path)
    native = importlib.util.module_from_spec(module)
    module.loader.exec_module(native)
    fixture = native.Journey(argparse.Namespace(daemon=Path(spec['daemon']['path']),
                                               operator=Path(spec['operator']['path']), output=args.output))
    home = fixture.root / 'home'
    home.mkdir()
    deployment = fixture.root / 'deployment'
    deployment.mkdir()
    fixture.node.root = deployment / 'node'
    fixture.node.data = fixture.node.root / 'data'
    fixture.data = fixture.node.data
    fixture.node.env.update(NEXUS_DATA_DIR=str(fixture.data),
                            NEXUS_IDENTITY_DIR=str(fixture.node.root / 'identity'))
    spec.update(root=str(deployment), home=str(home), dataDir=str(fixture.data),
                identityDir=str(fixture.node.root / 'identity'), endpoint=fixture.node.address,
                zone='sharedzone', hostname='localhost', acceptEnrollments=True)
    fixture.proof.update(journey='private-activation-entry', assemblySha256=digest(Path(__file__)),
                         activationSha256=digest(Path(__file__).with_name('private_agent_activation.py')))
    managed = False
    env = {key: value for key, value in os.environ.items() if key.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'SYSTEMDRIVE'}}
    fixture.node.env = env | {key: value for key, value in fixture.node.env.items() if key.startswith('NEXUS_')}
    fixture.node.env.update(HOME=str(home), USERPROFILE=str(home), NEXUS_HOSTNAME='localhost', RUST_LOG='info')
    try:
        fixture.node.start()
        first = run(spec)
        assert first['activated'] and first['publication'] == 'published'
        assert first['owner']['managed'] is False
        fixture.proof['realMintAgentRpc'] = True
        activation = deployment / 'activation'
        before = {str(path.relative_to(activation)): digest(path)
                  for path in activation.rglob('*') if path.is_file()}
        refusals = []
        for label in ('changed-binary', 'different-node', 'changed-declaration'):
            changed = copy.deepcopy(spec)
            if label == 'changed-binary':
                changed['scode']['sha256'] = '0' * 64
            elif label == 'different-node':
                changed['endpoint'] = '127.0.0.1:1'
            else:
                changed['hostname'] = 'another-host'
            try:
                run(changed)
            except ValueError as error:
                refusals.append({'case': label, 'error': str(error)})
            else:
                raise AssertionError('Activation accepted ' + label)
            assert before == {str(path.relative_to(activation)): digest(path)
                              for path in activation.rglob('*') if path.is_file()}
        fixture.proof['refusedChangesWithoutEnrollment'] = refusals
        hashes = {str(path.relative_to(fixture.data)): digest(path)
                  for path in (fixture.data / 'agents').rglob('*') if path.is_file()}
        second = run(spec)
        assert second['publication'] == 'already-published' and second['actors'] == first['actors']
        assert hashes == {name: digest(fixture.data / name) for name in hashes}
        fixture.proof['idempotentNativeActivation'] = True
        config = {'root': str(fixture.root), 'output': str(fixture.output),
                  'sdk': str(args.sdk.resolve()), 'scode': spec['scode']['path'], 'actors': []}
        for actor in first['actors']:
            config['actors'].append(actor | {'configHome': str(deployment / 'config'), 'env': {
                'HOME': str(home), 'USERPROFILE': str(home),
                'SUDO_CODE_CONFIG_HOME': str(deployment / 'config'),
                'SCODE_SERVICE_ROOT': str(deployment / 'service-owner')}})
        config_file = fixture.root / 'driver.json'
        config_file.write_text(json.dumps(config))
        for phase in ('initial', 'node-restart'):
            fixture.proof['stage'] = phase
            if phase == 'node-restart':
                fixture.node.stop()
                managed = True
                restored = run(spec)
                assert restored['owner']['managed'] and restored['actors'] == first['actors']
                assert hashes == {name: digest(fixture.data / name) for name in hashes}
                fixture.proof['activationRestoresOriginalOwner'] = True
            result = subprocess.run(['node', str(Path(__file__).with_name('private_agents_acceptance.cjs')),
                                     str(config_file), phase], env=env, cwd=fixture.root,
                                    capture_output=True, timeout=180)
            (fixture.output / (phase + '.stdout.log')).write_bytes(result.stdout)
            (fixture.output / (phase + '.stderr.log')).write_bytes(result.stderr)
            assert result.returncode == 0, result.stderr.decode(errors='replace')
            fixture.proof[phase] = json.loads(result.stdout)
        fixture.proof.update(success=True, stage='complete', credentialsUnchanged=True,
                             limits=['prepared native Node; factory/bootstrap package not qualified',
                                     'fixture accounts; no real model inference, OS login or roaming'])
    finally:
        if managed:
            owner = deployment / 'service-owner'
            profile = json.loads((owner / 'run/local-box.json').read_bytes())
            stopped = subprocess.run([spec['scode']['path'], 'service', 'stop-local-box',
                '--owner-root', str(owner), '--node-id', profile['nodeId'],
                '--binary-sha256', profile['binarySha256'], '--acknowledge-shared-outage'],
                env=env | {'HOME': str(home), 'USERPROFILE': str(home)}, cwd=fixture.root,
                capture_output=True, timeout=90)
            (fixture.output / 'stop-owner.stdout.log').write_bytes(stopped.stdout)
            (fixture.output / 'stop-owner.stderr.log').write_bytes(stopped.stderr)
            if stopped.returncode != 0:
                fixture.proof.update(success=False, cleanup='Owner stop unconfirmed; private state retained')
                (fixture.output / 'receipt.json').write_text(json.dumps(fixture.proof, indent=2))
                raise RuntimeError('Owned service stop was not confirmed; state retained')
            fixture.proof['nativeOwnerStopped'] = True
        # Retain non-secret activation receipts before removing fixture keys.
        activation = deployment / 'activation'
        fixture.proof['activationResults'] = [json.loads(path.read_bytes())
            for path in activation.glob('run-*/receipt.json')] if activation.exists() else []
        for directory in activation.glob('run-*'):
            target = fixture.output / 'activation' / directory.name
            shutil.copytree(directory, target)
        fixture.finish()


if __name__ == '__main__':
    main()
