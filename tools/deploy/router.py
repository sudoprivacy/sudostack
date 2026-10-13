"""Provision the pinned SudoRouter through its API; keep credentials on the node."""
import json
from pathlib import Path
import secrets
import re
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.request

import atlas

MODEL_URL = 'http://sudorouter.atlas-system.svc.cluster.local:3000/v1'


def wait_upstream(url):
    """Pod readiness precedes Service forwarding; check from the actual caller."""
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        result = subprocess.run(['k3s', 'kubectl', '-n', atlas.NAMESPACE, 'exec',
            'deployment/sudorouter', '--', 'wget', '--no-proxy', '-q', '-O', '/dev/null',
            '--timeout=3', '--tries=1', url + '/healthz'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if result.returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError('Temporary upstream is not reachable from SudoRouter through its Service')


class RouterClient:
    """Use a loopback-only Kubernetes tunnel before exposing the admin gateway."""
    def __init__(self, root):
        self.root = root
        self.headers = {'Content-Type': 'application/json'}
        self.process = None
        self.log = None

    def __enter__(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        self.base = 'http://127.0.0.1:' + str(port)
        self.log = (self.root / 'router-forward.log').open('a')
        self.process = subprocess.Popen(['k3s', 'kubectl', '-n', atlas.NAMESPACE, 'port-forward',
            '--address', '127.0.0.1', 'service/sudorouter', str(port) + ':3000'], stdout=self.log, stderr=self.log)
        for _ in range(60):
            if self.process.poll() is not None:
                break
            try:
                self.request('/api/status')
                return self
            except (OSError, ValueError, RuntimeError):
                time.sleep(.5)
        self.__exit__(None, None, None)
        raise RuntimeError('SudoRouter API tunnel did not become ready')

    def __exit__(self, *unused):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.log:
            self.log.close()

    def request(self, path, body=None, method=None, bearer=None):
        headers = {**self.headers}
        if bearer is not None:
            headers['Authorization'] = 'Bearer ' + bearer
        request = urllib.request.Request(self.base + path, headers=headers,
            data=None if body is None else json.dumps(body).encode(), method=method)
        # A local tunnel must not be sent to an environment-configured proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=30) as response:
                value = json.load(response)
        except urllib.error.HTTPError as error:
            details = []
            try:
                body = json.loads(error.read(65536))
                for field in ('code', 'type'):
                    candidate = body.get('error', {}).get(field, '')
                    if isinstance(candidate, str) and re.fullmatch(r'[a-zA-Z0-9_.-]{1,80}', candidate):
                        details.append(field + '=' + candidate)
            except (ValueError, AttributeError):
                pass
            suffix = ' (' + ', '.join(details) + ')' if details else ''
            raise RuntimeError('SudoRouter ' + path + ': HTTP ' + str(error.code) + suffix) from None
        if value.get('success') is False:
            raise RuntimeError('SudoRouter API rejected ' + path)
        return value

    def login(self):
        credentials = json.loads((self.root / 'router-credentials.json').read_text())
        data = self.request('/api/user/login', {'username': credentials['adminUsername'],
            'password': credentials['adminPassword']})['data']
        self.headers['Authorization'] = 'Bearer ' + data['access_token']


def credentials(root):
    path = root / 'router-credentials.json'
    if path.exists():
        return json.loads(path.read_text())
    value = {'adminUsername': 'admin', 'adminPassword': secrets.token_urlsafe(24),
             'sessionSecret': secrets.token_hex(32)}
    atlas.write(path, value)
    return value


def moss_settings(root, patch=None):
    values = json.loads((root / 'values.json').read_text())
    creds = json.loads((root / 'credentials.json').read_text())
    base = values['gateway']['mossOrigin']
    context = ssl.create_default_context(cafile=str(root / 'tls/ca.crt'))
    request = urllib.request.Request(base + '/api/v1/auth/login', headers={'Content-Type': 'application/json'},
        data=json.dumps({'grant_type': 'password', 'username': creds['adminUsername'], 'password': creds['adminPassword']}).encode())
    with urllib.request.urlopen(request, context=context, timeout=30) as response:
        token = json.load(response)['access_token']
    request = urllib.request.Request(base + '/api/v1/settings/system?scope=organization',
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
        data=None if patch is None else json.dumps(patch).encode(), method='GET' if patch is None else 'PATCH')
    with urllib.request.urlopen(request, context=context, timeout=30) as response:
        return json.load(response)


def assert_moss_configuration(root):
    settings = moss_settings(root)
    configured = any(settings.get(k) for k in ('apiKey', 'hasApiKey', 'apiKeyConfigured'))
    if configured and (settings.get('url') != MODEL_URL or not (root / 'router-credentials.json').exists()):
        raise ValueError('Moss already has model credentials; preserve them and configure SudoRouter explicitly')


def provision(root, version):
    value = credentials(root)
    with RouterClient(root) as client:
        if client.request('/api/status')['data']['version'] != version:
            raise ValueError('The running SudoRouter version differs from the release lock')
        setup = client.request('/api/setup')['data']
        if not setup['status']:
            if setup.get('root_init'):
                raise ValueError('SudoRouter has an existing administrator but incomplete setup')
            client.request('/api/setup', {'username': value['adminUsername'], 'password': value['adminPassword'],
                'confirmPassword': value['adminPassword'], 'SelfUseModeEnabled': True, 'DemoSiteEnabled': False})
        client.login()
        if 'relayKey' not in value:
            tokens = client.request('/api/token/?p=1&page_size=100')['data']['items']
            matches = [token for token in tokens if token['name'] == 'sudostack-moss']
            if len(matches) > 1:
                raise ValueError('Ambiguous SudoRouter Moss token')
            if not matches:
                token = client.request('/api/token/', {'name': 'sudostack-moss', 'expired_time': -1,
                    'unlimited_quota': True, 'group': 'default'})['data']
            else:
                token = matches[0]
            value['relayTokenId'] = token['id']
            raw = client.request('/api/token/' + str(token['id']) + '/key', {}, 'POST')['data']['key']
            value['relayKey'] = raw if raw.startswith('sk-') else 'sk-' + raw
            atlas.write(root / 'router-credentials.json', value)
        client.request('/v1/models', bearer=value['relayKey'])
    origin = json.loads((root / 'values.json').read_text())['gateway']['routerOrigin']
    path = root / 'router-admin-credentials.txt'
    path.write_text('SudoRouter: ' + origin + '\nUsername: ' + value['adminUsername'] + '\nPassword: ' + value['adminPassword'] + '\n')
    path.chmod(0o600)


def configure_moss(root):
    assert_moss_configuration(root)
    value = credentials(root)
    moss_settings(root, {'url': MODEL_URL, 'apiKey': value['relayKey']})


def status(root):
    settings = moss_settings(root)
    configured = settings.get('url') == MODEL_URL and settings.get('apiKeyConfigured') is True
    if not configured:
        raise RuntimeError('Moss is not configured to use the installed SudoRouter')
    return {'modelUrl': MODEL_URL, 'mossConfigured': True, 'upstreamConfiguration': 'customer-managed'}
