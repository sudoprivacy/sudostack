"""Exercise destructive cleanup boundaries without modifying the host."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('cleanup-atlas.sh').resolve()
BASH = shutil.which('bash')


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='atlas-cleanup-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.log = self.root / 'mutations.log'
        self.env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                    'CLEANUP_TEST_LOG': str(self.log)}
        # A regression in dry-run must fail, never reach real host mutation tools.
        for name in ('rm', 'sh', 'systemctl', 'ufw', 'firewall-cmd', 'flock'):
            self.stub(name, 'printf "%s\\n" "$0 $*" >> "$CLEANUP_TEST_LOG"\nexit 97\n')

    def stub(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/sh\n' + body)
        path.chmod(0o755)

    def cli(self, *args):
        return subprocess.run([BASH, str(SCRIPT), *args], cwd=self.root,
                              env=self.env, text=True, capture_output=True)

    def shell(self, source):
        return subprocess.run([BASH, '-c', 'source "$1"\n' + source, 'test', str(SCRIPT)],
                              cwd=self.root, env=self.env, text=True, capture_output=True)

    def test_shell_syntax(self):
        subprocess.run([BASH, '-n', str(SCRIPT)], check=True, capture_output=True)

    def test_preview_never_runs_mutations_and_preserves_downloaded_script(self):
        installer = self.root / 'install-atlas.sh'
        installer.write_text('keep this downloaded installer')
        result = self.cli('--dry-run')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('/data/atlas', result.stdout)
        self.assertIn('sh /usr/local/bin/k3s-uninstall.sh', result.stdout)
        self.assertIn('9443/tcp', result.stdout)
        self.assertNotIn('./install-atlas.sh', result.stdout)
        self.assertFalse(self.log.exists())
        self.assertEqual(installer.read_text(), 'keep this downloaded installer')

    def test_help_and_unknown_options_do_not_mutate(self):
        self.assertEqual(self.cli('--help').returncode, 0)
        self.assertNotEqual(self.cli('--root', '/').returncode, 0)
        self.assertNotEqual(self.cli('--dry-run', '--unknown').returncode, 0)
        self.assertFalse(self.log.exists())

    def test_non_linux_execution_is_rejected(self):
        self.stub('uname', 'printf "Darwin\\n"\n')
        result = self.cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Linux', result.stderr)
        self.assertFalse(self.log.exists())

    def test_uninstaller_failure_stops_before_credentials_are_deleted(self):
        (self.root / 'fake-uninstaller.sh').write_text('# deliberately fails')
        result = self.shell('ATLAS_K3S_UNINSTALLER="$PWD/fake-uninstaller.sh"\n'
                            'uninstall_k3s\nremove_atlas_files\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('k3s 卸载失败', result.stderr)
        self.assertIn('fake-uninstaller.sh', self.log.read_text())
        self.assertNotIn('/bin/rm', self.log.read_text())

    def test_missing_uninstaller_refuses_an_existing_cluster(self):
        self.stub('k3s', 'exit 0\n')
        result = self.shell('ATLAS_K3S_UNINSTALLER="$PWD/missing.sh"\n'
                            'uninstall_k3s\nremove_atlas_files\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('缺少', result.stderr)
        self.assertFalse(self.log.exists())

    def test_agent_node_reports_its_uninstaller_without_deleting_data_or_cache(self):
        (self.root / 'agent-uninstall.sh').write_text('# must not execute')
        for preview in (0, 1):
            with self.subTest(preview=preview):
                result = self.shell('ATLAS_K3S_UNINSTALLER="$PWD/missing.sh"\n'
                                    'ATLAS_K3S_AGENT_UNINSTALLER="$PWD/agent-uninstall.sh"\n'
                                    f'ATLAS_CLEANUP_DRY_RUN={preview}\n'
                                    'uninstall_k3s\nremove_atlas_files\n')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('sudo sh ' + str(self.root.resolve() / 'agent-uninstall.sh'), result.stderr)
                self.assertIn('保留整包下载缓存', result.stderr)
                self.assertFalse(self.log.exists())

    def test_running_service_stops_after_uninstaller_reports_success(self):
        (self.root / 'fake-uninstaller.sh').write_text('# mocked by sh')
        self.stub('sh', 'exit 0\n')
        self.stub('systemctl', 'exit 0\n')
        result = self.shell('ATLAS_K3S_UNINSTALLER="$PWD/fake-uninstaller.sh"\n'
                            'uninstall_k3s\nremove_atlas_files\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('仍在运行', result.stderr)
        self.assertFalse(self.log.exists())

    def test_firewall_failure_is_reported_after_remaining_rules_are_attempted(self):
        result = self.shell('remove_firewall_rules\n')
        self.assertNotEqual(result.returncode, 0)
        attempted = self.log.read_text()
        self.assertIn('6443/tcp', attempted)
        self.assertIn('9443/tcp', attempted)
        self.assertNotIn('22/tcp', attempted)


if __name__ == '__main__':
    unittest.main()
