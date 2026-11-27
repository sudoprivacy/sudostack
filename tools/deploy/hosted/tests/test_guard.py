import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "hooks"))
import guard  # noqa: E402


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self.tmp.name).resolve()
        (self.ws / "AGENTS.md").write_text("runbook")

    def tearDown(self):
        self.tmp.cleanup()

    def bash(self, command):
        return guard.decide({"tool_name": "bash", "tool_input": {"command": command}}, self.ws)

    def test_allows_fixed_actions(self):
        for cmd in ("actions/ops status", "./actions/ops inspect --port 8088",
                    "actions/ops authorize --host 10.0.0.2 --user ubuntu --fingerprint SHA256:abcDEF+/0123456789abcdefgh",
                    f"{self.ws}/actions/ops job-status mosswork-install --wait 90",
                    "actions/ops --help", "actions/ops"):
            self.assertIsNone(self.bash(cmd), cmd)

    def test_denies_everything_else(self):
        for cmd in ("ls", "cat AGENTS.md", "python3 -c 'print(1)'", "curl https://example.com",
                    "actions/ops status; rm -rf /", "actions/ops status && id", "actions/ops status | sh",
                    "actions/ops $(id)", "actions/ops `id`", "actions/ops status > /tmp/x",
                    "actions/ops rm-everything", "../actions/ops status", "/tmp/actions/ops status",
                    "actions/ops status\nid", "bash actions/ops status", ""):
            self.assertIsNotNone(self.bash(cmd), cmd)

    def test_tool_input_json_string(self):
        payload = {"tool_name": "Bash", "tool_input": None,
                   "tool_input_json": json.dumps({"command": "actions/ops status"})}
        self.assertIsNone(guard.decide(payload, self.ws))

    def test_read_scope(self):
        read = lambda p: guard.decide({"tool_name": "read_file", "tool_input": {"path": p}}, self.ws)
        self.assertIsNone(read("AGENTS.md"))
        self.assertIsNone(read(str(self.ws / "answers.json")))
        self.assertIsNotNone(read("../secrets/router.json"))
        self.assertIsNotNone(read("/etc/passwd"))
        (self.ws / "secrets").mkdir()
        self.assertIsNotNone(read("secrets/x.json"))
        self.assertIsNotNone(read(str(Path.home() / ".ssh" / "id_rsa")))

    def test_other_tools_denied(self):
        for name in ("write_file", "edit_file", "WebFetch", "WebSearch", "Agent", "glob_search", "mcp__x__y"):
            self.assertIsNotNone(guard.decide({"tool_name": name, "tool_input": {}}, self.ws), name)
        self.assertIsNone(guard.decide({"tool_name": "TodoWrite", "tool_input": {}}, self.ws))

    def test_process_contract(self):
        script = HERE / "hooks" / "guard.py"
        env = {**os.environ, "SUDOPRIVATE_WORKSPACE": str(self.ws)}
        ok = subprocess.run([sys.executable, "-I", str(script)], input=json.dumps(
            {"tool_name": "bash", "tool_input": {"command": "actions/ops status"}}),
            text=True, capture_output=True, env=env)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        denied = subprocess.run([sys.executable, "-I", str(script)], input=json.dumps(
            {"tool_name": "bash", "tool_input": {"command": "rm -rf /"}}),
            text=True, capture_output=True, env=env)
        self.assertEqual(denied.returncode, 2)
        self.assertEqual(json.loads(denied.stdout)["decision"], "block")
        self.assertIn("部署助手", json.loads(denied.stdout)["reason"])
        self.assertEqual(ok.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
