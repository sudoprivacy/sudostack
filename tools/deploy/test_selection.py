import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
from unittest.mock import patch

import checkpoint
from cohost import digest
import test_checkpoint
import selection


class SelectionTests(test_checkpoint.CheckpointTests):
    def setUp(self):
        super().setUp()
        self.unit_files = {}
        self.version = self.home/'candidate-python'
        shutil.copy2(Path(sys.executable).resolve(),self.version)
        self.version.chmod(0o700)
        self.entry = self.home/'application.py'
        self.entry.write_text('import time; time.sleep(600)\n')
        directory = self.home/'units'
        directory.mkdir(mode=0o700)
        self.prepared = []
        selection_checkpoint = copy.deepcopy(self.plan)
        selection_checkpoint['paths']['units'] = str(directory)
        for unit in self.plan['units']:
            path = directory/unit['name']
            path.write_text(json.dumps([sys.executable,'-c','import time;time.sleep(600)']))
            self.unit_files[unit['name']] = path
            old = digest(path)
            selection_checkpoint['pins'].append({'path':str(path),'sha256':old})
            prepared = self.home/(unit['name']+'.prepared')
            prepared.write_text(json.dumps([str(self.version),str(self.entry)]))
            self.prepared.append({'path':str(path),'expectedSha256':old,'prepared':str(prepared),'sha256':digest(prepared)})
        self.selection_plan = {'schemaVersion':1,'checkpoint':selection_checkpoint,'selections':self.prepared,
                               'candidates':[{'name':unit['name'],'binary':str(self.version),'sha256':digest(self.version),
                                              'argumentFiles':[{'path':str(self.entry),'sha256':digest(self.entry)}]}
                                             for unit in self.plan['units']]}

    def start(self, unit):
        path = getattr(self,'unit_files',{}).get(unit)
        if path:
            self.children[unit] = subprocess.Popen(json.loads(path.read_text()),stdin=subprocess.DEVNULL,
                                                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        else:
            super().start(unit)

    def dispatch(self,*args):
        if args == ('daemon-reload',):
            self.calls.append(('daemon-reload',))
            return ''
        return super().dispatch(*args)

    def test_checkpoint_then_selected_real_processes_and_app_entries_activate_in_order(self):
        original = (self.data/'history').read_bytes()
        output = self.home/'selection'
        result = selection.select(self.selection_plan,output,True)
        self.assertEqual(result['status'],'process-selection-activated',result)
        self.assertEqual(self.calls,[('stop','controller.service'),('stop','runtime.service'),('daemon-reload',),
                                    ('start','runtime.service'),('start','controller.service')])
        self.assertEqual((output/'checkpoint/native/history').read_bytes(),original)
        self.assertEqual((self.data/'history').read_bytes(),original)
        self.assertTrue(all(child.poll() is None for child in self.children.values()))
        self.assertFalse(result['authenticatedReady'])
        self.assertFalse(result['automaticDataRollback'])
        with self.assertRaisesRegex(ValueError,'Pinned configuration changed'):
            selection.select(self.selection_plan,self.home/'second',True)

    def test_stale_candidate_and_unpinned_selection_refuse_before_stopping(self):
        altered = copy.deepcopy(self.selection_plan)
        altered['candidates'][0]['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError,'Candidate executable'):
            selection.select(altered,self.home/'bad',True)
        altered = copy.deepcopy(self.selection_plan)
        altered['selections'][0]['expectedSha256'] = '0'*64
        with self.assertRaisesRegex(ValueError,'unique pinned'):
            selection.select(altered,self.home/'bad',True)
        self.assertEqual(self.calls,[])

    def test_pre_selection_copy_failure_restores_originals_without_selecting(self):
        with patch.object(checkpoint.shutil,'copytree',side_effect=OSError('disk full')):
            result = selection.select(self.selection_plan,self.home/'failed-copy',True)
        self.assertEqual(result['status'],'not-completed')
        self.assertIn('disk full',result['error'])
        self.assertTrue(all(child.poll() is None for child in self.children.values()))
        self.assertNotIn(('daemon-reload',),self.calls)

    def test_wrong_app_entry_stops_candidates_without_automatic_old_code_restart(self):
        alternate = self.home/'another-app.py'
        alternate.write_text(self.entry.read_text())
        self.selection_plan['candidates'][1]['argumentFiles'] = [{'path':str(alternate),'sha256':digest(alternate)}]
        result = selection.select(self.selection_plan,self.home/'wrong-entry',True)
        self.assertEqual(result['status'],'not-completed')
        self.assertIn('application entry',result['error'])
        self.assertTrue(result['operatorAttentionRequired'])
        self.assertTrue(all(child.poll() is not None for child in self.children.values()))
        self.assertEqual([call for call in self.calls if call[0]=='start'],[('start','runtime.service')])

    def test_start_failure_preserves_new_data_and_cold_snapshot_instead_of_rollback(self):
        original = (self.data/'history').read_bytes()
        dispatch = self.dispatch
        def failed_start(*args):
            if args == ('start','runtime.service'):
                (self.data/'history').write_bytes(b'native migration already wrote')
                raise subprocess.CalledProcessError(1,['systemctl','start',args[1]])
            return dispatch(*args)
        with patch.object(checkpoint,'control',failed_start):
            result = selection.select(self.selection_plan,self.home/'start-failed',True)
        self.assertEqual(result['status'],'not-completed')
        self.assertTrue(result['operatorAttentionRequired'])
        self.assertEqual((self.data/'history').read_bytes(),b'native migration already wrote')
        self.assertEqual((self.home/'start-failed/checkpoint/native/history').read_bytes(),original)
        self.assertTrue(all(child.poll() is not None for child in self.children.values()))
