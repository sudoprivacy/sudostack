import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "lib"))
import bootstrap  # noqa: E402
import hosted_common as hc  # noqa: E402
import ops  # noqa: E402


class StateTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.env = {"SUDOPRIVATE_STATE": os.environ.get("SUDOPRIVATE_STATE"), "HOME": os.environ.get("HOME")}
        os.environ["SUDOPRIVATE_STATE"] = str(self.root / "state")
        os.environ["HOME"] = str(self.root / "home")
        (self.root / "home").mkdir()
        self.p = hc.paths()
        hc.ensure_dirs(self.p)

    def tearDown(self):
        for key, value in self.env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()


class HelpersTest(unittest.TestCase):
    def test_chat_models_filter(self):
        self.assertEqual(hc.chat_models(["gpt-4o", "text-embedding-3", "bge-rerank", "dall-e-3", "claude"]),
                         ["gpt-4o", "claude"])

    def test_lock_pins(self):
        lock = hc.load_lock(HERE)
        self.assertRegex(lock["router"]["baseUrl"], r"^https://[a-z0-9.-]+/v1$")
        for key in ("linux-x64", "linux-arm64", "macos-x64", "macos-arm64"):
            self.assertRegex(lock["scode"]["archiveSha256"][key], r"^[0-9a-f]{64}$")
        self.assertRegex(lock["mosswork"]["installerSha256"], r"^[0-9a-f]{64}$")

    def test_platform_key(self):
        self.assertRegex(bootstrap.platform_key(), r"^(macos|linux)-(x64|arm64)$")

    def test_evaluate_blocks_arm64_and_password_sudo(self):
        lock = hc.load_lock(HERE)
        facts = {"os": "Linux", "arch": "aarch64", "sudo": "password_required", "docker": "", "compose": "",
                 "has_curl": "yes", "has_tar": "yes", "has_sha256sum": "yes", "mem_kb": str(16 << 20),
                 "disk_free_kb": str(100 << 20), "router_http": "401", "github_http": "200"}
        status = {c["check"]: c["status"] for c in ops.evaluate(facts, lock, 8088)}
        self.assertEqual(status["架构"], "fail")
        self.assertEqual(status["权限"], "fail")
        self.assertEqual(status["Docker"], "warn")
        self.assertEqual(status["SudoRouter 连通"], "ok")

    def test_evaluate_ready_host(self):
        lock = hc.load_lock(HERE)
        facts = {"os": "Linux", "arch": "x86_64", "sudo": "nopasswd", "docker": "Docker 27",
                 "compose": "Docker Compose v2", "docker_running": "yes", "has_curl": "yes", "has_tar": "yes", "has_sha256sum": "yes",
                 "mem_kb": str(16 << 20), "disk_free_kb": str(100 << 20), "router_http": "401",
                 "github_http": "301", "port_busy": "0", "existing_install": "no"}
        self.assertTrue(all(c["status"] == "ok" for c in ops.evaluate(facts, lock, 8088)))
        stopped = {c["check"]: c["status"] for c in ops.evaluate({**facts, "docker_running": "no"}, lock, 8088)}
        self.assertEqual(stopped["Docker 服务"], "fail")


