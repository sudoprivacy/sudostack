#!/usr/bin/env python3
"""Exercise the existing egress service through real managed ACP sessions.

Uses a caller-supplied released nexusd-cohost binary, isolated mTLS data and
owned transient units. Model and analyzer fault endpoints are loopback fixtures;
this proves session propagation and upstream suppression, not model quality.
"""
import hashlib
import http.server
import json
import os
import pathlib
import secrets
import socket
import subprocess
import tempfile
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    binary = pathlib.Path(os.environ['GATE_BIN']).resolve(strict=True)
    proto = pathlib.Path(os.environ['NEXUS_PROTO_ROOT']).resolve(strict=True)
    modules = pathlib.Path(os.environ['NODE_MODULES']).resolve(strict=True)
    root = pathlib.Path(os.environ.get('WORK', tempfile.gettempdir() + '/managed-egress-' + secrets.token_hex(8)))
    root.mkdir(parents=True, exist_ok=False)
    captures = []

    class Fixture(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            if self.path == '/analyze':
                response, content_type = b'[{"entity_type":"PERSON","start":-1,"end":99999999,"score":1}]', 'application/json'
            else:
                captures.append({'scenario': self.server.scenario, 'body': json.loads(body)})
                message = {'id': 'managed-fixture', 'type': 'message', 'role': 'assistant', 'model': 'managed-fixture', 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 10, 'output_tokens': 0}}
                events = [('message_start', {'type': 'message_start', 'message': message}),
                          ('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}}),
                          ('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'MANAGED_GATE_OK'}}),
                          ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
                          ('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 4}}),
                          ('message_stop', {'type': 'message_stop'})]
                response = ''.join('event: ' + name + '\ndata: ' + json.dumps(value) + '\n\n' for name, value in events).encode()
                content_type = 'text/event-stream'
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    units = []
    rows = []
    try:
        for scenario in ['clean', 'redact', 'deny', 'outage', 'malformed']:
            work = root / scenario
            for name in ['data', 'id', 'config']:
                (work / name).mkdir(parents=True)
            (work / 'node_modules').symlink_to(modules, target_is_directory=True)
            (work / 'drive.mjs').write_bytes((HERE / 'managed-session.mjs').read_bytes())
            config = {'auth_modes': {'api-key': {'anthropic': {'baseUrl': 'nexus:///cloud-model'}}}, 'models': {
                'managed-fixture': {'alias': 'managed-fixture', 'name': 'Synthetic acceptance', 'input': ['text'], 'providers': {'api-key': {'provider': 'anthropic', 'model': 'managed-fixture'}}}}}
            (work / 'config/sudocode.json').write_text(json.dumps(config))
            port = free_port()
            unit = 'dlp-managed-' + secrets.token_hex(10) + '-' + scenario
            args = ['systemd-run', '--user', '--quiet', '--unit=' + unit, '-p', 'MemoryMax=4G',
                    '-p', 'StandardOutput=append:' + str(work / 'daemon.log'), '-p', 'StandardError=append:' + str(work / 'daemon.log')]
            settings = {'NEXUS_DATA_DIR': str(work / 'data'), 'NEXUS_IDENTITY_DIR': str(work / 'id'),
                        'SUDO_CODE_CONFIG_HOME': str(work / 'config'), 'NEXUS_EGRESS_GATE_MODEL_MOUNTS': '/cloud-model',
                        'NEXUS_EGRESS_GATE_POLICY': 'deny' if scenario == 'deny' else 'redact', 'RUST_LOG': 'info'}
            if scenario in ['outage', 'malformed']:
                settings['NEXUS_EGRESS_GATE_PRESIDIO_URL'] = 'http://127.0.0.1:' + str(free_port() if scenario == 'outage' else server.server_port)
                settings['NEXUS_EGRESS_GATE_PRESIDIO_TIMEOUT_MS'] = '1000'
            args += ['--setenv=' + key + '=' + value for key, value in settings.items()]
            args += [str(binary), '--cluster-init', 'managed-' + scenario, '--hostname', socket.gethostname(), '--bind-addr', '127.0.0.1:' + str(port), '--advertise-addr', '127.0.0.1:' + str(port)]
            subprocess.run(args, check=True)
            # Only a successful create gives this runner cleanup ownership.
            units.append(unit)
            for _ in range(90):
                if (work / 'data/tls/node.pem').exists():
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=1):
                            break
                    except OSError:
                        pass
                time.sleep(.5)
            else:
                raise RuntimeError('Managed acceptance daemon not ready: ' + scenario)
            server.scenario = scenario
            result = subprocess.run([os.environ.get('NODE', 'node'), str(work / 'drive.mjs'), str(work), str(proto),
                                     '127.0.0.1:' + str(port), 'http://127.0.0.1:' + str(server.server_port), scenario], capture_output=True, text=True, timeout=150)
            (work / 'drive.log').write_text(result.stdout + result.stderr)
            if result.returncode:
                raise RuntimeError('Managed session failed; inspect ' + str(work / 'drive.log'))
            hits = [item for item in captures if item['scenario'] == scenario]
            assert len(hits) == (1 if scenario in ['clean', 'redact'] else 0), 'Unexpected upstream request count'
            if hits:
                encoded = json.dumps(hits)
                assert 'AbCdEfGhIjKlMnOpQrStUvWxYz012345' not in encoded, 'Credential escaped gate'
                if scenario == 'redact':
                    assert 'REDACTED' in encoded, 'Redaction did not reach upstream'
            row = json.loads((work / 'client.json').read_text())
            row['upstream_requests'] = len(hits)
            rows.append(row)
            print(json.dumps(row), flush=True)
            subprocess.run(['systemctl', '--user', 'stop', unit], check=True)
        report = {'passed': True, 'scope': 'managed_session_content_gate', 'upstream': 'synthetic_loopback',
                  'daemon_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(), 'cases': rows}
        (root / 'acceptance.json').write_text(json.dumps(report, indent=2))
        (root / 'synthetic-wire.json').write_text(json.dumps(captures, indent=2))
        print(json.dumps({'evidence': str(root / 'acceptance.json'), **report}), flush=True)
    finally:
        for unit in units:
            subprocess.run(['systemctl', '--user', 'stop', unit], capture_output=True)
            subprocess.run(['systemctl', '--user', 'reset-failed', unit], capture_output=True)
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
