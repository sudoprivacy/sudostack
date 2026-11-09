"""Exercise control authentication, encrypted-store references and secret-safe failures."""
import io
import json
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

from moss_control import MossControl


class MossControlTests(unittest.TestCase):
    def setUp(self):
        self.received = []
        self.org = 'org-a'
        self.secret = {'value': 'private-upstream-key', 'status': 'enabled', 'version': 1}
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_unused):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                outer.received.append((self.path, body))
                self.reply({'access_token': 'private-session', 'organization': {'id': outer.org}})

            def do_GET(self):
                outer.received.append((self.path, self.headers.get('Authorization')))
                if self.path.endswith('/redirect'):
                    self.send_response(302)
                    self.send_header('Location', '/api/v1/secrets/system%3Arouter/leaked')
                    self.end_headers()
                else:
                    self.reply({'success': True, 'data': outer.secret})

            def reply(self, value):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(value).encode())

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)
        self.client = MossControl('http://127.0.0.1:' + str(self.server.server_port))

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def login(self):
        self.client.login({'username': 'admin', 'password': 'private-password'}, 'org-a')

    def test_org_pinned_login_and_existing_audited_secret_endpoint(self):
        self.login()
        self.assertEqual(self.client.secret('system:router', 'upstream/key'), 'private-upstream-key')
        self.assertEqual(self.received[1],
            ('/api/v1/secrets/system%3Arouter/upstream%2Fkey', 'Bearer private-session'))

    def test_wrong_org_never_installs_token_or_reads_secret(self):
        self.org = 'org-b'
        with self.assertRaisesRegex(RuntimeError, 'intended organization'):
            self.login()
        self.assertIsNone(self.client.token)
        self.assertEqual(len(self.received), 1)

    def test_missing_disabled_or_malformed_secret_does_not_fall_back(self):
        self.login()
        for data in [None, {}, {'value': 'private-upstream-key', 'status': 'disabled'},
                     {'value': '', 'status': 'enabled'}, {'value': 123, 'status': 'enabled'}]:
            self.secret = data
            with self.subTest(data=data), self.assertRaises(RuntimeError) as error:
                self.client.secret('system:router', 'key')
            self.assertNotIn('private-upstream-key', str(error.exception))

    def test_redirect_does_not_forward_bearer_or_repeat_request(self):
        self.login()
        with self.assertRaisesRegex(RuntimeError, 'HTTP 302'):
            self.client.secret('system:router', 'redirect')
        self.assertEqual(len(self.received), 2)

    def test_unsafe_origin_and_cross_org_reference_refused(self):
        for origin in ['http://example.com', 'http://localhost:1234', 'https://user:password@example.com',
                       'https://example.com/api', 'https://example.com?key=private']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                MossControl(origin)
        self.login()
        with self.assertRaises(ValueError):
            self.client.secret('org:another:system:router', 'key')

    def test_error_body_never_exposed(self):
        class Opener:
            def open(self, request, timeout):
                raise urllib.error.HTTPError(request.full_url, 503, 'private-password', {},
                    io.BytesIO(b'private-upstream-key'))
        client = MossControl('https://example.com', opener=Opener())
        with self.assertRaisesRegex(RuntimeError, '^Moss control request failed: HTTP 503$'):
            client.request('/api/v1/auth/login', {'password': 'private-password'})


if __name__ == '__main__':
    unittest.main()
