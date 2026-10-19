"""Installed operational commands must contain the same complete tools as the release."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import atlas
from artifacts import RUNTIME_SCRIPTS


class RuntimeToolTests(unittest.TestCase):
    def test_installed_cli_imports_its_dependencies_outside_the_source_checkout(self):
        source = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'installed'
            atlas.install_runtime_tools(root, source)
            for name in RUNTIME_SCRIPTS:
                self.assertEqual((root / name).read_bytes(), (source / name).read_bytes())
            environment = {name: value for name, value in os.environ.items() if name != 'PYTHONPATH'}
            result = subprocess.run([sys.executable, str(root / 'atlas.py'), '--help'],
                                    cwd=directory, env=environment, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('usage:', result.stdout)

    def test_incomplete_tools_fail_before_creating_an_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            source, root = Path(directory) / 'assets', Path(directory) / 'installed'
            source.mkdir()
            for name in RUNTIME_SCRIPTS:
                if name != 'artifacts.py':
                    (source / name).write_text('fixture')
            with self.assertRaisesRegex(ValueError, 'Missing runtime tool: artifacts.py'):
                atlas.install_runtime_tools(root, source)
            self.assertFalse(root.exists())


if __name__ == '__main__':
    unittest.main()
