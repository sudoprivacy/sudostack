#!/usr/bin/env python3
"""Single-node OCI/Helm assembly. All application lifecycle operations use k3s."""
import argparse
import base64
import errno
import importlib.util
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.error
import ssl

from artifacts import RUNTIME_SCRIPTS, checksum
from images import retain_archive

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

def image_digest(tag):
    rows = output('k3s', 'ctr', 'images', 'ls').splitlines()
    matches = [row.split()[2] for row in rows[1:] if row.split()[0] == tag]
    if len(matches) != 1 or not matches[0].startswith('sha256:'):
        raise RuntimeError('Imported image not found: ' + tag)
    ref = tag.rsplit(':', 1)[0] + '@' + matches[0]
    run('k3s', 'ctr', 'images', 'tag', '--force', tag, ref, stdout=subprocess.DEVNULL)
    return ref

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

def validate_host(manifest):
    machine = platform.machine()
    host_arch = {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(machine)
    if platform.system() != 'Linux' or host_arch is None:
        raise ValueError('Installation requires Linux amd64 or arm64; detected ' + platform.system() + ' ' + machine)
    if manifest.get('architecture') != host_arch:
        raise ValueError('Architecture mismatch: host is ' + host_arch + ', release is ' + str(manifest.get('architecture')))
    # The pinned upstream gVisor arm64 release uses the default 4K-page build.
    if host_arch == 'arm64' and os.sysconf('SC_PAGE_SIZE') != 4096:
        raise ValueError('The bundled ARM64 gVisor requires a 4096-byte host page size')
    return host_arch


def preflight_existing_cluster():
    systemctl = shutil.which('systemctl')
    agent_running = systemctl and subprocess.run([systemctl, 'is-active', '--quiet', 'k3s-agent'],
                                                capture_output=True, timeout=10).returncode == 0
    if agent_running or shutil.which('k3s-agent-uninstall.sh'):
        raise ValueError('An existing k3s-agent is running or still installed; back up local cluster data and detach this host '
                         'before installing the single-node profile. The standard agent uninstaller is '
                         '/usr/local/bin/k3s-agent-uninstall.sh (removes local k3s data; keeps the COS download cache).')
    if not shutil.which('k3s'):
        return
    probe = subprocess.run(['k3s', 'kubectl', 'get', 'nodes', '--request-timeout=10s', '-o', 'json'],
                           capture_output=True, text=True, timeout=15)
    if probe.returncode and systemctl and subprocess.run([systemctl, 'is-active', '--quiet', 'k3s'],
                                                        capture_output=True, timeout=10).returncode == 0:
        raise ValueError('Cannot inspect the existing active k3s cluster; restore API access before installing')
    if probe.returncode == 0 and len(json.loads(probe.stdout)['items']) > 1:
        raise ValueError('This profile supports one k3s node; the existing multi-node cluster cannot be managed by this installer')


def preflight_gateway_ports(ports):
    """Catch host listeners before importing images or changing k3s configuration."""
    conflicts = set()
    for port in ports:
        for family, address in ((socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::')):
            try:
                with socket.socket(family, socket.SOCK_STREAM) as probe:
                    # Linux can ignore TIME_WAIT without sharing a listener.
                    # BSD permits overlapping wildcard binds with this option.
                    if platform.system() == 'Linux':
                        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    if family == socket.AF_INET6:
                        probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    probe.bind((address, port))
                    probe.listen(1)
            except OSError as error:
                if error.errno == errno.EADDRINUSE:
                    conflicts.add(port)
                elif family == socket.AF_INET6 and error.errno in (
                        errno.EAFNOSUPPORT, errno.EPROTONOSUPPORT, errno.EADDRNOTAVAIL):
                    continue  # IPv4-only kernels are valid hosts for this profile.
                else:
                    raise RuntimeError(f'Cannot check gateway TCP port {port}: {error}') from error
    if conflicts:
        raise ValueError('Gateway TCP ports already in use: ' + ', '.join(map(str, sorted(conflicts)))
                         + '. Stop or move the existing web server/container before installation. '
                         'Inspect with sudo ss -ltnp and docker ps. No existing service was stopped.')


def gateway_open(root, request, timeout=15):
    """Access the installation directly with its own CA, regardless of shell proxies."""
    context = ssl.create_default_context(cafile=str(root / 'tls/ca.crt'))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                        urllib.request.HTTPSHandler(context=context))
    url = request.full_url if isinstance(request, urllib.request.Request) else request
    try:
        return opener.open(request, timeout=timeout)
    except urllib.error.URLError as error:
        if isinstance(error.reason, ssl.SSLCertVerificationError):
            raise RuntimeError(f'Gateway TLS verification failed at {url}. The endpoint must present a certificate '
                               f'trusted by {root / "tls/ca.crt"}. Check for an old service on 443/8443/9443, '
                               'wrong DNS/host, or mismatched supplied certificates; TLS verification remains enabled. '
                               'After correcting the endpoint, rerun the same installer to resume verification.') from error
        raise


def install(args):
    root, assets, chart = args.root.resolve(), args.assets.resolve(), args.chart.resolve()
    if root == Path('/') or not (chart / 'Chart.yaml').exists():
        raise ValueError('Invalid installation root or chart')
    manifest = json.loads((assets / 'atlas-release.json').read_text())
    architecture = validate_host(manifest)
    preflight_existing_cluster()
    # An identical-release retry already owns its gateway; it proceeds to HTTPS
    # checks below instead of treating its own host ports as a fresh conflict.
    if not (root / 'release-manifest.json').exists():
        ports = [80, 443, 8443] + ([9443] if 'router' in manifest['components'] else [])
        preflight_gateway_ports(ports)
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    import fcntl
    lock = open('/run/lock/atlas-install.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    import re
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]*', args.host):
        raise ValueError('host must be an IPv4 address or DNS name')
    for name, expected in manifest['archives'].items():
        path = assets / name
        if not path.resolve().is_relative_to(assets) or checksum(path) != expected:
            raise ValueError('Missing or invalid release archive: ' + name)
    print('Release archives verified', flush=True)
    installed = root / 'release-manifest.json'
    if installed.exists():
        previous = json.loads(installed.read_text())
        if previous['release'] != manifest['release'] or previous['archives'] != manifest['archives']:
            if args.add_router:
                validate_router_addition(previous, manifest)
                add_router(root, assets, chart, manifest, args.host)
                return
            raise ValueError('This installer only supports fresh installation and identical-release verification; back up before an upgrade')
        installed_values = json.loads((root / 'values.json').read_text())
        if installed_values['gateway']['webuiOrigin'] != 'https://' + args.host:
            raise ValueError('Host differs from installed gateway; certificate/configuration change required')
        report(root)
        qualify(root)
        print_access_info(root)
        return
    if args.add_router:
        raise ValueError('--add-router requires an existing installation of the pinned base release')
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
            member = bundle.getmember('linux-' + architecture + '/helm')
            with bundle.extractfile(member) as source, open('/usr/local/bin/helm', 'wb') as dest:
                shutil.copyfileobj(source, dest)
        Path('/usr/local/bin/helm').chmod(0o755)
    for archive in manifest['imageArchives']:
        print('Importing ' + archive, flush=True)
        retain_archive(assets / archive, manifest['archives'][archive])
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
    if 'router' in images:
        import router
        router_credentials = router.credentials(root)
        secret('atlas-router-env', {'SESSION_SECRET': router_credentials['sessionSecret']})
        values['router'] = {'enabled': True, 'expose': False}
        values['gateway']['routerOrigin'] = 'https://' + args.host + ':9443'
        write(root / 'values.json', values)
    foundation = {**values, 'moss': {'enabled': False}, 'webui': {**values['webui'], 'enabled': False},
        'gateway': {**values['gateway'], 'enabled': False}}
    print('Installing Nexus mTLS broker and PostgreSQL with Helm', flush=True)
    helm(root, chart, foundation, 'foundation.json')
    if 'router' in images:
        router.provision(root, manifest['components']['router']['version'])
        values['router']['expose'] = True
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
    # Older amd64 owner releases predate the architecture argument.
    render_options = {'architecture': architecture} if architecture == 'arm64' else {}
    helper.render(Path(DATA_ROOT), generated, manifest['mossVersion'], node, **render_options)
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
    if 'router' in images:
        router.configure_moss(root)
    finalize_install(root, assets, chart, manifest, images)
    qualify(root)
    print_access_info(root)


def validate_router_addition(previous, manifest):
    base = manifest.get('extends', {})
    if (previous['release'] != base.get('release') or previous['archives'] != base.get('archives')
        or previous.get('architecture') != manifest.get('architecture')
        or 'router' in previous['images'] or set(manifest['images']) != set(previous['images']) | {'router'}
        or previous['components'] != {k: v for k, v in manifest['components'].items() if k != 'router'}
        or any(manifest['images'][k] != v for k, v in previous['images'].items())
        or any(manifest['archives'].get(name) != previous['archives'][name] for name in previous['imageArchives'])):
        raise ValueError('Router addition requires the exact pinned base release and unchanged component images')


def add_router(root, assets, chart, manifest, host):
    import router
    values = json.loads((root / 'values.json').read_text())
    if values['gateway']['webuiOrigin'] != 'https://' + host:
        raise ValueError('Host differs from the existing installation')
    claim_namespace(root)
    router.assert_moss_configuration(root)
    value = router.credentials(root)
    secret('atlas-router-env', {'SESSION_SECRET': value['sessionSecret']})
    retain_archive(assets / manifest['routerArchive'], manifest['archives'][manifest['routerArchive']])
    values['images']['router'] = image_digest(manifest['images']['router'])
    values['gateway']['routerOrigin'] = 'https://' + host + ':9443'
    values['router'] = {'enabled': True, 'expose': False}
    # Preserve the original application configuration revision and image digests.
    helm(root, chart, values)
    router.provision(root, manifest['components']['router']['version'])
    values['router']['expose'] = True
    helm(root, chart, values)
    router.configure_moss(root)
    finalize_install(root, assets, chart, manifest, values['images'])
    qualify(root)
    print_access_info(root)


def install_runtime_tools(root, assets):
    for filename in RUNTIME_SCRIPTS:
        if not (assets / filename).is_file():
            raise ValueError('Missing runtime tool: ' + filename)
    root.mkdir(parents=True, exist_ok=True)
    for filename in RUNTIME_SCRIPTS:
        if (assets / filename).resolve() != (root / filename).resolve():
            shutil.copyfile(assets / filename, root / filename)
    (root / 'cleanup-atlas.sh').chmod(0o700)


def finalize_install(root, assets, chart, manifest, images):
    install_runtime_tools(root, assets)
    if chart != root / 'chart':
        shutil.copytree(chart, root / 'chart', dirs_exist_ok=True)
    write(root / 'release-manifest.json', {**manifest, 'resolvedImages': images})
    for action in ('status', 'restart', 'stop', 'start', 'verify'):
        import shlex
        script = root / (action + '.sh')
        script.write_text('#!/usr/bin/env bash\nset -euo pipefail\nexec python3 ' + shlex.quote(str(root / 'atlas.py')) + ' ' + action + ' --root ' + shlex.quote(str(root)) + '\n')
        script.chmod(0o755)
    credentials = json.loads((root / 'credentials.json').read_text())
    gateway = json.loads((root / 'values.json').read_text())['gateway']
    (root / 'admin-credentials.txt').write_text('WebUI: ' + gateway['webuiOrigin'] + '\nMoss Admin: ' + gateway['mossOrigin'] + '/admin/\nUsername: '
        + credentials['adminUsername'] + '\nPassword: ' + credentials['adminPassword'] + '\n')
    for action in ('backup', 'restore'):
        script = root / (action + '.sh')
        script.write_text('#!/usr/bin/env bash\nset -euo pipefail\nexec python3 ' + shlex.quote(str(root / 'snapshot.py')) + ' ' + action + ' --root ' + shlex.quote(str(root)) + ' "$@"\n')
        script.chmod(0o755)
    report(root)


def qualify(root):
    before = root / 'acceptance/webui-before.json'
    evidence = [json.loads(p.read_text()) for p in (before, root / 'acceptance/webui-after.json') if p.exists()]
    has_router = 'router' in json.loads((root / 'values.json').read_text())['images']
    if not before.exists() or (has_router and not any(item.get('router') for item in evidence)):
        command = ['python3', str(root / 'smoke.py'), '--root', str(root)]
        if before.exists():
            command.append('--resume')
        run(*command)
        report(root)


def print_access_info(root):
    values = json.loads((root / 'values.json').read_text())
    installed = json.loads((root / 'release-manifest.json').read_text())
    credentials = json.loads((root / 'credentials.json').read_text())
    gateway = values['gateway']
    admin = credentials['adminUsername']
    items = [
        ('SudoWork WebUI', gateway['webuiOrigin'], admin, str(root / 'admin-credentials.txt')),
        ('Moss 管理后台', gateway['mossOrigin'] + '/admin/', admin, str(root / 'admin-credentials.txt')),
    ]
    if 'router' in values['images']:
        router_credentials = json.loads((root / 'router-credentials.json').read_text())
        items.append(('SudoRouter', gateway['routerOrigin'], router_credentials['adminUsername'],
                      str(root / 'router-admin-credentials.txt')))
    items += [
        ('Sudocode / Moss Runtime', '从 SudoWork 创建会话', '使用 WebUI 登录身份', '无独立登录密码'),
        ('Nexus broker', 'nexus-broker.atlas-system.svc.cluster.local:2126（集群内 mTLS）',
         'Moss agent 证书身份', 'Kubernetes Secret: atlas-system/atlas-nexus-client'),
        ('Vault', 'Nexus / Runtime 内嵌插件，无独立 Web 入口', '随 Nexus 身份授权', '无独立登录密码'),
        ('PostgreSQL', 'webui-postgres.atlas-system.svc.cluster.local:5432 / sudowork_webui（集群内）',
         'atlas', str(root / 'credentials.json') + ' 的 postgresPassword；Secret: atlas-system/atlas-postgres'),
        ('Caddy', '上述 HTTPS 入口的网关', '无独立登录用户', 'TLS 文件：' + str(root / 'tls')),
        ('k3s / kubectl', '本机 sudo k3s kubectl', 'kubeconfig 中的证书身份', '/etc/rancher/k3s/k3s.yaml'),
        ('gVisor', '集群 RuntimeClass: gvisor', '无独立登录用户', '无独立登录密码'),
        ('Helm', '本机 helm；使用 k3s kubeconfig', 'kubeconfig 中的证书身份', '/etc/rancher/k3s/k3s.yaml'),
        ('Node.js（Nexus 基础镜像）', 'Nexus 镜像内运行环境', '无独立登录用户', '无独立登录密码'),
    ]
    info = {'release': installed['release'], 'architecture': installed['architecture'],
            'components': [dict(zip(('component', 'address', 'username', 'credentialsLocation'), item)) for item in items],
            'caCertificate': str(root / 'tls/ca.crt')}
    write(root / 'access-info.json', info)
    lines = [f'套件：{installed["release"]}（{installed["architecture"]}）', '组件访问与凭据位置：']
    for name, address, username, location in items:
        lines += [f'  {name}: {address}', f'    用户：{username}；密码/凭据位置：{location}']
    lines += [f'浏览器测试 CA：{root / "tls/ca.crt"}',
              f'凭据文件仅 root 可读；本摘要不包含密码。摘要：{root / "access-info.txt"}',
              f'状态：sudo {root / "status.sh"}；验证：sudo {root / "verify.sh"}',
              '实际模型调用需在 SudoRouter 配置上游渠道和 API Key。' if 'router' in values['images'] else '']
    text = '\n'.join(lines).rstrip() + '\n'
    summary = root / 'access-info.txt'
    summary.write_text(text)
    summary.chmod(0o600)
    print(text, end='', flush=True)

def report(root):
    values = json.loads((root / 'values.json').read_text())
    endpoints = [(values['gateway']['mossOrigin'], '/readyz'), (values['gateway']['webuiOrigin'], '/health/live')]
    expected = {'moss-server', 'nexus-broker', 'sudowork-webui', 'webui-postgres', 'atlas-gateway'}
    router_status = None
    if 'router' in values['images']:
        import router
        endpoints.append((values['gateway']['routerOrigin'], '/api/status'))
        expected.add('sudorouter')
        router_status = router.status(root)
    for base, path in endpoints:
        with gateway_open(root, base + path) as response:
            if response.status != 200:
                raise RuntimeError('Gateway health check failed')
    deployments = json.loads(kube('-n', NAMESPACE, 'get', 'deployments', '-o', 'json'))['items']
    summary = {d['metadata']['name']: d.get('status', {}).get('readyReplicas', 0) for d in deployments}
    if set(summary) != expected or any(count != 1 for count in summary.values()):
        raise RuntimeError('Not all application Deployments are ready')
    installed = json.loads((root / 'release-manifest.json').read_text())
    write(root / 'deployment-report.json', {'status': 'ready', 'release': installed['release'], 'namespace': NAMESPACE,
        'components': installed.get('components', {}),
        'deployments': summary, 'images': values['images'], 'gateway': values['gateway'], 'router': router_status,
        'gatewayCaSha256': checksum(root / 'tls/ca.crt'), 'runtimeClass': 'gvisor',
        'acceptance': {name: json.loads((root / 'acceptance' / name).read_text()) for name in ('webui-before.json', 'webui-after.json', 'restore.json') if (root / 'acceptance' / name).exists()},
        'productionCertification': 'pending: Ubuntu 24.04 clean-host qualification, signing/provenance and version-upgrade rollback qualification'})
    print(str(len(expected)) + ' Deployments ready; report: ' + str(root / 'deployment-report.json'), flush=True)

def manage(args):
    root = args.root.resolve()
    if args.action == 'verify':
        report(root)
        print_access_info(root)
        return
    if args.action == 'status':
        print(kube('-n', NAMESPACE, 'get', 'deployment,pods,pvc,job', '-o', 'wide'))
        return
    if args.action in ('stop', 'restart'):
        applications = ['sudowork-webui', 'moss-server', 'nexus-broker', 'atlas-gateway']
        if 'router' in json.loads((root / 'values.json').read_text())['images']:
            applications.append('sudorouter')
        for name in applications:
            kube('-n', NAMESPACE, 'scale', 'deployment/' + name, '--replicas=0')
        kube('-n', NAMESPACE, 'wait', '--for=delete', 'pods', '-l', 'app in (atlas-webui-server,atlas-moss,atlas-nexus,atlas-gateway,atlas-router)', '--timeout=180s')
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
    parser.add_argument('--add-router', action='store_true', help='Add SudoRouter to the exact pinned base release without changing existing components')
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
