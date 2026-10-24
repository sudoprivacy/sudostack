"""Real process/inode/private-file checks; only systemd is substituted."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

from cohost import digest
import product_qualification
import test_checkpoint


class ProductQualificationTests(test_checkpoint.CheckpointTests):
    def setUp(self):
        super().setUp()
        self.runtime = self.home/'pinned-runtime'
        shutil.copy2(Path(sys.executable).resolve(),self.runtime)
        self.runtime.chmod(0o700)
        self.entry = self.home/'service.py'
        self.entry.write_text('import time;time.sleep(600)\n')
        self.children['controller.service'].terminate()
        self.children['controller.service'].wait(timeout=5)
        self.children['controller.service'] = subprocess.Popen([str(self.runtime),str(self.entry)])
        self.producer = self.home/'producer.py'
        self.producer.write_text('''import json,pathlib,sys
configuration,output,verb,sid=sys.argv[1:]
root=pathlib.Path(output);root.mkdir(mode=0o700)
values=json.loads(pathlib.Path(configuration).read_text())
with (pathlib.Path(configuration).parent/'calls').open('a') as log:log.write(verb+'\\n')
proof=values['inspection' if verb=='--inspect-existing' else 'model']
(root/'receipt.json').write_text(json.dumps(proof))
''')
        self.binding = {'ownerId':'original-owner','agentId':'original-agent',
            'durableSessionId':'original-sid','repositoryPath':'/agents/original-agent/workspaces/original-session'}
        common = {'schemaVersion':1,'ownerId':'original-owner','accountCreated':False,
            'agentCreated':False,'sessionCreated':False,'probeTokenLoggedOut':True}
        self.values = {'inspection':{**common,'turnSubmitted':False,'nativeExecutionResumeRequested':False,
            'existingHistoryReads':[{'sessionId':'original-session','messagesSha256':'a'*64}]},
            'model':{**common,'nativeBindingPreserved':self.binding,'originalHistoryBeforeJourneySha256':'a'*64,
                'resumeHttpAccepted':True,'projectedContextPreserved':True,'modelJourneyAccepted':True,
                'dependentReplyAndReattachAccepted':True,'modelTurnsCompleted':3,'modelConfigurationChanged':False}}
        self.config = self.home/'configuration.json'
        self.config.write_text(json.dumps(self.values));self.config.chmod(0o600)
        self.product_plan = {'schemaVersion':1,
            'producer':{'path':str(self.producer),'sha256':digest(self.producer),'source':'1'*40},
            'runtime':{'path':str(self.runtime),'sha256':digest(self.runtime)},
            'configuration':{'path':str(self.config),'sha256':digest(self.config)},
            'service':{'name':'controller.service','binary':str(self.runtime),'sha256':digest(self.runtime),
                'argumentFiles':[{'path':str(self.entry),'sha256':digest(self.entry)}]},
            'session':{'id':'original-session',**self.binding,'messagesSha256':'a'*64}}

    def update_configuration(self):
        self.config.write_text(json.dumps(self.values))
        self.product_plan['configuration']['sha256'] = digest(self.config)

    def test_inspection_and_tampered_artifact_never_run_the_producer(self):
        result = product_qualification.qualify(self.product_plan,self.home/'evidence')
        self.assertEqual(result['status'],'inspected')
        self.assertFalse((self.home/'calls').exists())
        self.assertFalse((self.home/'evidence').exists())
        self.producer.write_text('raise RuntimeError("must not execute")')
        with self.assertRaisesRegex(ValueError,'checksum mismatch'):
            product_qualification.qualify(self.product_plan,self.home/'evidence',True)
        self.assertFalse((self.home/'calls').exists())

    def test_original_binding_and_model_receipt_are_preserved_without_lifecycle_cleanup(self):
        pid = self.children['controller.service'].pid
        output = self.home/'qualification'
        result = product_qualification.qualify(self.product_plan,output,True)
        self.assertEqual(result['status'],'product-qualification-accepted')
        self.assertEqual(result['nativeBindingPreserved'],self.binding)
        self.assertFalse(result['domainJoinAccepted'])
        self.assertFalse(result['nativeHistorySemanticRecallClaimed'])
        self.assertEqual((self.home/'calls').read_text().splitlines(),['--inspect-existing','--exercise-existing'])
        self.assertEqual(self.children['controller.service'].pid,pid)
        self.assertIsNone(self.children['controller.service'].poll())
        self.assertEqual(self.calls,[])
        self.assertEqual((output/'receipt.json').stat().st_mode & 0o777,0o600)
        with self.assertRaisesRegex(ValueError,'new evidence'):
            product_qualification.qualify(self.product_plan,output,True)
        self.assertEqual(len((self.home/'calls').read_text().splitlines()),2)

    def test_changed_history_refuses_before_a_model_command(self):
        self.values['inspection']['existingHistoryReads'][0]['messagesSha256'] = 'b'*64
        self.update_configuration()
        result = product_qualification.qualify(self.product_plan,self.home/'stale',True)
        self.assertEqual(result['status'],'product-qualification-refused')
        self.assertFalse(result['modelTurnsMayHaveBeenSubmitted'])
        self.assertEqual((self.home/'calls').read_text().splitlines(),['--inspect-existing'])

    def test_post_submission_binding_mismatch_stays_unknown_without_retry(self):
        self.values['model']['nativeBindingPreserved'] = {**self.binding,'durableSessionId':'replacement'}
        self.update_configuration()
        result = product_qualification.qualify(self.product_plan,self.home/'unknown',True)
        self.assertEqual(result['status'],'unknown')
        self.assertTrue(result['modelTurnsMayHaveBeenSubmitted'])
        self.assertFalse(result['authenticatedProductReady'])
        self.assertEqual(len((self.home/'calls').read_text().splitlines()),2)
        self.assertEqual(self.calls,[])

    def test_credential_configuration_must_remain_private(self):
        self.config.chmod(0o644)
        with self.assertRaisesRegex(ValueError,'owner-only'):
            product_qualification.qualify(self.product_plan,self.home/'public',True)
        self.assertFalse((self.home/'calls').exists())
