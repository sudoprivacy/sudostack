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
import sys


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('nexus-repo', 'sdk', 'scode', 'daemon', 'operator', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('scode', 'daemon', 'operator'):
        parser.add_argument('--' + name + '-sha256', required=True)
    parser.add_argument('--daemon-source', required=True)
    parser.add_argument('--activate-owner', action='store_true',
                        help='Also qualify native discovery publication and SudoCode owner recovery')
    parser.add_argument('--publisher-repo', type=Path)
    parser.add_argument('--grpcurl', type=Path)
    parser.add_argument('--grpcurl-sha256')
    args = parser.parse_args()
    if args.activate_owner and not all((args.publisher_repo, args.grpcurl, args.grpcurl_sha256)):
        parser.error('--activate-owner requires --publisher-repo, --grpcurl and --grpcurl-sha256')
    for name in ('scode', 'daemon', 'operator'):
        assert digest(getattr(args, name)) == getattr(args, name + '_sha256'), name + ' artifact differs'
    if args.activate_owner:
        assert digest(args.grpcurl) == args.grpcurl_sha256, 'grpcurl artifact differs'
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
    owner = fixture.root / 'service-owner'
    owner_profile = None
    managed_attempted = False

    def command(label, argv, env):
        result = subprocess.run([str(part) for part in argv], env=env, cwd=fixture.root,
                                capture_output=True, timeout=90)
        (fixture.output / (label + '.stdout.json')).write_bytes(result.stdout)
        (fixture.output / (label + '.stderr.log')).write_bytes(result.stderr)
        assert result.returncode == 0, result.stderr.decode(errors='replace')
        return json.loads(result.stdout)

    def owner_cli(label, *arguments, actor=None):
        actor = actor or config['actors'][0]
        return command(label, [args.scode, *arguments], environment | actor['env'])

    try:
        node_home = fixture.root / 'node-home'
        node_home.mkdir()
        fixture.node.env = environment | {key: value for key, value in fixture.node.env.items()
                                         if key.startswith('NEXUS_')}
        fixture.node.env.update(HOME=str(node_home), USERPROFILE=str(node_home),
                                NEXUS_HOSTNAME='localhost', RUST_LOG='info', NO_COLOR='1')
        fixture.node.start()
        for name in ('private-executor', 'private-verifier'):
            home = fixture.root / (name + '-home')
            workspace = fixture.root / name
            config_home = fixture.root / (name + '-config')
            for directory in (home, workspace, config_home, home / '.nexus',
                              workspace / '.nexus/sudocode'):
                directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            (workspace / '.nexus/sudocode/settings.json').write_text(json.dumps({'agentName': name}))
            # Fixture-only record, equivalent to the native SDK's private test
            # harness. The real OS-user record is never read or replaced.
            if not args.activate_owner:
                (home / '.nexus/run').mkdir(mode=0o700)
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
        initialized = subprocess.run(argv, env=fixture.node.env, cwd=fixture.root,
                                     capture_output=True, timeout=30)
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
        if args.activate_owner:
            publisher = args.publisher_repo.resolve() / 'scripts/cluster/publish-node-record.py'
            fixture.proof.update(publisherSha256=digest(publisher), grpcurlSha256=digest(args.grpcurl),
                                 publisherSource=subprocess.check_output(
                                     ['git', '-C', str(args.publisher_repo), 'rev-parse', 'HEAD'], text=True).strip())
            for actor in config['actors']:
                argv = [sys.executable, publisher, '--role', 'founder',
                        '--agents-dir', fixture.data / 'agents', '--endpoint', fixture.node.address,
                        '--zone', 'sharedzone', '--agent', actor['name'], '--grpcurl', args.grpcurl,
                        '--proto', args.nexus_repo / 'proto/nexus/grpc/vfs/vfs.proto',
                        '--node-id-sha256', digest(fixture.data / '.node_id'), '--publish']
                published = command('publish-' + actor['name'], argv, environment | actor['env'])
                assert published['status'] == 'published' and len(published['authenticatedProbes']) == 6
                repeated = command('publish-repeat-' + actor['name'], argv, environment | actor['env'])
                assert repeated['status'] == 'already-published'
            credential = json.loads((credentials[0][0] / 'credential.json').read_bytes())
            owner_profile = {'schemaVersion': 1, 'boxEndpoint': fixture.node.address,
                'binary': str(args.daemon.resolve()), 'binarySha256': digest(args.daemon),
                'dataDir': str(fixture.data), 'identityDir': str(fixture.node.root / 'identity'),
                'nodeId': str(int.from_bytes((fixture.data / '.node_id').read_bytes(), 'big')),
                'caSha256': digest(fixture.data / 'tls/ca.pem'),
                'certificateSha256': digest(fixture.data / 'tls/node.pem'),
                'localEndpoint': fixture.node.address, 'advertiseAddr': fixture.node.address,
                'bindAddr': fixture.node.address, 'hostname': 'localhost',
                'serverName': credential['server_name'], 'acceptEnrollments': True}
            profile_file = fixture.root / 'owner.json'
            profile_file.write_text(json.dumps(owner_profile))
            registered = owner_cli('register-owner', 'service', 'register-local-box',
                                   '--config', profile_file, '--owner-root', owner)
            assert registered['registered'] and registered['started'] is False
            for actor in config['actors']:
                selected = owner_cli('select-' + actor['name'], 'setup', '--mode', 'shared',
                                     '--owner-root', owner, '--output-format', 'json', actor=actor)
                assert selected['service']['managed'] is False
            assert fixture.node.process.poll() is None
            fixture.proof['nativePublicationAndExternalReuse'] = True
        file = fixture.root / 'driver.json'
        file.write_text(json.dumps(config), encoding='utf-8')
        driver = Path(__file__).with_suffix('.cjs')
        for phase in ('initial', 'node-restart'):
            fixture.proof['stage'] = phase
            if phase == 'node-restart':
                fixture.node.stop()
                if args.activate_owner:
                    managed_attempted = True
                    recovered = owner_cli('recover-owner', 'setup', '--mode', 'shared',
                                          '--owner-root', owner, '--output-format', 'json')
                    assert recovered['service']['managed'] is True
                    fixture.proof['nativeOwnerRecovery'] = True
                else:
                    fixture.node.start()
            result = subprocess.run(['node', str(driver), str(file), phase], env=environment,
                                    cwd=fixture.root, capture_output=True, timeout=180)
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
        if managed_attempted:
            try:
                stopped = owner_cli('stop-owned-service', 'service', 'stop-local-box',
                    '--owner-root', owner, '--node-id', owner_profile['nodeId'],
                    '--binary-sha256', owner_profile['binarySha256'], '--acknowledge-shared-outage')
                assert stopped['stopped']
                fixture.proof['nativeOwnerStopped'] = True
            except Exception:
                fixture.proof.update(success=False, cleanup='owner stop unconfirmed; private state retained')
                (fixture.output / 'receipt.json').write_text(json.dumps(fixture.proof, indent=2))
                raise
        fixture.finish()


if __name__ == '__main__':
    main()
