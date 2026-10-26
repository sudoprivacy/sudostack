"""Real processes, files, selection and producer; systemd dispatch is substituted.

These cases do not establish a real systemd handoff or DGX product acceptance.
"""
import fcntl
import json
from pathlib import Path
import platform
import subprocess
import unittest
from unittest.mock import patch

import device_operation
from cohost import digest
import test_selection


@unittest.skipUnless(platform.system() == 'Linux', 'Linux procfs and flock required')
class DeviceOperationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_selection.SelectionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.home = self.fixture.home
        self.state = self.home / 'operations'
        self.state.mkdir(mode=0o700)
        self.producer = self.home / 'producer.py'
        self.producer.write_text('''import json,pathlib,sys
configuration,output,verb,sid,flag,binding=sys.argv[1:]
assert flag=='--expected-binding'
root=pathlib.Path(output);root.mkdir(mode=0o700)
values=json.loads(pathlib.Path(configuration).read_text())
with (pathlib.Path(configuration).parent/'calls').open('a') as log:log.write(verb+'\\n')
proof=values['inspection' if verb=='--inspect-existing' else 'model']
(root/'receipt.json').write_text(json.dumps(proof))
''')
        binding = {'ownerId': 'owner', 'agentId': 'original-agent', 'durableSessionId': 'original-sid',
                   'repositoryPath': '/agents/original-agent/workspaces/original-session'}
        common = {'schemaVersion': 1, 'ownerId': 'owner', 'accountCreated': False,
                  'agentCreated': False, 'sessionCreated': False, 'probeTokenLoggedOut': True}
        self.values = {'inspection': {**common, 'turnSubmitted': False, 'nativeExecutionResumeRequested': False,
            'nativeBindingObserved': binding, 'existingHistoryReads': [{'sessionId': 'original-session', 'messagesSha256': 'a' * 64}]},
            'model': {**common, 'nativeBindingPreserved': binding, 'originalHistoryBeforeJourneySha256': 'a' * 64,
                'resumeHttpAccepted': True, 'projectedContextPreserved': True, 'modelJourneyAccepted': True,
                'dependentReplyAndReattachAccepted': True, 'modelTurnsCompleted': 3, 'modelConfigurationChanged': False}}
        self.config = self.home / 'producer.json'
        self.config.write_text(json.dumps(self.values)); self.config.chmod(0o600)
        qualification = {'schemaVersion': 1, 'producer': {'path': str(self.producer), 'sha256': digest(self.producer), 'source': '1' * 40},
            'runtime': {'path': str(self.fixture.version), 'sha256': digest(self.fixture.version)},
            'configuration': {'path': str(self.config), 'sha256': digest(self.config)},
            'service': self.fixture.selection_plan['candidates'][0],
            'session': {'id': 'original-session', **binding, 'messagesSha256': 'a' * 64}}
        self.plan = {'schemaVersion': 1, 'deploymentId': 'device', 'ownerId': 'owner',
                     'selection': self.fixture.selection_plan, 'qualification': qualification}
        self.plan_path = self.home / 'approved-plan.json'
        self.registry_path = self.home / 'registry.json'
        self.update_plan()
        self.real_run = subprocess.run
        self.launches = []

    def update_plan(self):
        self.plan_path.write_text(json.dumps(self.plan)); self.plan_path.chmod(0o600)
        self.registry = {'schemaVersion': 1, 'deploymentId': 'device', 'stateDirectory': str(self.state),
            'plans': {'upgrade': {'path': str(self.plan_path), 'sha256': digest(self.plan_path),
                                  'ownerId': 'owner', 'description': 'Preserve the original product'}}}
        self.registry_path.write_text(json.dumps(self.registry)); self.registry_path.chmod(0o600)

    def launch(self, command, **kwargs):
        if command[0] != 'systemd-run':
            return self.real_run(command, **kwargs)
        self.launches.append(command)
        self.assertIn('--property=Restart=no', command)
        self.assertNotIn('--wait', command)
        return subprocess.CompletedProcess(command, 0, b'unit submitted', b'')

    def submit(self, operation='one'):
        with patch.object(subprocess, 'run', self.launch):
            return device_operation.submit(self.registry_path, 'upgrade', operation)

    def test_inspect_and_bad_approval_have_no_job_or_process_effect(self):
        self.assertEqual(device_operation.inspect(self.registry_path, 'upgrade')['status'], 'inspected')
        self.assertEqual(list(self.state.iterdir()), [])
        self.plan['ownerId'] = 'other-owner'; self.update_plan()
        with self.assertRaisesRegex(ValueError, 'approved deployment or owner'):
            device_operation.submit(self.registry_path, 'upgrade', 'one')
        self.assertEqual(self.fixture.calls, [])
        self.assertFalse((self.home / 'calls').exists())

    def test_writable_plan_parent_refuses_without_repair_or_effect(self):
        self.home.chmod(0o770)
        try:
            with self.assertRaisesRegex(ValueError, 'writable by other users'):
                device_operation.submit(self.registry_path, 'upgrade', 'one')
            self.assertEqual(self.home.stat().st_mode & 0o777, 0o770)
            self.assertEqual(self.fixture.calls, [])
            self.assertEqual(list(self.state.iterdir()), [])
        finally:
            self.home.chmod(0o700)

    def test_one_job_runs_existing_selection_and_original_product_producer(self):
        old = self.fixture.children['controller.service'].pid
        first = self.submit()
        self.assertEqual(first['outcome'], 'unknown')
        self.assertEqual(device_operation.submit(self.registry_path, 'upgrade', 'one')['outcome'], 'unknown')
        self.assertEqual(len(self.launches), 1)
        proof = device_operation.execute(self.registry_path, 'one')
        self.assertEqual(proof['status'], 'completed', proof)
        self.assertNotEqual(old, self.fixture.children['controller.service'].pid)
        self.assertEqual(proof['nativeBindingPreserved']['durableSessionId'], 'original-sid')
        self.assertFalse(proof['domainJoinAccepted'])
        self.assertEqual(device_operation.query(self.registry_path, 'one'), proof)
        with self.assertRaises(FileExistsError):
            device_operation.execute(self.registry_path, 'one')
        self.assertEqual((self.home / 'calls').read_text().splitlines(), ['--inspect-existing', '--exercise-existing'])

    def test_lost_submission_reply_never_restarts_or_claims_absence(self):
        def lost(command, **kwargs):
            self.launch(command, **kwargs)
            raise subprocess.TimeoutExpired(command, 30)
        with patch.object(subprocess, 'run', lost):
            self.assertEqual(device_operation.submit(self.registry_path, 'upgrade', 'one')['outcome'], 'unknown')
        self.assertEqual(device_operation.submit(self.registry_path, 'upgrade', 'one')['outcome'], 'unknown')
        self.assertEqual(len(self.launches), 1)
        self.assertEqual(self.fixture.calls, [])

    def test_unknown_product_result_is_not_replayed_and_query_survives_approval_removal(self):
        self.values['model']['nativeBindingPreserved'] = {**self.values['model']['nativeBindingPreserved'], 'durableSessionId': 'changed-sid'}
        self.config.write_text(json.dumps(self.values))
        self.plan['qualification']['configuration']['sha256'] = digest(self.config)
        self.update_plan(); self.submit()
        result = device_operation.execute(self.registry_path, 'one')
        self.assertEqual(result['outcome'], 'unknown')
        self.assertTrue(result['selectionAccepted'])
        self.assertFalse(result['productQualificationAccepted'])
        self.registry['plans'] = {}
        self.registry_path.write_text(json.dumps(self.registry))
        self.assertEqual(device_operation.query(self.registry_path, 'one'), result)
        self.assertEqual(len((self.home / 'calls').read_text().splitlines()), 2)

    def test_changed_approval_between_submit_and_execution_has_no_effect(self):
        self.submit()
        self.registry['plans']['upgrade']['description'] = 'new description'
        self.plan['ownerId'] = 'other-owner'; self.update_plan()
        with self.assertRaisesRegex(ValueError, 'approved deployment or owner'):
            device_operation.execute(self.registry_path, 'one')
        self.assertEqual(self.fixture.calls, [])
        self.assertFalse((self.home / 'calls').exists())

    def test_state_fence_excludes_another_worker_without_waiting_or_retry(self):
        self.submit('one'); self.submit('two')
        with (self.state / '.deploy-operation.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = device_operation.execute(self.registry_path, 'two')
        self.assertEqual(result['outcome'], 'unknown')
        self.assertFalse(result['selectionAccepted'])
        self.assertEqual(self.fixture.calls, [])
        self.assertEqual(device_operation.execute(self.registry_path, 'one')['status'], 'completed')
        with self.assertRaises(FileExistsError):
            device_operation.execute(self.registry_path, 'two')
        self.assertEqual(len((self.home / 'calls').read_text().splitlines()), 2)


if __name__ == '__main__':
    unittest.main()
