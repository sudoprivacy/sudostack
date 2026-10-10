"""Regression checks for truthful, bounded deployment inspection."""

import json
import subprocess
import unittest
from unittest.mock import patch

import compose_status


class ComposeStatusTests(unittest.TestCase):
    def test_permission_failure_is_an_error_without_a_privileged_retry(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "permission denied")) as run:
            with self.assertRaisesRegex(compose_status.InspectionError, "permission denied"):
                compose_status.inspect_project("demo", ["docker"])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][0], "docker")

    def test_empty_project_is_not_a_successful_version_check(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")):
            with self.assertRaisesRegex(compose_status.InspectionError, "No containers found"):
                compose_status.inspect_project("missing", ["docker"])

    def test_explicit_sudo_reports_image_identity_and_health_without_secrets(self):
        container = {"Name": "/demo-webui-1", "Image": "sha256:actual", "Config": {"Image": "webui:commit", "Env": ["SECRET=private"], "Labels": {"com.docker.compose.project": "demo", "com.docker.compose.service": "webui"}}, "State": {"Status": "running", "ExitCode": 0, "Health": {"Status": "healthy"}}}
        replies = [subprocess.CompletedProcess([], 0, "container-id\n", ""), subprocess.CompletedProcess([], 0, json.dumps([container]), "")]
        with patch.object(subprocess, "run", side_effect=replies) as run:
            report = compose_status.inspect_project("demo", ["sudo", "-n", "docker"])
            self.assertEqual(report["containers"][0]["image_id"], "sha256:actual")
            self.assertEqual(report["containers"][0]["health"], "healthy")
            self.assertNotIn("private", json.dumps(report))
            self.assertTrue(all(call.args[0][:3] == ["sudo", "-n", "docker"] for call in run.call_args_list))

    def test_project_change_is_refused(self):
        container = {"Config": {"Labels": {"com.docker.compose.project": "another-project"}}}
        replies = [subprocess.CompletedProcess([], 0, "container-id", ""), subprocess.CompletedProcess([], 0, json.dumps([container]), "")]
        with patch.object(subprocess, "run", side_effect=replies):
            with self.assertRaisesRegex(compose_status.InspectionError, "project changed"):
                compose_status.inspect_project("demo", ["docker"])


if __name__ == "__main__":
    unittest.main()
