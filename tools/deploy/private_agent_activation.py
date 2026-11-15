#!/usr/bin/env python3
"""Activate two named SudoCode Agents on an already prepared native local Node.

Assembly only: Nexus issues credentials and publishes discovery; SudoCode owns
service recovery and session state. This command never bootstraps, resets or
stops a Node. A package must first prepare its Node through the native launcher.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path, value):
    payload = (json.dumps(value, indent=2) + '\n').encode()
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def run(spec):
    """Consume the package's reviewed, exact artifact/placement declaration."""
    if spec.get('schemaVersion') != 1:
        raise ValueError('Unsupported private activation declaration')
    paths = {}
    for name in ('root', 'home', 'dataDir', 'identityDir', 'publisherRepo', 'nexusRepo'):
        value = Path(spec[name])
        if not value.is_absolute() or value.is_symlink():
            raise ValueError('An absolute non-symlink path is required: ' + name)
        paths[name] = value.resolve(strict=True)
    root, home, data = paths['root'], paths['home'], paths['dataDir']
    if root == home or root in home.parents or root == Path(root.anchor):
        raise ValueError('Choose a dedicated deployment root')
    for directory in (home / '.nexus', home / '.nexus/run'):
        if directory.is_symlink():
            raise ValueError('Refusing redirected Node discovery')
    if os.name != 'nt' and any(paths[name].stat().st_uid != os.getuid()
                              for name in ('root', 'home', 'dataDir', 'identityDir')):
        raise ValueError('The deployment and Node must belong to the current OS user')
    for name in ('dataDir', 'identityDir'):
        if root not in paths[name].parents:
            raise ValueError('Only this deployment owns the selected Node: ' + name)
    binaries = {}
    for name in ('scode', 'daemon', 'operator', 'grpcurl'):
        value = spec[name]
        binary = Path(value['path'])
        if not binary.is_absolute() or digest(binary) != value['sha256']:
            raise ValueError('Artifact pin differs: ' + name)
        binaries[name] = binary.resolve(strict=True)
    publisher = paths['publisherRepo'] / 'scripts/cluster/publish-node-record.py'
    proto = paths['nexusRepo'] / 'proto/nexus/grpc/vfs/vfs.proto'
    for name, path in (('publisherSha256', publisher), ('protoSha256', proto)):
        if digest(path) != spec[name]:
            raise ValueError('Source pin differs: ' + name)
    endpoint = spec['endpoint']
    # The publisher performs its own validation and authenticated readiness.
    if not endpoint.startswith('127.0.0.1:') or not endpoint[10:].isdigit() or not 0 < int(endpoint[10:]) < 65536:
        raise ValueError('Expected a numeric loopback Node endpoint')
    record = {'version': 1, 'endpoint': endpoint, 'agents_dir': str(data / 'agents'),
              'role': 'founder', 'zone': spec['zone']}
    discovery = home / '.nexus/run/node.json'
    if discovery.is_symlink():
        raise ValueError('Refusing redirected Node discovery')
    if discovery.exists() and json.loads(discovery.read_bytes()) != record:
        raise ValueError('Another Node is selected; its owner must handle reuse explicitly')
    owner = root / 'service-owner'
    for relative in ('activation', 'config', 'workspaces', 'service-owner'):
        directory = root / relative
        if directory.is_symlink():
            raise ValueError('Refusing deployment symlink: ' + str(directory))
        directory.mkdir(mode=0o700, exist_ok=True)
    state = root / 'activation'
    declaration = state / 'declaration.json'
    if declaration.is_symlink():
        raise ValueError('Refusing redirected activation declaration')
    if declaration.exists():
        if json.loads(declaration.read_bytes()) != spec:
            raise ValueError('Activation declaration changed; an explicit upgrade is required')
    else:
        write_new(declaration, spec)
    # Same-user installer retry reuses the native operator's original claims.
    # The operator itself serializes issuance and refuses Unknown outcomes.
    env = {key: value for key, value in os.environ.items() if key.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'SYSTEMDRIVE'}}
    env.update(HOME=str(home), USERPROFILE=str(home), SUDO_CODE_CONFIG_HOME=str(root / 'config'),
               SCODE_SERVICE_ROOT=str(owner), NEXUS_IDENTITY_DIR=str(paths['identityDir']))
    attempts = state / ('run-' + uuid.uuid4().hex)
    attempts.mkdir(mode=0o700)

    def command(label, argv, stdin=None):
        result = subprocess.run([str(part) for part in argv], input=stdin,
                                capture_output=True, cwd=root, env=env, timeout=90)
        (attempts / (label + '.stdout.json')).write_bytes(result.stdout)
        (attempts / (label + '.stderr.log')).write_bytes(result.stderr)
        if result.returncode:
            raise RuntimeError(label + ' failed; inspect the retained private receipt, do not invent another claim')
        return json.loads(result.stdout)

    actors = []
    for role in ('executor', 'verifier'):
        name = 'private-' + role
        workspace = root / 'workspaces' / role
        if workspace.is_symlink():
            raise ValueError('Refusing workspace symlink')
        settings = workspace / '.nexus/sudocode/settings.json'
        for directory in (workspace, workspace / '.nexus', settings.parent):
            if directory.is_symlink():
                raise ValueError('Refusing workspace configuration symlink')
            directory.mkdir(mode=0o700, exist_ok=True)
        if settings.exists():
            if settings.is_symlink() or json.loads(settings.read_bytes()).get('agentName') != name:
                raise ValueError('Workspace already selects another Agent')
        else:
            write_new(settings, {'agentName': name})
        actors.append({'name': name, 'workspace': str(workspace)})
    grant = state / 'grant.json'
    if grant.is_symlink():
        raise ValueError('Refusing redirected enrollment grant')
    if not grant.exists():
        argv = [binaries['operator'], '--initialize', '--grant', grant, '--data-dir', data,
                '--endpoint', 'https://' + endpoint]
        for actor in actors:
            argv.extend(['--agent', actor['name'] + '=' + actor['workspace']])
        prepared = command('prepare-grant', argv)
        if prepared['issued'] is not False:
            raise ValueError('Grant preparation unexpectedly issued credentials')
    policy = json.loads(grant.read_bytes())
    if (policy['version'] != 2 or policy['endpoint'] != 'https://' + endpoint
            or not Path(policy['nodeDataDirectory']).samefile(data)
            or len(policy['agents']) != len(actors)
            or any(expected['name'] != actual['name']
                   or not Path(expected['workspace']).samefile(actual['workspace'])
                   for expected, actual in zip(actors, policy['agents']))):
        raise ValueError('Native grant differs from this placement')
    receipts = []
    for actor in actors:
        claim_file = state / (actor['name'] + '.claim.json')
        if claim_file.is_symlink():
            raise ValueError('Refusing redirected enrollment claim')
        if not claim_file.exists():
            write_new(claim_file, {'version': 2, 'actor': actor['name'],
                                  'workspace': actor['workspace'], 'operationId': str(uuid.uuid4())})
        claim = json.loads(claim_file.read_bytes())
        if claim['version'] != 2 or claim['actor'] != actor['name'] or claim['workspace'] != actor['workspace']:
            raise ValueError('Original enrollment claim differs')
        receipt = command('enroll-' + actor['name'], [binaries['operator'], '--grant', grant],
                          json.dumps(claim).encode())
        if receipt['actor'] != actor['name']:
            raise ValueError('Native receipt differs from the selected Agent')
        receipts.append(receipt)
    credential = json.loads((Path(receipts[0]['credentialDirectory']) / 'credential.json').read_bytes())
    profile = {'schemaVersion': 1, 'boxEndpoint': endpoint,
        'binary': str(binaries['daemon']), 'binarySha256': spec['daemon']['sha256'],
        'dataDir': str(data), 'identityDir': str(paths['identityDir']),
        'nodeId': str(int.from_bytes((data / '.node_id').read_bytes(), 'big')),
        'caSha256': digest(data / 'tls/ca.pem'), 'certificateSha256': digest(data / 'tls/node.pem'),
        'localEndpoint': endpoint, 'advertiseAddr': endpoint, 'bindAddr': endpoint,
        'hostname': spec['hostname'], 'serverName': credential['server_name'],
        'acceptEnrollments': spec.get('acceptEnrollments', False)}
    registered = owner / 'run/local-box.json'
    if registered.is_symlink():
        raise ValueError('Refusing redirected owner registration')
    if registered.exists():
        if json.loads(registered.read_bytes()) != profile:
            raise ValueError('Registered Node owner differs; no replacement is allowed')
    else:
        profile_file = attempts / 'owner.json'
        write_new(profile_file, profile)
        command('register-owner', [binaries['scode'], 'service', 'register-local-box',
                                  '--config', profile_file, '--owner-root', owner])
    (home / '.nexus').mkdir(mode=0o700, exist_ok=True)
    setup = [binaries['scode'], 'setup', '--mode', 'shared',
             '--owner-root', owner, '--output-format', 'json']
    # Once discovery exists, the original registered owner can restore an
    # offline Node before the publisher repeats its authenticated probes.
    selected = command('restore-owner', setup) if discovery.exists() else None
    publication = command('publish-node', [sys.executable, publisher, '--role', 'founder',
        '--agents-dir', data / 'agents', '--endpoint', endpoint, '--zone', spec['zone'],
        '--agent', actors[0]['name'], '--grpcurl', binaries['grpcurl'], '--proto', proto,
        '--node-id-sha256', digest(data / '.node_id'), '--publish'])
    if selected is None:
        selected = command('select-owner', setup)
    result = {'activated': True, 'actors': actors, 'publication': publication['status'],
              'owner': selected['service'], 'evidence': str(attempts),
              'modelInferenceVerified': False, 'twoAgentDeliveryVerified': False}
    write_new(attempts / 'receipt.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--declaration', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(json.loads(args.declaration.read_bytes()))))


if __name__ == '__main__':
    main()
