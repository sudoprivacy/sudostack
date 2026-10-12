import importlib.util
import os
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("business_wire", Path(__file__).with_name("business-wire.py"))
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)


class BusinessWireResourceTests(unittest.TestCase):
    def invoke(self, fault, output="c" * 64):
        calls = []

        def run(args, **_kwargs):
            calls.append(args)
            if fault(args):
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0, stdout=output + "\n")

        with tempfile.TemporaryDirectory() as root:
            binary = Path(root) / "daemon"
            binary.touch()
            env = {"GATE_BIN": str(binary), "NEXUS_VFS_PROTO": root, "NODE_MODULES": root, "WORK": root + "/fresh"}
            with (
                patch.dict(os.environ, env, clear=True),
                patch.object(wire.subprocess, "run", side_effect=run),
                patch.object(wire.subprocess, "check_output", return_value="sha256:" + "a" * 64),
                patch.object(wire.pathlib.Path, "symlink_to"),
                patch.object(wire.urllib.request, "build_opener", return_value=types.SimpleNamespace(open=lambda *_args, **_kwargs: types.SimpleNamespace(status=200))),
            ):
                with self.assertRaises((subprocess.CalledProcessError, RuntimeError)):
                    wire.main()
        return calls

    def test_failed_docker_creation_cannot_remove_an_existing_named_container(self):
        calls = self.invoke(lambda args: args[:2] == ["docker", "run"])
        self.assertFalse(any(args[:2] == ["docker", "rm"] for args in calls))
        self.assertFalse(any(args[0] == "systemctl" for args in calls))

    def test_failed_unit_creation_keeps_existing_unit_and_removes_only_created_container(self):
        calls = self.invoke(lambda args: args[0] == "systemd-run")
        self.assertFalse(any(args[0] == "systemctl" for args in calls))
        self.assertEqual([args for args in calls if args[:2] == ["docker", "rm"]], [["docker", "rm", "-f", "c" * 64]])

    def test_unconfirmed_container_identity_does_not_authorize_name_cleanup(self):
        calls = self.invoke(lambda _args: False, output="ambiguous output")
        self.assertFalse(any(args[:2] == ["docker", "rm"] for args in calls))
        self.assertFalse(any(args[0] == "systemctl" for args in calls))


if __name__ == "__main__":
    unittest.main()
