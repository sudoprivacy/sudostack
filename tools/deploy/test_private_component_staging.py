"""Exercise signing and verification before the producer freezes component pins."""
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock

from private_macos_candidate import sign_staged_component


class ComponentSigningTests(unittest.TestCase):
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
