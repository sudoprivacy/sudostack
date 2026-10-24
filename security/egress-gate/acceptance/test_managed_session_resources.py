import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('managed_session', Path(__file__).with_name('managed-session.py'))
managed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(managed)


class ManagedSessionResourceTests(unittest.TestCase):
    def test_existing_evidence_is_refused_before_starting_resources(self):
        with tempfile.TemporaryDirectory() as root:
            binary = Path(root) / 'daemon'
            binary.touch()
            env = {'GATE_BIN': str(binary), 'NEXUS_PROTO_ROOT': root, 'NODE_MODULES': root, 'WORK': root}
            with patch.dict(os.environ, env, clear=True), patch.object(managed.subprocess, 'run') as run:
                with self.assertRaises(FileExistsError):
                    managed.main()
                run.assert_not_called()

    def test_failed_unit_creation_does_not_stop_an_existing_unit(self):
        calls = []

        def run(args, **_kwargs):
            calls.append(args)
            raise subprocess.CalledProcessError(1, args)

        with tempfile.TemporaryDirectory() as root:
            binary = Path(root) / 'daemon'
            binary.touch()
            env = {'GATE_BIN': str(binary), 'NEXUS_PROTO_ROOT': root, 'NODE_MODULES': root, 'WORK': root + '/fresh'}
            with patch.dict(os.environ, env, clear=True), patch.object(managed.subprocess, 'run', side_effect=run), patch.object(managed.pathlib.Path, 'symlink_to'):
                with self.assertRaises(subprocess.CalledProcessError):
                    managed.main()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 'systemd-run')

    def test_failed_direct_launch_never_cleans_up_an_unowned_process(self):
        with tempfile.TemporaryDirectory() as root:
            binary = Path(root) / 'daemon'
            binary.touch()
            env = {'GATE_BIN': str(binary), 'NEXUS_PROTO_ROOT': root, 'NODE_MODULES': root,
                   'WORK': root + '/fresh', 'LIVE_POLICY': '1', 'GATE_PROCESS_MODE': '1'}
            with patch.dict(os.environ, env, clear=True), patch.object(managed.subprocess, 'Popen', side_effect=OSError('fixture launch refused')) as launch, patch.object(managed.subprocess, 'run') as run:
                with self.assertRaisesRegex(OSError, 'fixture launch refused'):
                    managed.main()
                launch.assert_called_once()
                run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
