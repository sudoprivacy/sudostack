"""Exercise signing and verification before the producer freezes component pins."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from private_macos_candidate import digest, sign_staged_component, sign_verified_staging_copy, write_bundle_pins


class ComponentSigningTests(unittest.TestCase):
    def test_final_manifest_and_checksums_cover_signed_bytes_and_record_input(self):
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp)
            (stage / 'bin').mkdir()
            artifacts = {}
            for name, file in (('scode','scode'), ('daemon','nexusd-cluster'),
                               ('operator','nexus-agent-enroll'), ('grpcurl','grpcurl')):
                p = stage / 'bin' / file
                p.write_bytes(b'input')
                artifacts[name] = {'file': 'bin/' + file, 'sha256': digest(p)}
            write_bundle_pins(stage, {'artifacts': artifacts})
            with patch('private_macos_candidate.sign_staged_component',
                       side_effect=lambda p, identity, team: p.write_bytes(b'signed')):
                sign_verified_staging_copy(stage, 'identity', 'ABCDEFGHIJ')
            manifest = json.loads((stage / 'native-bundle.json').read_bytes())
            for name, record in manifest['artifacts'].items():
                self.assertEqual(record['sourceSha256'], artifacts[name]['sha256'])
                self.assertEqual(record['sha256'], digest(stage / record['file']))
                self.assertEqual(manifest['files'][record['file']], record['sha256'])
            sums = (stage / 'SHA256SUMS').read_text().splitlines()
            self.assertIn(digest(stage / 'native-bundle.json') + '  native-bundle.json', sums)
            self.assertEqual(len(sums), 5)

    def results(self, team, existing):
        signature = ('Authority=Developer ID Application: Example\nTeamIdentifier=' + team
                     + '\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=an Apple timestamp\n')
        return Mock(side_effect=[
            subprocess.CompletedProcess([], existing, '', ''),
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0, '', signature),
        ])

    def test_existing_entitlements_are_preserved_on_the_staged_copy(self):
        runner = self.results('ABCDEFGHIJ', 0)
        sign_staged_component(Path('staged/agent'), 'identity', 'ABCDEFGHIJ', run=runner)
        args = runner.call_args_list[1].args[0]
        self.assertIn('--preserve-metadata=identifier,entitlements', args)
        self.assertEqual(args[-1], str(Path('staged/agent')))
        self.assertIn('--timestamp', args)

    def test_unsigned_component_requires_correct_post_signing_team(self):
        runner = self.results('0123456789', 1)
        with self.assertRaisesRegex(ValueError, 'Developer ID'):
            sign_staged_component(Path('staged/agent'), 'identity', 'ABCDEFGHIJ', run=runner)
        self.assertFalse(any('preserve-metadata' in a for a in runner.call_args_list[1].args[0]))
