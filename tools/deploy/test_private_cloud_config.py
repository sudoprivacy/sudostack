"""Exercise the Cloud-to-native handoff without credentials or network access."""
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from private_cloud_config import MAX_PROJECTION_BYTES, configuration, install_configuration, read_projection


class CloudConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            'execution': {'isLocalAllowed': True},
            'localRuntime': {'status': 'ready', 'userId': 'member-fixture',
                             'organizationId': 'org-fixture', 'protocol': 'openai-completions'},
            'sudorouter_key': 'fixture-model-secret', 'model_service_url': 'https://models.invalid/v1',
            'models': ['claude-fixture', 'gpt-fixture'], 'scode_auto_model': 'claude-fixture',
        }
        self.owner = {'user_id': 'member-fixture', 'organization_id': 'org-fixture'}

    def config(self, payload=None):
        return configuration(self.payload if payload is None else payload, **self.owner)

    def test_existing_projection_produces_wizard_account_without_human_token(self):
        self.payload['access_token'] = 'fixture-human-secret'
        files = read_projection(io.BytesIO(json.dumps(self.payload).encode()), **self.owner)
        self.assertEqual(files['sudocode.json'], {'auth_modes': {'proxy': {'sudorouter': {
            'baseUrl': 'https://models.invalid/v1', 'apiKey': 'fixture-model-secret'}}}})
        self.assertEqual(files['settings.json'], {'auth_profile': 'sudorouter', 'model': 'claude-fixture'})
        self.assertNotIn('fixture-human-secret', json.dumps(files))
        self.assertNotIn('models', files['sudocode.json'])

    def test_grants_and_current_account_cannot_be_inferred_from_present_key(self):
        for section, field, value in (
                ('execution', 'isLocalAllowed', False), ('execution', 'isLocalAllowed', 1),
                ('localRuntime', 'status', 'policy_denied'), ('localRuntime', 'status', 'credential_pending'),
                ('localRuntime', 'userId', 'another-member'), ('localRuntime', 'organizationId', 'another-org')):
            candidate = copy.deepcopy(self.payload)
            candidate[section][field] = value
            with self.subTest(section=section, field=field, value=value), self.assertRaises(ValueError) as error:
                self.config(candidate)
            self.assertNotIn('fixture-model-secret', str(error.exception))

    def test_no_fallback_model_or_untrusted_endpoint(self):
        for field, values in {
            'scode_auto_model': [None, '', 'not-in-catalogue'],
            'models': [[], 'claude-fixture', ['claude-fixture', None]],
            'model_service_url': ['http://models.invalid/v1', 'https://user:secret@models.invalid/v1',
                                  'https://models.invalid/v1?key=secret', 'https://models.invalid/v1#secret',
                                  'https://models.invalid/v1/messages', 'https://models.invalid:bad/v1',
                                  'https://models.invalid\\@another.invalid/v1'],
            'sudorouter_key': ['', 'white space', 'line\nbreak'],
        }.items():
            for value in values:
                candidate = copy.deepcopy(self.payload)
                candidate[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.config(candidate)

    def test_bounded_parser_never_echoes_rejected_document(self):
        for raw in (b'fixture-private-input', b'\xff', b'x' * (MAX_PROJECTION_BYTES + 1)):
            with self.subTest(size=len(raw)), self.assertRaises(ValueError) as error:
                read_projection(io.BytesIO(raw), **self.owner)
            self.assertNotIn('fixture-private-input', str(error.exception))

    def test_first_configuration_is_complete_and_retry_preserves_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'config'
            files = self.config()
            install_configuration(directory, files)
            original = {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in directory.iterdir()}
            self.assertEqual(set(original), set(files))
            for name in files:
                self.assertEqual(json.loads(original[name][0]), files[name])
                if os.name == 'posix':
                    self.assertEqual((directory / name).stat().st_mode & 0o777, 0o600)
            install_configuration(directory, files)
            self.assertEqual(original, {path.name: (path.read_bytes(), path.stat().st_mtime_ns)
                                        for path in directory.iterdir()})
            self.assertEqual(list(Path(temporary).iterdir()), [directory])

    def test_different_login_never_overwrites_existing_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'config'
            install_configuration(directory, self.config())
            original = {p.name: p.read_bytes() for p in directory.iterdir()}
            changed = copy.deepcopy(self.payload)
            changed['sudorouter_key'] = 'replacement-fixture'
            with self.assertRaisesRegex(ValueError, 'preserved'):
                install_configuration(directory, self.config(changed))
            self.assertEqual(original, {p.name: p.read_bytes() for p in directory.iterdir()})

    def test_failed_publication_leaves_no_partial_config_or_secret_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'config'
            with patch('private_cloud_config.Path.rename', side_effect=OSError('fixture publication failure')):
                with self.assertRaises(OSError):
                    install_configuration(directory, self.config())
            self.assertFalse(directory.exists())
            self.assertEqual(list(Path(temporary).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
