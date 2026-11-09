"""Shared host-only changes must not select an unrelated historical Atlas rebuild."""
import unittest

from artifacts import RUNTIME_SCRIPTS
from release_scope import ASSEMBLY_TOOLS, requires_assembly


class ReleaseScopeTests(unittest.TestCase):
    def test_every_installed_release_script_and_assembly_tool_requires_a_rebuild(self):
        for name in set(RUNTIME_SCRIPTS) | ASSEMBLY_TOOLS:
            with self.subTest(name=name):
                self.assertTrue(requires_assembly(['tools/deploy/' + name]))

    def test_component_locks_and_chart_changes_require_complete_assembly(self):
        for path in ['manifests/deployment/0.0.1.json', 'charts/atlas-mvp/templates/runtime.yaml']:
            with self.subTest(path=path):
                self.assertTrue(requires_assembly([path]))

    def test_device_action_and_test_only_changes_use_their_installed_action_package_checks(self):
        self.assertFalse(requires_assembly([
            'tools/deploy/cohost.py', 'tools/deploy/checkpoint.py', 'tools/deploy/selection.py',
            'tools/deploy/device_operation.py', 'tools/deploy/test_container_placement.py',
            '.github/workflows/deployment-release.yml', 'docs/deployment/agent-host.md',
        ]))
        self.assertTrue(requires_assembly(['tools/deploy/cohost.py', 'tools/deploy/atlas.py']))

    def test_non_repository_paths_are_refused(self):
        for path in ['/tools/deploy/atlas.py', '../charts/atlas-mvp', 'tools//deploy/atlas.py']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                requires_assembly([path])


if __name__ == '__main__':
    unittest.main()
