"""Tests for the hardened system agent. Run: python3 -I -m unittest discover -s tests"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

AGENT = Path(__file__).resolve().parent.parent / "python" / "system_agent.py"


def run(payload, env=None):
    res = subprocess.run([sys.executable, "-I", str(AGENT)], input=json.dumps(payload),
                         capture_output=True, text=True, env=env, timeout=20)
    return json.loads(res.stdout)


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.env = {"HOME": self.home, "PATH": "/usr/bin:/bin", "ULTRON_WORKSPACE": os.path.join(self.home, "UltronWorkspace")}

    def test_shell_removed(self):
        r = run({"action": "run_shell", "command": "touch /tmp/pwned"}, self.env)
        self.assertFalse(r["ok"])
        self.assertIn("Unknown or disabled", r["error"])

    def test_command_presets_only(self):
        self.assertFalse(run({"action": "run_command", "preset": "id; whoami"}, self.env)["ok"])
        self.assertTrue(run({"action": "run_command", "preset": "uptime"}, self.env)["ok"])

    def test_workspace_escape_blocked(self):
        for p in ["../.ssh/id_rsa", "/etc/passwd", "~/.ssh/id_rsa", "a/../../secret"]:
            r = run({"action": "fs_op", "operation": "read", "path": p}, self.env)
            self.assertFalse(r["ok"], p)

    def test_symlink_escape_blocked(self):
        ws = Path(self.env["ULTRON_WORKSPACE"]); ws.mkdir(parents=True)
        secret = Path(self.home) / "secret.txt"; secret.write_text("top secret")
        (ws / "link").symlink_to(secret)
        r = run({"action": "fs_op", "operation": "read", "path": "link"}, self.env)
        self.assertFalse(r["ok"])

    def test_workspace_read_write(self):
        w = run({"action": "fs_op", "operation": "write", "path": "notes/a.txt", "content": "hi"}, self.env)
        self.assertTrue(w["ok"])
        r = run({"action": "fs_op", "operation": "read", "path": "notes/a.txt"}, self.env)
        self.assertEqual(r["content"], "hi")

    def test_sensitive_names_blocked(self):
        r = run({"action": "fs_op", "operation": "write", "path": ".ssh/authorized_keys", "content": "x"}, self.env)
        self.assertFalse(r["ok"])

    def test_workspace_cannot_be_home(self):
        env = dict(self.env, ULTRON_WORKSPACE=self.home)
        self.assertFalse(run({"action": "fs_op", "operation": "list", "path": ""}, env)["ok"])

    def test_bad_urls_rejected(self):
        for target in ["javascript:alert(1)", "file:///etc/passwd", "https://user:pw@evil.com", "Terminal", "iTerm"]:
            r = run({"action": "open_app", "target": target}, self.env)
            self.assertFalse(r["ok"], target)

    def test_hotkey_injection_rejected(self):
        # On macOS this would reach the key validator; elsewhere it fails closed.
        r = run({"action": "hotkey", "keys": 'cmd+\\" & do shell script "id'}, self.env)
        self.assertFalse(r["ok"])

    def test_garbage_input(self):
        res = subprocess.run([sys.executable, "-I", str(AGENT)], input="[1,2]", capture_output=True, text=True)
        self.assertFalse(json.loads(res.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
