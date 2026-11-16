"""Recovery selection must remain native and must not hide a failed catalogue."""
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from private_macos_entry import agent_command


class NativeAgentEntryTests(unittest.TestCase):
    def setUp(self):
        self.workspace = Path('fixture') / 'workspaces' / 'executor'
        self.binary = Path('fixture') / 'bin' / 'scode'
        self.env = {'SUDO_CODE_CONFIG_HOME': 'fixture/config'}

    def catalogue(self, value):
        return subprocess.CompletedProcess([], 0, json.dumps(value), '')

    def test_first_open_uses_native_empty_catalogue(self):
        with patch('private_macos_entry.subprocess.run', return_value=self.catalogue({'sessions': []})) as run:
            command = agent_command(self.binary, self.workspace, self.env, recover=True)
        self.assertNotIn('--resume', command)
        self.assertEqual(run.call_args.args[0], [str(self.binary), '--resume', 'list', '--output-format', 'json'])
        self.assertEqual(run.call_args.kwargs['cwd'], self.workspace)
        self.assertEqual(run.call_args.kwargs['env'], self.env)

    def test_reopen_delegates_selection_to_native_latest(self):
        with patch('private_macos_entry.subprocess.run', return_value=self.catalogue({'sessions': [{'id': 'native-session'}]})):
            command = agent_command(self.binary, self.workspace, self.env, recover=True)
        self.assertEqual(command[-2:], ['--resume', 'latest'])
        self.assertNotIn('native-session', command)

    def test_catalogue_failures_never_fall_back_to_new_session(self):
        failures = [subprocess.CalledProcessError(1, 'scode'), subprocess.TimeoutExpired('scode', 15)]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch('private_macos_entry.subprocess.run', side_effect=failure):
                with self.assertRaises(type(failure)):
                    agent_command(self.binary, self.workspace, self.env, recover=True)
        for response in ('not-json', '{}', '{"sessions":null}', '{"sessions":{}}', '[]'):
            with self.subTest(response=response), patch('private_macos_entry.subprocess.run', return_value=subprocess.CompletedProcess([], 0, response, '')):
                with self.assertRaises(ValueError):
                    agent_command(self.binary, self.workspace, self.env, recover=True)

    def test_explicit_role_start_or_resume_does_not_query_catalogue(self):
        with patch('private_macos_entry.subprocess.run') as run:
            fresh = agent_command(self.binary, self.workspace, self.env)
            resumed = agent_command(self.binary, self.workspace, self.env, resume=True)
        run.assert_not_called()
        self.assertNotIn('--resume', fresh)
        self.assertEqual(resumed[-2:], ['--resume', 'latest'])


if __name__ == '__main__':
    unittest.main()
