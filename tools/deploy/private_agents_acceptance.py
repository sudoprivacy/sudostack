#!/usr/bin/env python3
"""Qualify native named Agents and SudoCode ACP on an owned temporary TLS Node.

This fixture reuses Nexus's real-process Node harness and SudoCode's SDK. It
does not install services, read user keys, publish a real user's Node record,
or qualify a production installer. Evidence survives; fixture keys do not.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('nexus-repo', 'sdk', 'scode', 'daemon', 'operator', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('scode', 'daemon', 'operator'):
        parser.add_argument('--' + name + '-sha256', required=True)
    parser.add_argument('--daemon-source', required=True)
    args = parser.parse_args()
    for name in ('scode', 'daemon', 'operator'):
        assert digest(getattr(args, name)) == getattr(args, name + '_sha256'), name + ' artifact differs'
    spec = importlib.util.spec_from_file_location('native_enrollment',
        args.nexus_repo / 'scripts/e2e/operator_agent_enrollment.py')
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    fixture = native.Journey(args)
    fixture.proof.update(journey='private-named-agents', scodeSha256=digest(args.scode),
                         sdkManifestSha256=digest(args.sdk / 'manifest.json'),
                         daemonSource=args.daemon_source,
                         assemblyRunnerSha256=digest(__file__),
                         assemblyDriverSha256=digest(Path(__file__).with_suffix('.cjs')))
    # Only this fixture's subprocesses receive the isolated discovery/config.
    environment = {key: value for key, value in os.environ.items() if key.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
        'SYSTEMDRIVE', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'}}
    config = {'root': str(fixture.root), 'output': str(fixture.output),
              'scode': str(args.scode.resolve()), 'sdk': str(args.sdk.resolve()), 'actors': []}
    claims, credentials = [], []
    try:
        fixture.node.start()
        for name in ('private-executor', 'private-verifier'):
            home = fixture.root / (name + '-home')
            workspace = fixture.root / name
            config_home = fixture.root / (name + '-config')
            for directory in (home, workspace, config_home, home / '.nexus/run',
                              workspace / '.nexus/sudocode'):
                directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            (workspace / '.nexus/sudocode/settings.json').write_text(json.dumps({'agentName': name}))
            # Fixture-only record, equivalent to the native SDK's private test
            # harness. The real OS-user record is never read or replaced.
            (home / '.nexus/run/node.json').write_text(json.dumps({
                'version': 1, 'endpoint': fixture.node.address,
                'agents_dir': str(fixture.data / 'agents'), 'role': 'founder', 'zone': 'sharedzone'}))
            env = {'HOME': str(home), 'USERPROFILE': str(home), 'SUDO_CODE_CONFIG_HOME': str(config_home),
                   'SCODE_SERVICE_ROOT': str(home / 'service'), 'NO_COLOR': '1', 'RUST_LOG': 'info',
                   'APPDATA': str(home / 'AppData/Roaming'), 'LOCALAPPDATA': str(home / 'AppData/Local')}
            for key in ('APPDATA', 'LOCALAPPDATA'):
                Path(env[key]).mkdir(parents=True)
            config['actors'].append({'name': name, 'workspace': str(workspace),
                                     'configHome': str(config_home), 'env': env})
        argv = [str(args.operator.resolve()), '--initialize', '--grant', str(fixture.grant),
                '--data-dir', str(fixture.data), '--endpoint', 'https://' + fixture.node.address]
        for actor in config['actors']:
            argv += ['--agent', actor['name'] + '=' + actor['workspace']]
        initialized = subprocess.run(argv, env=environment, capture_output=True, timeout=30)
        (fixture.output / 'initialize.stdout.json').write_bytes(initialized.stdout)
        (fixture.output / 'initialize.stderr.log').write_bytes(initialized.stderr)
        assert initialized.returncode == 0, initialized.stderr.decode(errors='replace')
        assert json.loads(initialized.stdout)['issued'] is False
        for index, actor in enumerate(config['actors'], 1):
            claim = {'version': 2, 'actor': actor['name'], 'workspace': actor['workspace'],
                     'operationId': f'50000000-0000-4000-8000-00000000000{index}'}
            reply = fixture.request('mint-' + actor['name'], claim)
            assert reply.get('actor') == actor['name'], reply
            credential = Path(reply['credentialDirectory'])
            credentials.append((credential, {name: digest(credential / name)
                                for name in ('agent.pem', 'agent-key.pem', 'credential.json')}))
            claims.append((claim, reply))
        assert credentials[0][1]['agent.pem'] != credentials[1][1]['agent.pem']
        fixture.proof['realMintAgentRpc'] = True
        file = fixture.root / 'driver.json'
        file.write_text(json.dumps(config), encoding='utf-8')
        driver = Path(__file__).with_suffix('.cjs')
        for phase in ('initial', 'node-restart'):
            fixture.proof['stage'] = phase
            if phase == 'node-restart':
                fixture.node.stop()
                fixture.node.start()
            result = subprocess.run(['node', str(driver), str(file), phase], env=environment,
                                    capture_output=True, timeout=180)
            (fixture.output / (phase + '.stdout.log')).write_bytes(result.stdout)
            (fixture.output / (phase + '.stderr.log')).write_bytes(result.stderr)
            assert result.returncode == 0, result.stderr.decode(errors='replace')
            for claim, reply in claims:
                assert fixture.request(phase + '-replay-' + claim['actor'], claim) == reply
            for directory, hashes in credentials:
                assert hashes == {name: digest(directory / name) for name in hashes}
            fixture.proof[phase] = json.loads(result.stdout)
        fixture.proof.update(success=True, stage='complete', credentialsUnchanged=True,
                             limits=['isolated fixture, not OS-user installation',
                                     'no model inference or network-roaming acceptance',
                                     'no macOS login/reboot or ARM64 qualification'])
    finally:
        fixture.finish()


if __name__ == '__main__':
    main()
