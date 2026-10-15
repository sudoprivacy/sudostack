import unittest

from diagnostics import redact


class DiagnosticsTests(unittest.TestCase):
    def test_service_failure_preserved_without_credentials(self):
        log = '''[coordinator] send failed: POST /api/v1/sessions/abcd/resume: 503 ATTEMPT_TAKEOVER_PENDING
Authorization: Bearer eyExample.jwt.signature
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
                       'another-password', 'configured-key', 'private-key-material'):
            self.assertNotIn(secret, result)


if __name__ == '__main__':
    unittest.main()
