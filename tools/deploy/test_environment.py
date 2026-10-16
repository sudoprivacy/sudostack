"""Exercise real port/TLS failures and the credential-free completion summary."""
import contextlib
import errno
import http.server
import io
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import atlas


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_real_listening_socket_is_detected_without_stopping_it(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(ValueError, 'ports already in use: ' + str(port)):
                atlas.preflight_gateway_ports([port])
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass

    def test_ipv4_only_host_can_pass_the_port_check(self):
        create_socket = socket.socket
        def ipv4_only(family, kind):
            if family == socket.AF_INET6:
                raise OSError(errno.EAFNOSUPPORT, 'IPv6 disabled')
            return create_socket(family, kind)
        with patch.object(atlas.socket, 'socket', side_effect=ipv4_only):
            atlas.preflight_gateway_ports([0])

    def test_port_conflict_precedes_install_root_and_k3s_mutations(self):
        assets, chart = self.root / 'assets', self.root / 'chart'
        assets.mkdir()
        chart.mkdir()
        (chart / 'Chart.yaml').write_text('name: atlas-mvp')
        (assets / 'atlas-release.json').write_text('{"architecture":"arm64","components":{"router":{}}}')
        args = SimpleNamespace(root=self.root / 'installation', assets=assets, chart=chart)
        with patch.object(atlas, 'validate_host', return_value='arm64'), \
             patch.object(atlas, 'preflight_existing_cluster'), \
             patch.object(atlas, 'preflight_gateway_ports', side_effect=ValueError('ports already in use')), \
             patch.object(atlas, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'ports already in use'):
                atlas.install(args)
            run.assert_not_called()
        self.assertFalse(args.root.exists())

    def test_stopped_but_installed_agent_still_requires_detach(self):
        with patch.object(atlas.shutil, 'which', side_effect=lambda name: '/usr/local/bin/k3s-agent-uninstall.sh'
                          if name == 'k3s-agent-uninstall.sh' else None):
            with self.assertRaisesRegex(ValueError, 'still installed'):
                atlas.preflight_existing_cluster()

    def test_https_ignores_proxy_but_rejects_wrong_certificate_hostname(self):
        tls = self.root / 'tls'
        tls.mkdir()
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
                        '-keyout', str(tls / 'key.pem'), '-out', str(tls / 'ca.crt')],
                       check=True, capture_output=True)
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'ready')
            def log_message(self, *args):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(tls / 'ca.crt', tls / 'key.pem')
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict(os.environ, {'HTTPS_PROXY': 'http://127.0.0.1:1', 'https_proxy': 'http://127.0.0.1:1',
                                         'NO_PROXY': '', 'no_proxy': ''}):
                with atlas.gateway_open(self.root, f'https://127.0.0.1:{server.server_port}/readyz') as response:
                    self.assertEqual(response.read(), b'ready')
                with self.assertRaisesRegex(RuntimeError, 'Gateway TLS verification failed.*localhost'):
                    atlas.gateway_open(self.root, f'https://localhost:{server.server_port}/readyz')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_completion_summary_uses_actual_users_and_never_prints_secrets(self):
        values = {'gateway': {'webuiOrigin': 'https://example.test', 'mossOrigin': 'https://example.test:8443',
                              'routerOrigin': 'https://example.test:9443'}, 'images': {'router': 'router:test'}}
        fixtures = {'values.json': values, 'release-manifest.json': {'release': 'sudostack-v1.2.3', 'architecture': 'arm64'},
                    'credentials.json': {'adminUsername': 'owner', 'adminPassword': 'must-not-print-admin',
                                         'postgresPassword': 'must-not-print-postgres'},
                    'router-credentials.json': {'adminUsername': 'router-owner', 'adminPassword': 'must-not-print-router'}}
        for name, value in fixtures.items():
            (self.root / name).write_text(json.dumps(value))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            atlas.print_access_info(self.root)
        printed = output.getvalue()
        self.assertIn('https://example.test:8443/admin/', printed)
        self.assertIn('用户：owner', printed)
        self.assertIn('用户：router-owner', printed)
        self.assertIn(str(self.root / 'router-admin-credentials.txt'), printed)
        self.assertIn('postgresPassword', printed)
        for name in ('access-info.txt', 'access-info.json'):
            self.assertNotIn('must-not-print-', (self.root / name).read_text())
            self.assertEqual((self.root / name).stat().st_mode & 0o777, 0o600)
        self.assertNotIn('must-not-print-', printed)
        self.assertEqual(len(json.loads((self.root / 'access-info.json').read_text())['components']), 12)


if __name__ == '__main__':
    unittest.main()
