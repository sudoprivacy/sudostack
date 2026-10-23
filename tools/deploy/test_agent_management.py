import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import agent_management as management


class AgentManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.file = self.root / 'private.json'
        self.file.write_text(json.dumps({'server': {'host': '127.0.0.1', 'port': 43138}, 'publicOrigin': 'http://127.0.0.1:43138'}))
        self.file.chmod(0o600)
        self.credential = self.root / 'private.key'
        self.credential.write_text('SECRET_NOT_FOR_OUTPUT')
        self.credential.chmod(0o600)
        self.env = {'moss': {'env': {
            'MOSS_SERVER_CONFIG': str(self.file), 'MOSS_AGENT_REGISTRY_CONFIG_FILE': str(self.file),
            'MOSS_AGENT_HOSTED_CONFIG_FILE': str(self.file), 'MOSS_AGENT_HOSTED_TASKS_ENABLED': '1',
            'MOSS_AGENT_EXTERNAL_TASK_CONTEXT_ORIGIN': 'http://127.0.0.1:43138',
            'MOSS_PUBLIC_BASE_URL': 'http://127.0.0.1:43138', 'MOSS_NEXUS_MODE': 'external',
            'MOSS_NEXUS_ENDPOINT': 'http://127.0.0.1:22143', 'MOSS_AUTH_PROXY_PORT': '22144',
            'MOSS_INSTANCE_ID': 'test'}, 'secret_files': {}},
            'webui': {'env': {'CONFIG_PATH': str(self.file), 'NODE_ENV': 'development'},
                      'secret_files': {k: str(self.credential) for k in ['DATABASE_URL', 'SESSION_HMAC_KEY', 'TOKEN_AES_KEY']}}}
        self.registry = {'python': sys.executable, 'database_url_file': str(self.credential),
            'signing_key_file': str(self.credential), 'token_file': str(self.credential),
            'domain_zones': {'example.test': 'zone'}, 'inventory_zone_domains': {'zone': 'office'},
            'attestors': [], 'execution_policy_file': str(self.file), 'host': '127.0.0.1', 'port': 22141,
            'vfs': {'endpoint': 'https://127.0.0.1:22160', 'tls': {k: str(self.credential) for k in ['ca', 'cert', 'key']},
                    'known_zones': str(self.root / 'known-zones')}}
        self.config = {'schema_version': 1, 'scope': 'synthetic', 'sources': {},
                       'services': dict(self.env, registry=self.registry)}

    def test_missing_task_switches_and_mismatched_origins_fail_before_launch(self):
        management.service_environment(self.config, 'moss')
        for key, value in [('MOSS_AGENT_HOSTED_TASKS_ENABLED', '0'),
                           ('MOSS_AGENT_EXTERNAL_TASK_CONTEXT_ORIGIN', 'http://127.0.0.1:5000')]:
            invalid = copy.deepcopy(self.config)
            invalid['services']['moss']['env'][key] = value
            with self.assertRaises(ValueError):
                management.service_environment(invalid, 'moss')
        del self.env['moss']['env']['MOSS_AGENT_HOSTED_TASKS_ENABLED']
        with self.assertRaises(ValueError):
            management.service_environment(self.config, 'moss')

    def test_raw_secrets_and_environment_injection_are_rejected(self):
        self.assertEqual(management.service_environment(self.config, 'webui')['TOKEN_AES_KEY'], 'SECRET_NOT_FOR_OUTPUT')
        for name, key, value in [('webui', 'TOKEN_AES_KEY', 'DO_NOT_INLINE'), ('moss', 'NODE_OPTIONS', '--require=/tmp/x')]:
            invalid = copy.deepcopy(self.config)
            invalid['services'][name]['env'][key] = value
            invalid['services'][name]['secret_files'].pop(key, None)
            with self.assertRaises(ValueError):
                management.service_environment(invalid, name)

    def test_public_urls_and_credential_urls_are_not_loopback_topology(self):
        for value in ['https://example.test:443', 'http://127.0.0.1:80?token=x', 'http://u:p@localhost:80', 'http://localhost:80/path']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                management.loopback_origin(value)

    def test_non_loopback_application_binding_is_rejected(self):
        self.file.write_text(json.dumps({'server': {'host': '0.0.0.0', 'port': 43138}}))
        with self.assertRaisesRegex(ValueError, 'bind address'):
            management.service_environment(self.config, 'moss')

    def test_private_configuration_permissions_and_missing_material(self):
        self.file.chmod(0o644)
        with self.assertRaises(ValueError):
            management.read_json(self.file, private=True)
        self.credential.chmod(0o644)
        with self.assertRaises(ValueError):
            management.secret(self.credential)
        with self.assertRaises(ValueError):
            management.secret(self.root / 'absent')

    def test_registry_requires_tls_explicit_domain_and_private_material(self):
        management.registry_configuration(self.config)
        for modify in [lambda r: r.update(host='0.0.0.0'),
                       lambda r: r['vfs'].update(endpoint='http://127.0.0.1:22160'),
                       lambda r: r.update(inventory_zone_domains={}),
                       lambda r: r.update(attestors='user:admin')]:
            invalid = copy.deepcopy(self.config)
            modify(invalid['services']['registry'])
            with self.assertRaises(ValueError):
                management.registry_configuration(invalid)

    def test_exact_real_git_revisions_and_tracked_edits(self):
        for name in ('moss', 'work', 'nexus', 'stack'):
            path = self.root / name
            path.mkdir()
            subprocess.run(['git', 'init', '-q', str(path)], check=True)
            (path / 'tracked').write_text(name)
            subprocess.run(['git', '-C', str(path), 'add', 'tracked'], check=True)
            subprocess.run(['git', '-C', str(path), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], check=True)
            revision = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
            self.config['sources'][name] = {'path': str(path), 'revision': revision}
        with patch.object(management, '__file__', str(self.root / 'stack/tools/deploy/agent_management.py')):
            self.assertEqual(set(management.source_paths(self.config)), {'moss', 'work', 'nexus', 'stack'})
            (self.root / 'moss/untracked-private-file').write_text('kept')
            management.source_paths(self.config)
            (self.root / 'moss/tracked').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'differs'):
                management.source_paths(self.config)
            (self.root / 'moss/tracked').write_text('moss')
            self.config['sources']['moss']['revision'] = 'a' * 40
            with self.assertRaisesRegex(ValueError, 'differs'):
                management.source_paths(self.config)

    def test_check_has_no_runtime_or_offline_success_claim_and_no_side_effect(self):
        self.file.write_text(json.dumps(self.config))
        with patch.object(sys, 'argv', ['agent_management.py', 'check', '--config', str(self.file)]), \
             patch.object(management, 'validate', return_value=({}, {})), \
             patch.object(management.os, 'execvpe') as execute, \
             patch('builtins.print') as output:
            management.main()
        execute.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertFalse(report['runtime_acceptance'])
        self.assertFalse(report['offline_acceptance'])
        self.assertNotIn('SECRET_NOT_FOR_OUTPUT', output.call_args.args[0])

    def test_launch_does_not_inherit_unrelated_credentials_or_feature_flags(self):
        self.file.write_text(json.dumps(self.config))
        with patch.object(sys, 'argv', ['agent_management.py', 'run-webui', '--config', str(self.file)]), \
             patch.object(management, 'validate', return_value=({'work': self.root}, {'webui': {'NODE_ENV': 'development'}})), \
             patch.dict(os.environ, {'UNRELATED_SECRET': 'SENSITIVE', 'MOSS_AGENT_REGISTRY_TRUST_FILE': '/wrong', 'NODE_OPTIONS': 'bad'}), \
             patch.object(management.os, 'chdir'), patch.object(management.os, 'execvpe') as execute:
            management.main()
        _, argv, env = execute.call_args.args
        self.assertEqual(argv, ['node', 'dist/server/index.js'])
        self.assertFalse({'UNRELATED_SECRET', 'MOSS_AGENT_REGISTRY_TRUST_FILE', 'NODE_OPTIONS'} & env.keys())


if __name__ == '__main__':
    unittest.main()
