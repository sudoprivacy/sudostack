"""The control boundary is substituted; executable inodes, exits and files are real."""
import copy
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import checkpoint


@unittest.skipUnless(platform.system() == 'Linux', 'Linux procfs required')
class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.home = Path(self.temporary.name)
        self.environment = patch.dict(os.environ, {'HOME':str(self.home)})
        self.environment.start()
        self.data = self.home/'data'
        self.data.mkdir()
        (self.data/'history').write_bytes(b'existing\x00Unicode:\xe4\xb8\xad\xe6\x96\x87')
        (self.data/'config').write_bytes(b'preserve this configuration')
        self.children, self.calls = {}, []
        self.fail_stop = self.fail_start = None
        for name in ['controller.service', 'runtime.service']:
            self.start(name)
        sha = checkpoint.digest(Path('/proc')/str(self.children['runtime.service'].pid)/'exe')
        self.plan = {'schemaVersion':1,
                     'units':[{'name':name, 'binarySha256':sha} for name in self.children],
                     'paths':{'native':str(self.data)},
                     'pins':[{'path':str(self.data/'config'), 'sha256':checkpoint.digest(self.data/'config')}]}
        self.control = patch.object(checkpoint, 'control', self.dispatch)
        self.control.start()

    def start(self, unit):
        self.children[unit] = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(600)'],
                                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def dispatch(self, *args):
        operation, unit = args[:2]
        child = self.children[unit]
        if operation == 'show':
            alive = child.poll() is None
            return '\n'.join(['LoadState=loaded', 'ActiveState='+('active' if alive else 'inactive'),
                              'MainPID='+str(child.pid if alive else 0), 'ControlGroup=', 'TriggeredBy='])
        self.calls.append((operation, unit))
        if operation == 'stop':
            child.terminate()
            child.wait(timeout=5)
            if self.fail_stop == unit:
                raise subprocess.CalledProcessError(1, ['systemctl', 'stop', unit])
        elif operation == 'start':
            if self.fail_start == unit:
                raise subprocess.CalledProcessError(1, ['systemctl', 'start', unit])
            self.start(unit)
        return ''

    def tearDown(self):
        self.control.stop()
        for child in self.children.values():
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=5)
        self.environment.stop()
        self.temporary.cleanup()

    def test_real_exits_precede_copy_and_original_processes_restore_in_reverse_order(self):
        before = {name:child.pid for name,child in self.children.items()}
        output = self.home/'checkpoints'/'one'
        original = checkpoint.inventory({'native':self.data})
        report = checkpoint.checkpoint(self.plan, output, True)
        self.assertEqual(report['status'], 'cold-checkpoint-created')
        self.assertEqual(self.calls, [('stop','controller.service'), ('stop','runtime.service'),
                                     ('start','runtime.service'), ('start','controller.service')])
        self.assertTrue(all(child.pid != before[name] and child.poll() is None for name,child in self.children.items()))
        self.assertEqual(report['inventory'], original)
        self.assertEqual(checkpoint.inventory({'native':output/'native'}), original)
        self.assertEqual(checkpoint.inventory({'native':self.data}), original)
        self.assertFalse(report['nativeHistoryRecoveryAccepted'])
        self.assertEqual((output/'native/history').stat().st_mode & 0o777, 0o600)
        self.assertEqual((output/'checkpoint.json').stat().st_mode & 0o777, 0o600)

    def test_inspection_and_pin_rejection_never_stop_services(self):
        output = self.home/'new-output'
        self.assertEqual(checkpoint.checkpoint(self.plan, output, False)['status'], 'inspected')
        changed = copy.deepcopy(self.plan)
        changed['pins'][0]['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'Pinned configuration changed'):
            checkpoint.checkpoint(changed, output, True)
        self.assertEqual(self.calls, [])
        self.assertFalse(output.exists())

    def test_partial_stop_failure_restores_even_the_service_whose_stop_returned_error(self):
        self.fail_stop = 'runtime.service'
        report = checkpoint.checkpoint(self.plan, self.home/'partial', True)
        self.assertEqual(report['status'], 'not-completed')
        self.assertEqual(self.calls[-2:], [('start','runtime.service'), ('start','controller.service')])
        self.assertNotIn('inventory', report)

    def test_copy_failure_preserves_original_and_failure_receipt_then_restores(self):
        before = checkpoint.inventory({'native':self.data})
        with patch.object(checkpoint.shutil, 'copytree', side_effect=OSError('injected disk-full')):
            report = checkpoint.checkpoint(self.plan, self.home/'disk-full', True)
        self.assertEqual(report['status'], 'not-completed')
        self.assertIn('disk-full', report['error'])
        self.assertEqual(checkpoint.inventory({'native':self.data}), before)
        saved = json.loads((self.home/'disk-full/checkpoint.json').read_text())
        self.assertEqual(saved['status'], 'not-completed')
        self.assertTrue(all(child.poll() is None for child in self.children.values()))

    def test_failed_runtime_restore_leaves_controller_stopped_and_reports_both_failures(self):
        self.fail_start = 'runtime.service'
        with patch.object(checkpoint.shutil, 'copytree', side_effect=OSError('injected copy failure')):
            report = checkpoint.checkpoint(self.plan, self.home/'failed-restore', True)
        self.assertEqual(report['status'], 'not-completed')
        self.assertIn('copy failure', report['checkpointError'])
        self.assertEqual(report['restoration'][-1]['status'], 'blocked-by-dependency-restoration')
        self.assertNotIn(('start','controller.service'), self.calls)

    def test_symlink_input_is_refused_before_maintenance(self):
        (self.data/'alias').symlink_to(self.data/'config')
        with self.assertRaisesRegex(ValueError, 'regular files'):
            checkpoint.checkpoint(self.plan, self.home/'symlink', True)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
