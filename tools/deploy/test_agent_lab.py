import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import agent_lab as lab
from agent_candidate import COMPONENTS


class AgentLabTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / 'lab'
        self.router = self.root / 'router.json'
        self.router.write_text(json.dumps({'unrelated_personal_secret': 'DO_NOT_COPY',
            'auth_modes': {'proxy': {'sudorouter': {'baseUrl': 'https://router.example.test/v1', 'apiKey': 'ROUTER_SECRET'}}}}))
        self.image_id = 'sha256:' + 'a' * 64
        self.pg = 'postgres:16@sha256:' + 'b' * 64
        self.manifest = {'candidate_lock_sha256': 'c' * 64, 'images': {
            name: {'image': 'candidate/' + name, 'image_config_digest': self.image_id, 'architecture': 'amd64'}
            for name in COMPONENTS}}

    def prepare(self):
        lab.prepare(self.root, self.out, self.router, 'synthetic-model', self.pg)

    def test_missing_or_changed_candidate_cannot_generate_deployment(self):
        with patch.object(lab, 'assemble', side_effect=ValueError('changed archive')):
            with self.assertRaisesRegex(ValueError, 'changed archive'):
                self.prepare()
        self.assertFalse(self.out.exists())
        with patch.object(lab, 'assemble', return_value=self.manifest), patch.object(lab, 'local_image', return_value='sha256:' + 'd' * 64):
            with self.assertRaisesRegex(ValueError, 'verified candidate'):
                self.prepare()
        self.assertFalse(self.out.exists())

    def test_fresh_private_configuration_never_copies_other_credentials_or_publishes_internal_ports(self):
        with patch.object(lab, 'assemble', return_value=self.manifest), patch.object(lab, 'local_image', return_value=self.image_id):
            self.prepare()
        compose = json.loads((self.out / 'compose.json').read_text())
        for name, service in compose['services'].items():
            self.assertEqual(service['image'], self.image_id)
            self.assertEqual(service['pull_policy'], 'never')
            for port in service.get('ports', []):
                self.assertTrue(port.startswith('127.0.0.1:'))
            if name != 'runtime':
                self.assertNotIn('ports', service)
        self.assertNotEqual(compose['services']['provider']['user'], '0:0')
        self.assertNotEqual(compose['services']['registry']['user'], '0:0')
        self.assertEqual(compose['services']['provider']['cap_drop'], ['ALL'])
        self.assertNotIn('docker.sock', json.dumps(compose))
        for path in self.out.rglob('*'):
            if path.is_file():
                self.assertNotIn('DO_NOT_COPY', path.read_text())
        for name in ('provider/secrets/router.json', 'moss/config/server.json', 'registry/secrets/signing.pem', 'admin-login.json', 'webui/runtime.env'):
            self.assertEqual((self.out / name).stat().st_mode & 0o777, 0o600)
        for name in ('lab-inputs.json', 'compose.json'):
            self.assertNotIn('ROUTER_SECRET', (self.out / name).read_text())
        private = (self.out / 'registry/secrets/signing.pem').read_bytes()
        with self.assertRaisesRegex(ValueError, 'never overwritten'):
            self.prepare()
        self.assertEqual((self.out / 'registry/secrets/signing.pem').read_bytes(), private)

    def test_root_preparation_assigns_private_registry_files_to_runtime_user(self):
        with patch.object(lab, 'assemble', return_value=self.manifest), patch.object(lab, 'local_image', return_value=self.image_id), patch.object(lab.os, 'getuid', return_value=0), patch.object(lab.os, 'geteuid', return_value=0), patch.object(lab.os, 'chown') as chown:
            self.prepare()
        compose = json.loads((self.out / 'compose.json').read_text())
        self.assertEqual(compose['services']['registry']['user'], '1000:1000')
        for path in [self.out / 'registry', *(self.out / 'registry').rglob('*')]:
            chown.assert_any_call(path, 1000, 1000)
            self.assertEqual(path.stat().st_mode & 0o777, 0o700 if path.is_dir() else 0o600)

    def test_scope_binding_requires_explicit_valid_id_and_cannot_remap(self):
        path = self.out / 'moss/config/registry.json'
        path.parent.mkdir(parents=True)
        lab.write(path, {'organizations': {'lab-bootstrap-pending': {'zoneId': 'zone-1', 'trustDomain': 'agents.lab.sudo'}}})
        for value in ('', '../wrong', 'lab-bootstrap-pending', 'org\nother'):
            with self.assertRaises(ValueError):
                lab.bind_organization(self.out, value)
        lab.bind_organization(self.out, 'actual-org-123')
        self.assertEqual(set(json.loads(path.read_text())['organizations']), {'actual-org-123'})
        with self.assertRaisesRegex(ValueError, 'remapping'):
            lab.bind_organization(self.out, 'other-org')

    def test_router_credentials_require_a_fixed_tls_endpoint(self):
        self.assertEqual(set(lab.router_credential(self.router)), {'baseUrl', 'apiKey'})
        for url in ('http://router.test/v1', 'https://user:pass@router.test/v1', 'https://router.test/v1?key=secret', 'https://router.test/v1#fragment'):
            self.router.write_text(json.dumps({'auth_modes': {'proxy': {'sudorouter': {'baseUrl': url, 'apiKey': 'SECRET_VALUE'}}}}))
            with self.assertRaisesRegex(ValueError, '^Invalid Router credential configuration$'):
                lab.router_credential(self.router)


if __name__ == '__main__':
    unittest.main()
