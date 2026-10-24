"""Exercise shared placement against real Linux executable inodes and processes."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest


SOURCE = Path(__file__).with_name('cohost.py')
COMMIT = '1234567890abcdef1234567890abcdef12345678'


@unittest.skipUnless(platform.system() == 'Linux' and shutil.which('cc'), 'Linux compiler and procfs required')
class CohostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.commands = self.root / 'bin'
        self.commands.mkdir()
        program = self.root / 'fixture.c'
        program.write_text('''#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
 if (argc > 1 && strcmp(argv[1], "--version") == 0) {
  puts("nexusd-cohost v0.2.36 (sudocode 1234567, nexus-vfs v0.8.23) (plugin-abi 7)"); return 0;
 }
 while (1) sleep(1);
}
''')
        self.binary = self.root / 'cohost'
        subprocess.run(['cc', str(program), '-o', str(self.binary)], check=True, capture_output=True)
        self.sha = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        (self.commands / 'systemctl').write_text('''#!/usr/bin/env python3
import json, os, pathlib, shlex, subprocess, sys
root=pathlib.Path(os.environ['HOME']);args=sys.argv[1:]
state=root/'service.json';unit=root/'.config/systemd/user/test-cohost.service'
info=json.loads(state.read_text()) if state.exists() else {'LoadState':'not-found','MainPID':'0','ActiveState':'inactive'}
if 'show' in args:
 print('\\n'.join(k+'='+str(v) for k,v in info.items()))
elif 'enable' in args:
 line=next(x for x in unit.read_text().splitlines() if x.startswith('ExecStart='))
 child=subprocess.Popen(shlex.split(line.split('=',1)[1]),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 state.write_text(json.dumps({'LoadState':'loaded','MainPID':str(child.pid),'ActiveState':'active','FragmentPath':str(unit)}))
''')
        (self.commands / 'systemctl').chmod(0o755)
        self.environment = {**os.environ, 'HOME': str(self.root), 'PATH': str(self.commands) + os.pathsep + os.environ['PATH']}

    def tearDown(self):
        state = self.root / 'service.json'
        if state.exists():
            pid = int(json.loads(state.read_text()).get('MainPID', '0'))
            if pid:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        self.temporary.cleanup()

    def invoke(self, command='install', **overrides):
        fields = {'binary': str(self.binary), 'sha256': self.sha, 'source': COMMIT,
                  'unit': 'test-cohost', 'bind': '127.0.0.1:22141', 'zone': 'test-zone',
                  'root': str(self.root/'state'), 'config': str(self.root/'config'),
                  'install-root': str(self.root/'versions')}
        fields.update(overrides)
        return subprocess.run([sys.executable, str(SOURCE), command,
                               *[value for k, v in fields.items() for value in ('--'+k, v)]],
                              env=self.environment, capture_output=True, text=True, timeout=15)

    def test_fresh_activation_hashes_the_real_process_and_reentry_is_noop(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['runningBinarySha256'], self.sha)
        self.assertEqual(receipt['status'], 'process-activated')
        self.assertFalse(receipt['authenticatedReady'])
        self.assertFalse(receipt['domainJoinAccepted'])
        before = (self.root/'service.json').read_bytes()
        second = self.invoke()
        self.assertEqual(second.returncode, 0, second.stdout+second.stderr)
        self.assertEqual(json.loads(second.stdout)['status'], 'already-running')
        self.assertEqual(before, (self.root/'service.json').read_bytes())

    def test_existing_foreign_unit_is_not_rewritten_even_when_inactive(self):
        unit = self.root/'.config/systemd/user/test-cohost.service'
        unit.parent.mkdir(parents=True)
        unit.write_text('operator-owned existing unit')
        (self.root/'service.json').write_text(json.dumps({'LoadState':'loaded','MainPID':'0','ActiveState':'inactive'}))
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('owner-controlled drain', result.stdout)
        self.assertEqual(unit.read_text(), 'operator-owned existing unit')
        self.assertFalse((self.root/'versions').exists())

    def test_inspect_does_not_create_files(self):
        before = set(self.root.rglob('*'))
        result = self.invoke('inspect')
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertEqual(before, set(self.root.rglob('*')))

    def test_bad_digest_refuses_before_mutation(self):
        result = self.invoke(sha256='0'*64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('checksum mismatch', result.stdout)
        self.assertFalse((self.root/'versions').exists())

    def test_stage_does_not_activate_or_overwrite_a_corrupt_final_file(self):
        staged = self.invoke('stage')
        self.assertEqual(staged.returncode, 0, staged.stdout+staged.stderr)
        target = Path(json.loads(staged.stdout)['executable'])
        self.assertEqual(target.read_bytes(), self.binary.read_bytes())
        self.assertFalse((self.root/'service.json').exists())
        target.write_bytes(b'corrupt')
        result = self.invoke('stage')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_bytes(), b'corrupt')

    def test_symlink_install_root_is_refused(self):
        other = self.root/'other'
        other.mkdir()
        (self.root/'versions').symlink_to(other, target_is_directory=True)
        result = self.invoke('stage')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list(other.iterdir()))


if __name__ == '__main__':
    unittest.main()
