#!/usr/bin/env python3
"""Single-node OCI/Helm assembly. All application lifecycle operations use k3s."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import ssl

os.umask(0o077)
NAMESPACE = 'atlas-system'
RELEASE = 'atlas-mvp'
DATA_ROOT = '/var/lib/atlas'

def run(*command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)

def output(*command):
    return subprocess.check_output(command, text=True)

def kube(*args):
    return output('k3s', 'kubectl', *args)

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)

def apply(value):
    run('k3s', 'kubectl', 'apply', '-f', '-', input=json.dumps(value), text=True, stdout=subprocess.DEVNULL)

def secret(name, data, kind='Opaque'):
    apply({'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': name, 'namespace': NAMESPACE,
        'labels': {'app.kubernetes.io/managed-by': 'atlas-install'}}, 'type': kind,
        'data': {key: base64.b64encode(value if isinstance(value, bytes) else value.encode()).decode() for key, value in data.items()}})

def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def image_digest(tag):
    rows = output('k3s', 'ctr', 'images', 'ls').splitlines()
    matches = [row.split()[2] for row in rows[1:] if row.split()[0] == tag]
    if len(matches) != 1 or not matches[0].startswith('sha256:'):
        raise RuntimeError('Imported image not found: ' + tag)
    ref = tag.rsplit(':', 1)[0] + '@' + matches[0]
    run('k3s', 'ctr', 'images', 'tag', '--force', tag, ref, stdout=subprocess.DEVNULL)
    return ref

def import_archive(path):
    with path.open('rb') as source:
        unzip = subprocess.Popen(['gzip', '-dc'], stdin=source, stdout=subprocess.PIPE)
        try:
            run('k3s', 'ctr', 'images', 'import', '-', stdin=unzip.stdout, stdout=subprocess.DEVNULL)
        finally:
            unzip.stdout.close()
        if unzip.wait():
            raise RuntimeError('Image archive decompression failed')

def helm(root, chart, values, filename='values.json'):
    path = root / filename
    write(path, values)
    with (root / 'helm.log').open('a') as log:
        run('helm', 'upgrade', '--install', RELEASE, str(chart), '--namespace', NAMESPACE,
            '--create-namespace', '--wait', '--wait-for-jobs', '--timeout', '600s', '-f', str(path),
            env={**os.environ, 'KUBECONFIG': '/etc/rancher/k3s/k3s.yaml'}, stdout=log, stderr=subprocess.STDOUT)

def volume_path(claim):
    pvc = json.loads(kube('-n', NAMESPACE, 'get', 'pvc', claim, '-o', 'json'))
    pv = json.loads(kube('get', 'pv', pvc['spec']['volumeName'], '-o', 'json'))
    path = pv['spec'].get('hostPath', pv['spec'].get('local', {})).get('path')
    if not path or not Path(path).is_dir():
        raise RuntimeError('This profile requires a local volume on the installation node')
    return Path(path)

def claim_namespace(root):
    annotation = 'sudostack.io/install-root'
    raw = kube('get', 'namespace', NAMESPACE, '--ignore-not-found', '-o', 'json')
    existing = json.loads(raw) if raw.strip() else None
    if existing:
        owner = existing['metadata'].get('annotations', {}).get(annotation)
        if owner and owner != str(root):
            raise ValueError('This cluster is already managed from installation root ' + owner)
        if not owner and json.loads(kube('-n', NAMESPACE, 'get', 'deployments', '-o', 'json'))['items']:
            raise ValueError('Existing Atlas workloads have no installation-root binding; use the original installation')
    apply({'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': NAMESPACE,
        'annotations': {annotation: str(root)}}})

def create_gateway_tls(root, host, args):
    tls = root / 'tls'
    tls.mkdir(exist_ok=True)
    supplied = (args.tls_cert, args.tls_key, args.tls_ca)
    if any(supplied):
        if not all(supplied):
            raise ValueError('Provide --tls-cert, --tls-key and --tls-ca together')
        for source, name in zip(supplied, ('tls.crt', 'tls.key', 'ca.crt')):
            shutil.copyfile(source, tls / name)
    if not (tls / 'tls.crt').exists():
        import ipaddress
        try:
            ipaddress.ip_address(host)
            san = 'IP:' + host
        except ValueError:
            san = 'DNS:' + host
        with (root / 'certificate.log').open('a') as log:
            run('openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '365',
                '-subj', '/CN=Atlas installation CA', '-keyout', str(tls / 'ca.key'), '-out', str(tls / 'ca.crt'),
                '-addext', 'basicConstraints=critical,CA:TRUE', stdout=log, stderr=log)
            run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=' + host,
                '-keyout', str(tls / 'tls.key'), '-out', str(tls / 'tls.csr'), stdout=log, stderr=log)
            (tls / 'extensions.cnf').write_text('subjectAltName=' + san + '\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n')
            run('openssl', 'x509', '-req', '-in', str(tls / 'tls.csr'), '-CA', str(tls / 'ca.crt'),
                '-CAkey', str(tls / 'ca.key'), '-CAcreateserial', '-days', '90', '-out', str(tls / 'tls.crt'),
                '-extfile', str(tls / 'extensions.cnf'), stdout=log, stderr=log)
    secret('atlas-gateway-tls', {name: (tls / name).read_bytes() for name in ('tls.crt', 'tls.key', 'ca.crt')}, 'kubernetes.io/tls')

def install(args):
    root, assets, chart = args.root.resolve(), args.assets.resolve(), args.chart.resolve()
    if root == Path('/') or not (chart / 'Chart.yaml').exists():
        raise ValueError('Invalid installation root or chart')
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    import fcntl
    lock = open('/run/lock/atlas-install.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    import re
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]*', args.host):
        raise ValueError('host must be an IPv4 address or DNS name')
    manifest = json.loads((assets / 'atlas-release.json').read_text())
    installed = root / 'release-manifest.json'
    if installed.exists():
        previous = json.loads(installed.read_text())
        if previous['release'] != manifest['release'] or previous['archives'] != manifest['archives']:
            raise ValueError('This installer only supports fresh installation and identical-release verification; back up before an upgrade')
        installed_values = json.loads((root / 'values.json').read_text())
        if installed_values['gateway']['webuiOrigin'] != 'https://' + args.host:
            raise ValueError('Host differs from installed gateway; certificate/configuration change required')
        report(root)
        if not (root / 'acceptance/webui-before.json').exists():
            run('python3', str(root / 'smoke.py'), '--root', str(root))
            report(root)
        return
    for name, expected in manifest['archives'].items():
        path = assets / name
        if not path.resolve().is_relative_to(assets) or checksum(path) != expected:
            raise ValueError('Missing or invalid release archive: ' + name)
    print('Release archives verified', flush=True)
    if args.manage_k3s:
        dropin = Path('/etc/rancher/k3s/config.yaml.d/90-atlas.yaml')
        dropin.parent.mkdir(parents=True, exist_ok=True)
        dropin.write_text('# Managed by atlas-install: Caddy owns the gateway ports.\ndisable+:\n  - traefik\n')
    if shutil.which('k3s') is None or subprocess.run(['k3s', 'kubectl', 'get', 'nodes'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        if not args.manage_k3s:
            raise ValueError('A running k3s is required; use --manage-k3s to allow infrastructure installation')
        run('bash', str(assets / 'install.sh'), '--offline', '--role', 'compute', '--non-interactive',
            '--install-dir', str(root / 'bootstrap'), env={**os.environ,
                'INSTALL_K3S_VERSION': manifest['k3s'], 'MOSS_RUNTIME_VERSION': manifest['mossVersion'],
                'IMPORT_RUNTIME_IMAGE': '0', 'OFFLINE_DIR': str(assets / 'offline')})
    elif args.manage_k3s:
        run('systemctl', 'restart', 'k3s')
    for _ in range(90):
        probe = subprocess.run(['k3s', 'kubectl', 'get', 'nodes', '-o', 'json'], capture_output=True, text=True)
        if probe.returncode == 0 and any(c['type'] == 'Ready' and c['status'] == 'True'
            for node in json.loads(probe.stdout)['items'] for c in node['status']['conditions']):
            break
        time.sleep(2)
    nodes = json.loads(kube('get', 'nodes', '-o', 'json'))['items']
    if len(nodes) != 1:
        raise ValueError('This profile supports one k3s node')
    node = nodes[0]['metadata']['labels']['kubernetes.io/hostname']
    kube('get', 'runtimeclass', 'gvisor')
    if not shutil.which('helm'):
        helm_archive = assets / manifest['helm']['archive']
        with tarfile.open(helm_archive) as bundle:
            member = bundle.getmember('linux-amd64/helm')
            with bundle.extractfile(member) as source, open('/usr/local/bin/helm', 'wb') as dest:
                shutil.copyfileobj(source, dest)
        Path('/usr/local/bin/helm').chmod(0o755)
    for archive in manifest['imageArchives']:
        print('Importing ' + archive, flush=True)
        import_archive(assets / archive)
    images = {component: image_digest(tag) for component, tag in manifest['images'].items()}
    claim_namespace(root)
    # Adopt only an empty session namespace from the Moss bootstrap helper.
    existing = json.loads(kube('get', 'namespaces', '-o', 'json'))['items']
    if any(n['metadata']['name'] == 'moss-sessions' for n in existing):
        sessions = json.loads(kube('-n', 'moss-sessions', 'get', 'pods', '-o', 'json'))['items']
        if sessions:
            raise ValueError('Stop active sessions before adopting the session namespace')
        kube('label', 'namespace', 'moss-sessions', 'app.kubernetes.io/managed-by=Helm', '--overwrite')
        kube('annotate', 'namespace', 'moss-sessions', 'meta.helm.sh/release-name=' + RELEASE,
            'meta.helm.sh/release-namespace=' + NAMESPACE, '--overwrite')
    legacy = subprocess.run(['k3s', 'kubectl', '-n', 'moss-control', 'get', 'deployment', 'moss-server', '-o', 'json'], capture_output=True, text=True)
    if legacy.returncode == 0 and json.loads(legacy.stdout)['spec'].get('replicas', 1):
        raise ValueError('Stop the legacy moss-control/moss-server deployment before sharing the session namespace')
    credentials_path = root / 'credentials.json'
    credentials = json.loads(credentials_path.read_text()) if credentials_path.exists() else {
        'adminUsername': 'admin', 'adminPassword': secrets.token_urlsafe(24), 'postgresPassword': secrets.token_urlsafe(32),
        'sessionHmac': secrets.token_hex(32), 'tokenAes': base64.b64encode(secrets.token_bytes(32)).decode()}
    write(credentials_path, credentials)
    webui_url, moss_url = 'https://' + args.host, 'https://' + args.host + ':8443'
    create_gateway_tls(root, args.host, args)
    secret('atlas-postgres', {'POSTGRES_USER': 'atlas', 'POSTGRES_DB': 'sudowork_webui', 'POSTGRES_PASSWORD': credentials['postgresPassword']})
    webui_env = {'DATABASE_URL': 'postgresql://atlas:' + credentials['postgresPassword'] + '@webui-postgres:5432/sudowork_webui',
        'SESSION_HMAC_KEY': credentials['sessionHmac'], 'TOKEN_AES_KEY': credentials['tokenAes'],
        'PUBLIC_ORIGIN': webui_url, 'MOSS_BASE_URL': moss_url, 'MOSS_WS_BASE_URL': moss_url.replace('https:', 'wss:'),
        'NODE_ENV': 'production', 'PORT': '26808', 'TRUST_PROXY': 'true', 'NODE_EXTRA_CA_CERTS': '/etc/atlas-tls/ca.crt'}
    secret('atlas-webui-env', webui_env)
    values = {'nodeName': node, 'images': images, 'imagePullPolicy': 'Never',
        'configRevision': manifest['release'], 'gateway': {'webuiOrigin': webui_url, 'mossOrigin': moss_url},
        'webui': {'migrationRevision': images['webui'].split('sha256:')[1][:12]}}
    foundation = {**values, 'moss': {'enabled': False}, 'webui': {**values['webui'], 'enabled': False},
        'gateway': {**values['gateway'], 'enabled': False}}
    print('Installing Nexus mTLS broker and PostgreSQL with Helm', flush=True)
    helm(root, chart, foundation, 'foundation.json')
    data = volume_path('atlas-data')
    with (assets / manifest['mossBootstrap']).open('rb') as bootstrap:
        run('k3s', 'kubectl', '-n', NAMESPACE, 'exec', '-i', 'deployment/nexus-broker', '--',
            'node', '--input-type=module', '-', DATA_ROOT + '/.moss/nexus/data', stdin=bootstrap)
    tls = data / '.moss/nexus/data/moss-client'
    secret('atlas-nexus-client', {name: (tls / name).read_bytes() for name in ('ca.pem', 'agent.pem', 'agent-key.pem')})
    bundle_path = assets / manifest['mossDeploymentBundle']
    helper_dir = root / 'moss-deployment'
    helper_dir.mkdir(exist_ok=True)
    with tarfile.open(bundle_path) as bundle:
        for name in ('control.py', 'server.json'):
            member = bundle.getmember(name)
            if not member.isfile():
                raise ValueError('Invalid deployment helper')
            (helper_dir / name).write_bytes(bundle.extractfile(member).read())
    spec = importlib.util.spec_from_file_location('moss_control', helper_dir / 'control.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    os.environ.update({'MOSS_ADMIN_USERNAME': credentials['adminUsername'], 'MOSS_ADMIN_PASSWORD': credentials['adminPassword'],
        'MOSS_ADVERTISED_HOST': args.host, 'MOSS_CONTROL_NAMESPACE': NAMESPACE, 'MOSS_K8S_NAMESPACE': 'moss-sessions'})
    generated = root / 'configuration'
    helper.render(Path(DATA_ROOT), generated, manifest['mossVersion'], node)
    config = json.loads((generated / 'server.json').read_text())
    config['server']['publicBaseUrl'] = moss_url
    config['k8s']['image'] = images['runtime']
    config['k8s']['imagePullPolicy'] = 'Never'
    environment = json.loads((generated / 'server-env.json').read_text())
    # This single-replica profile has no owner-routing load balancer.
    environment.pop('MOSS_INSTANCE_ID', None)
    environment.update({'MOSS_NEXUS_ENDPOINT': 'https://nexus-broker:2126',
        'MOSS_NEXUS_TLS_CA': '/etc/nexus-client/ca.pem', 'MOSS_NEXUS_TLS_CERT': '/etc/nexus-client/agent.pem',
        'MOSS_NEXUS_TLS_KEY': '/etc/nexus-client/agent-key.pem', 'MOSS_NEXUS_TLS_SERVER_NAME': 'nexus-node',
        'MOSS_SPAWN_VIA_NEXUS': '1'})
    secret('atlas-moss-config', {'server.json': json.dumps(config)})
    secret('atlas-moss-env', environment)
    for name in ('kubeconfig.json',):
        shutil.copy(generated / name, data / name)
    settings = data / '.moss/settings.json'
    if not settings.exists():
        shutil.copy(generated / 'settings.json', settings)
    write(generated / 'server.json', config)
    write(generated / 'server-env.json', environment)
    print('Installing Moss, WebUI migration and Caddy gateway', flush=True)
    helm(root, chart, values)
    if chart != root / 'chart':
        shutil.copytree(chart, root / 'chart', dirs_exist_ok=True)
    if Path(__file__).resolve() != root / 'atlas.py':
        shutil.copy(__file__, root / 'atlas.py')
    write(root / 'release-manifest.json', {**manifest, 'resolvedImages': images})
    for action in ('status', 'restart', 'stop', 'start', 'verify'):
        import shlex
        script = root / (action + '.sh')
        script.write_text('#!/usr/bin/env bash\nset -euo pipefail\nexec python3 ' + shlex.quote(str(root / 'atlas.py')) + ' ' + action + ' --root ' + shlex.quote(str(root)) + '\n')
        script.chmod(0o755)
    (root / 'admin-credentials.txt').write_text('WebUI: ' + webui_url + '\nMoss Admin: ' + moss_url + '/admin/\nUsername: '
        + credentials['adminUsername'] + '\nPassword: ' + credentials['adminPassword'] + '\n')
    for filename in ('smoke.py', 'webui-smoke.cjs', 'mock-openai-server.mjs', 'snapshot.py'):
        if (assets / filename).resolve() != root / filename:
            shutil.copyfile(assets / filename, root / filename)
    for action in ('backup', 'restore'):
        script = root / (action + '.sh')
        script.write_text('#!/usr/bin/env bash\nset -euo pipefail\nexec python3 ' + shlex.quote(str(root / 'snapshot.py')) + ' ' + action + ' --root ' + shlex.quote(str(root)) + ' "$@"\n')
        script.chmod(0o755)
    report(root)
    run('python3', str(root / 'smoke.py'), '--root', str(root))
    report(root)

def report(root):
    values = json.loads((root / 'values.json').read_text())
    context = ssl.create_default_context(cafile=str(root / 'tls/ca.crt'))
    for base, path in ((values['gateway']['mossOrigin'], '/readyz'), (values['gateway']['webuiOrigin'], '/health/live')):
        with urllib.request.urlopen(base + path, context=context, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError('Gateway health check failed')
    deployments = json.loads(kube('-n', NAMESPACE, 'get', 'deployments', '-o', 'json'))['items']
    summary = {d['metadata']['name']: d.get('status', {}).get('readyReplicas', 0) for d in deployments}
    if len(summary) != 5 or any(count != 1 for count in summary.values()):
        raise RuntimeError('Not all five application Deployments are ready')
    installed = json.loads((root / 'release-manifest.json').read_text())
    write(root / 'deployment-report.json', {'status': 'ready', 'release': installed['release'], 'namespace': NAMESPACE,
        'components': installed.get('components', {}),
        'deployments': summary, 'images': values['images'], 'gateway': values['gateway'],
        'gatewayCaSha256': checksum(root / 'tls/ca.crt'), 'runtimeClass': 'gvisor',
        'acceptance': {name: json.loads((root / 'acceptance' / name).read_text()) for name in ('webui-before.json', 'webui-after.json', 'restore.json') if (root / 'acceptance' / name).exists()},
        'productionCertification': 'pending: Ubuntu 24.04 clean-host qualification, signing/provenance and version-upgrade rollback qualification'})
    print('Five Deployments ready; report: ' + str(root / 'deployment-report.json'), flush=True)

def manage(args):
    root = args.root.resolve()
    if args.action == 'verify':
        report(root)
        return
    if args.action == 'status':
        print(kube('-n', NAMESPACE, 'get', 'deployment,pods,pvc,job', '-o', 'wide'))
        return
    if args.action in ('stop', 'restart'):
        for name in ('sudowork-webui', 'moss-server', 'nexus-broker', 'atlas-gateway'):
            kube('-n', NAMESPACE, 'scale', 'deployment/' + name, '--replicas=0')
        kube('-n', NAMESPACE, 'wait', '--for=delete', 'pods', '-l', 'app in (atlas-webui-server,atlas-moss,atlas-nexus,atlas-gateway)', '--timeout=180s')
        kube('-n', NAMESPACE, 'scale', 'deployment/webui-postgres', '--replicas=0')
        kube('-n', NAMESPACE, 'wait', '--for=delete', 'pods', '-l', 'app=atlas-postgres', '--timeout=180s')
    if args.action in ('start', 'restart'):
        values = json.loads((root / 'values.json').read_text())
        helm(root, root / 'chart', values)
        report(root)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'status', 'restart', 'stop', 'start', 'verify'])
    parser.add_argument('--root', type=Path, default=Path('/data/atlas'))
    parser.add_argument('--assets', type=Path)
    parser.add_argument('--chart', type=Path)
    parser.add_argument('--host')
    parser.add_argument('--manage-k3s', action='store_true')
    parser.add_argument('--tls-cert', type=Path)
    parser.add_argument('--tls-key', type=Path)
    parser.add_argument('--tls-ca', type=Path)
    args = parser.parse_args()
    if args.action == 'install':
        if not args.assets or not args.chart or not args.host:
            parser.error('install requires --assets, --chart and --host')
        install(args)
    else:
        manage(args)

if __name__ == '__main__':
    main()
