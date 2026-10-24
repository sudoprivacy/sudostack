import os
from pathlib import Path
import platform
import tempfile
import unittest
from unittest.mock import patch

from cohost import digest
from configuration import replace_configuration


@unittest.skipUnless(platform.system() == 'Linux', 'Linux owned-path installation')
class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.environment = patch.dict(os.environ, {'HOME':str(self.root)})
        self.environment.start()
        self.old, self.new = self.root/'config', self.root/'prepared'
        self.old.write_bytes(b'original-secret\x00')
        self.new.write_bytes(b'prepared-secret\x00\xe4\xb8\xad')
        self.evidence = self.root/'evidence'

    def tearDown(self):
        self.environment.stop()
        self.temporary.cleanup()

    def run_action(self, execute=False, expected=None):
        return replace_configuration(self.old, expected or digest(self.old), self.new,
                                     digest(self.new), self.evidence, execute)

    def test_installs_exact_bytes_retains_private_original_and_refuses_reentry(self):
        original = self.old.read_bytes()
        self.assertEqual(self.run_action()['status'], 'inspected')
        self.assertFalse(self.evidence.exists())
        self.assertEqual(self.old.read_bytes(), original)
        report = self.run_action(True)
        self.assertFalse(report['serviceRestarted'])
        self.assertEqual(self.old.read_bytes(), self.new.read_bytes())
        self.assertEqual((self.evidence/'original').read_bytes(), original)
        self.assertEqual(self.old.stat().st_mode&0o777, 0o600)
        self.assertEqual(self.evidence.stat().st_mode&0o777, 0o700)
        with self.assertRaisesRegex(ValueError, 'new evidence'):
            self.run_action(True)

    def test_stale_pin_and_symlink_are_refused_before_mutation(self):
        original = self.old.read_bytes()
        with self.assertRaisesRegex(ValueError, 'pin changed'):
            self.run_action(True, '0'*64)
        self.assertEqual(self.old.read_bytes(), original)
        self.assertFalse(self.evidence.exists())
        link = self.root/'link'
        link.symlink_to(self.old)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            replace_configuration(link,digest(self.old),self.new,digest(self.new),self.evidence,True)


if __name__ == '__main__':
    unittest.main()
