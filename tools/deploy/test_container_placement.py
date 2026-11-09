"""Container state is an additional cold-copy fence, beyond the attaching CLI."""
import copy
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import checkpoint
import cohost
import test_checkpoint


@unittest.skipUnless(platform.system() == 'Linux', 'Linux container placement')
class ContainerPlacementTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        self.environment = patch.dict(os.environ, {'HOME': str(self.home)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.pin = {'id': 'a' * 64, 'imageSha256': 'sha256:' + 'b' * 64,
                    'runtime': 'gvisor-pinned-version', 'user': '1000:1000', 'networkMode': 'host',
                    'binarySha256': 'c' * 64, 'deploymentId': 'existing-device',
                    'mounts': [{'source': str(self.home / 'policy'), 'target': '/policy', 'readOnly': True},
                               {'source': str(self.home / 'data'), 'target': '/data', 'readOnly': False}]}
        self.observed = {'Id': self.pin['id'], 'Image': self.pin['imageSha256'],
                         'Config': {'User': self.pin['user'], 'Labels': {'sudo.dev/deployment-id': 'existing-device'},
                                    'Env': ['TEST_SECRET=must-not-appear-in-receipts']},
                         'HostConfig': {'Runtime': self.pin['runtime'], 'NetworkMode': 'host', 'ReadonlyRootfs': True,
                                        'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges'],
                                        'RestartPolicy': {'Name': 'no'}},
                         'Mounts': [{'Type': 'bind', 'Source': item['source'], 'Destination': item['target'],
                                     'RW': not item['readOnly']} for item in self.pin['mounts']],
                         'State': {'Running': True, 'Restarting': False, 'Pid': 123}}
        self.calls = []
        for mount in self.pin['mounts']:
            Path(mount['source']).mkdir()

    def docker(self, command, **_kwargs):
        self.calls.append(command)
        if command == ['docker', 'inspect', '--type', 'container', self.pin['id']]:
            return subprocess.CompletedProcess(command, 0, json.dumps([self.observed]), '')
        if command == ['docker', 'exec', self.pin['id'], '/usr/bin/sha256sum', '/proc/1/exe']:
            return subprocess.CompletedProcess(command, 0, self.pin['binarySha256'] + '  /proc/1/exe\n', '')
        raise AssertionError(command)

    def test_running_runtime_binds_image_mount_modes_and_actual_init_without_returning_secrets(self):
        with patch.object(cohost.subprocess, 'run', self.docker):
            report = cohost.container_state(self.pin, True)
        self.assertEqual(report['binarySha256'], self.pin['binarySha256'])
        self.assertNotIn('must-not-appear', json.dumps(report))
        self.assertEqual(len(self.calls), 2)

    def test_mount_runtime_owner_and_privilege_changes_are_refused(self):
        original = copy.deepcopy(self.observed)
        changes = [
            lambda value: value.update(Image='sha256:' + 'd' * 64),
            lambda value: value['HostConfig'].update(Runtime='other-runtime'),
            lambda value: value['Config'].update(User='0:0'),
            lambda value: value['Config'].update(Labels={}),
            lambda value: value['Mounts'][0].update(RW=True),
            lambda value: value['HostConfig'].update(Privileged=True),
            lambda value: value['HostConfig'].update(ReadonlyRootfs=False),
            lambda value: value['HostConfig'].update(RestartPolicy={'Name': 'always'}),
            lambda value: value['HostConfig'].update(PidMode='host'),
        ]
        for change in changes:
            self.observed = copy.deepcopy(original)
            change(self.observed)
            with self.subTest(change=change), patch.object(cohost.subprocess, 'run', self.docker), self.assertRaises(ValueError):
                cohost.container_state(self.pin, True)

    def test_stopped_attaching_cli_does_not_prove_the_container_stopped(self):
        with patch.object(cohost.subprocess, 'run', self.docker), self.assertRaisesRegex(ValueError, 'stopped boundary'):
            cohost.container_state(self.pin, False)
        self.observed['State'] = {'Running': False, 'Restarting': False, 'Pid': 0}
        self.calls.clear()
        with patch.object(cohost.subprocess, 'run', self.docker):
            self.assertFalse(cohost.container_state(self.pin, False)['running'])
        self.assertEqual(len(self.calls), 1)

    def test_unit_preparation_preserves_startup_hooks_and_pins_both_attach_and_stop(self):
        original = '[Unit]\nDescription=existing\n[Service]\nExecStart=/old/runtime\nExecStartPost=/original/native-readiness\n[Install]\nWantedBy=default.target\n'
        self.observed['State'] = {'Running': False, 'Restarting': False, 'Pid': 0}
        with patch.object(cohost.subprocess, 'run', self.docker):
            rendered = cohost.container_unit(original, Path('/usr/bin/docker'), self.pin).decode()
            self.assertIn('ExecStartPost=/original/native-readiness\n', rendered)
            self.assertIn('ExecStart="/usr/bin/docker" "start" "--attach" "' + self.pin['id'] + '"\n', rendered)
            self.assertIn('ExecStop="/usr/bin/docker" "stop" "--time" "60" "' + self.pin['id'] + '"\n', rendered)
            with self.assertRaisesRegex(ValueError, 'Existing stop hooks'):
                cohost.container_unit(original.replace('[Install]', 'ExecStop=/original/stop\n[Install]'), Path('/usr/bin/docker'), self.pin)

    def test_unsafe_container_ids_and_broad_host_binds_refuse_before_docker(self):
        pins = [{**self.pin, 'id': 'another-container'},
                {**self.pin, 'mounts': [{'source': str(self.home), 'target': '/host', 'readOnly': False}]}]
        with patch.object(cohost.subprocess, 'run', self.docker):
            for pin in pins:
                with self.subTest(pin=pin), self.assertRaises(ValueError):
                    cohost.container_state(pin, True)
        self.assertEqual(self.calls, [])


@unittest.skipUnless(platform.system() == 'Linux', 'Linux procfs required')
class ContainerColdCopyTests(test_checkpoint.CheckpointTests):
    def test_a_live_container_blocks_cold_copy_even_after_the_cli_exits(self):
        self.plan['units'][-1]['container'] = {'id': 'fixture-boundary'}
        original = checkpoint.inventory({'native': self.data})
        output = self.home / 'live-container-refused'
        with patch.object(checkpoint, 'attached_container', return_value={'running': True}), \
                patch.object(checkpoint, 'container_state', side_effect=ValueError('Container still running')):
            report = checkpoint.checkpoint(self.plan, output, True)
        self.assertEqual(report['status'], 'not-completed')
        self.assertIn('Container still running', report['error'])
        self.assertNotIn('inventory', report)
        self.assertFalse((output / 'native').exists())
        self.assertEqual(checkpoint.inventory({'native': self.data}), original)
        self.assertTrue(all(child.poll() is None for child in self.children.values()))


if __name__ == '__main__':
    unittest.main()
