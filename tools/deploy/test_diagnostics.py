import base64
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from diagnostics import collect, redact


class DiagnosticsTests(unittest.TestCase):
    def test_service_failure_preserved_without_credentials(self):
        log = '''[coordinator] send failed: POST /api/v1/sessions/abcd/resume: 503 ATTEMPT_TAKEOVER_PENDING
Authorization: Bearer eyExample.jwt.signature
Set-Cookie: moss_session=derived-session-cookie; HttpOnly; Secure
url=wss://moss/ws?access_token=dynamic-token&session=abcd
postgres://atlas:db-password@postgres/atlas
{"apiKey":"generated-key","password":"another-password"}
configured-key
-----BEGIN PRIVATE KEY-----
private-key-material
-----END PRIVATE KEY-----'''
        result = redact(log, ['configured-key'])
        self.assertIn('503 ATTEMPT_TAKEOVER_PENDING', result)
        for secret in ('eyExample', 'dynamic-token', 'db-password', 'generated-key',
                       'another-password', 'configured-key', 'private-key-material',
                       'derived-session-cookie'):
            self.assertNotIn(secret, result)

    def test_failed_runtime_probe_is_redacted_and_cannot_report_success(self):
        credential = 'diagnostics-fixture-credential'

        def command(*args, **kwargs):
            if 'secrets' in args:
                return json.dumps({'items': [{'data': {'password': base64.b64encode(credential.encode()).decode()}}]})
            if 'pods' in args:
                return '{"items": []}'
            raise RuntimeError('SQL probe failed with ' + credential)

        with tempfile.TemporaryDirectory() as directory, patch('diagnostics.kube', side_effect=command):
            with self.assertRaisesRegex(RuntimeError, 'Moss recovery diagnostics failed'):
                collect(Path(directory))
            result = (Path(directory) / 'moss-runtime-state.log').read_text()
            self.assertIn('SQL probe failed', result)
            self.assertNotIn(credential, result)


if __name__ == '__main__':
    unittest.main()