class ConfigTest(StateTestCase):
    def test_sync_and_scode_config(self):
        bootstrap.sync_runtime(self.p, None)
        router = {"base_url": "https://router.example/v1", "models": ["m1"], "default_model": "m1"}
        bootstrap.write_scode_config(self.p, router, "sk-secret", "workspace-write")
        config = json.loads((self.p["scode_home"] / "sudocode.json").read_text())
        self.assertEqual(config["auth_modes"]["proxy"]["sudorouter"],
                         {"baseUrl": "https://router.example/v1", "apiKey": "sk-secret"})
        mode = stat.S_IMODE((self.p["scode_home"] / "sudocode.json").stat().st_mode)
        self.assertEqual(mode, 0o600)
        settings = json.loads((self.p["scode_home"] / "settings.json").read_text())
        self.assertEqual(settings["auth_profile"], "sudorouter")
        self.assertIn("guard.py", settings["hooks"]["PreToolUse"][0])
        self.assertIn("bash(actions/ops status:*)", settings["permissions"]["allow"])
        self.assertFalse(any("install" in rule or "configure" in rule or "authorize" in rule
                             for rule in settings["permissions"]["allow"]))
        self.assertTrue((self.p["workspace"] / "AGENTS.md").exists())
        argv = bootstrap.launch_argv(Path("/bin/true"), self.p, router, "workspace-write")
        self.assertNotIn("sk-secret", " ".join(argv))
        self.assertIn("--system-prompt", argv)
        env = bootstrap.launch_env(self.p)
        self.assertEqual(env["SCODE_GLOBAL_CONFIG_DIR"], str(self.p["scode_home"]))

    def test_guard_hook_command_runs(self):
        bootstrap.sync_runtime(self.p, None)
        router = {"base_url": "https://x/v1", "models": ["m"], "default_model": "m"}
        bootstrap.write_scode_config(self.p, router, "k", "workspace-write")
        hook = json.loads((self.p["scode_home"] / "settings.json").read_text())["hooks"]["PreToolUse"][0]
        run = lambda cmd: subprocess.run(["sh", "-c", hook], input=json.dumps(
            {"tool_name": "bash", "tool_input": {"command": cmd}}), text=True, capture_output=True)
        self.assertEqual(run("actions/ops status").returncode, 0)
        self.assertEqual(run("cat ../secrets/router.json").returncode, 2)

    def test_ops_wrapper_status_and_local_job(self):
        bootstrap.sync_runtime(self.p, None)
        wrapper = self.p["workspace"] / "actions" / "ops"
        env = {**os.environ}
        res = subprocess.run([str(wrapper), "authorize", "--local"], text=True, capture_output=True, env=env)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        res = subprocess.run([str(wrapper), "status"], text=True, capture_output=True, env=env)
        self.assertIn("本机", res.stdout)
        target = hc.load_target(self.p)
        self.assertEqual(ops.start_job(self.p, target, "unit-job", "echo hello; exit 3"), "started")
        args = SimpleNamespace(name="unit-job", wait="20")
        result = ops.act_job_status(self.p, args)
        self.assertEqual(result["state"], "finished")
        self.assertEqual(result["rc"], 3)
        receipts = list(self.p["operations"].glob("*-authorize-*.json"))
        self.assertEqual(len(receipts), 1)


if __name__ == "__main__":
    unittest.main()


class CloudCredentialTest(StateTestCase):
    def test_insufficient_quota_detection(self):
        err = hc.HttpError(403, {"error": {"code": "insufficient_user_quota",
                                           "message": "用户额度不足, 剩余额度: ＄0.000000"}}, "u")
        self.assertTrue(bootstrap.insufficient_quota(err))
        self.assertFalse(bootstrap.insufficient_quota(hc.HttpError(403, {"error": {"code": "model_not_allowed"}}, "u")))
        self.assertFalse(bootstrap.insufficient_quota(OSError("x")))

    def test_saved_session_is_reused_and_refreshed(self):
        hc.write_private_json(self.p["secrets"] / "sudocloud.json", {
            "origin": "https://cloud.example", "access_token": "old", "refresh_token": "r1"})
        calls = []

        def fake(method, url, body=None, token=None, timeout=30.0):
            calls.append((method, url.rsplit("/", 2)[-1], token, (body or {}).get("grant_type")))
            if url.endswith("/local-runtime") and token == "old":
                raise hc.HttpError(401, {"error": "Unauthorized"}, url)
            if url.endswith("/auth/login"):
                return {"access_token": "new", "refresh_token": "r2"}
            return {"localRuntime": {"status": "ready"}, "sudorouter_key": "sk-x",
                    "model_service_url": "https://router.example/v1"}

        original = hc.http_json
        hc.http_json = fake
        try:
            data = bootstrap.saved_cloud_runtime(self.p, "https://cloud.example")
        finally:
            hc.http_json = original
        self.assertEqual(data["sudorouter_key"], "sk-x")
        self.assertEqual([c[3] for c in calls], [None, "refresh_token", None])
        saved = json.loads((self.p["secrets"] / "sudocloud.json").read_text())
        self.assertEqual((saved["access_token"], saved["refresh_token"]), ("new", "r2"))
        self.assertIsNone(bootstrap.saved_cloud_runtime(self.p, "https://other.example"))
