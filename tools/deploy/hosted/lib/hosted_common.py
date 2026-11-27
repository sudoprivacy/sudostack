"""Shared helpers for the hosted-linux bootstrap wizard, actions and guard.

Standard library only: the control host may have nothing but python3.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import secrets
import ssl
import stat
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PROFILE = "hosted-linux"
# Mirrors moss clientRuntime.ts: these are not chat models.
NON_CHAT_MODEL = re.compile(r"embedding|rerank|whisper|tts|dall-e|image|moderation", re.I)
ACTIONS = (
    "status",
    "inspect",
    "authorize",
    "docker-install",
    "mosswork-install",
    "job-status",
    "mosswork-configure",
    "healthcheck",
    "receipts",
)
# Actions that never change the control host or the target.
READ_ONLY_ACTIONS = ("status", "inspect", "job-status", "healthcheck", "receipts")


def state_dir() -> Path:
    override = os.environ.get("SUDOPRIVATE_STATE", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (Path.home() / ".local" / "share" / "sudoprivate" / PROFILE).resolve()


def paths(root: Path | None = None) -> dict[str, Path]:
    root = root or state_dir()
    return {
        "root": root,
        "bin": root / "bin",
        "scode_home": root / "scode-home",
        "workspace": root / "workspace",
        "runtime": root / "runtime",
        "operations": root / "operations",
        "secrets": root / "secrets",
        "ssh": root / "ssh",
        "target": root / "target.json",
    }


def ensure_dirs(p: dict[str, Path]) -> None:
    for key in ("root", "bin", "scode_home", "workspace", "runtime", "operations", "ssh"):
        p[key].mkdir(parents=True, exist_ok=True)
    p["secrets"].mkdir(parents=True, exist_ok=True)
    os.chmod(p["secrets"], 0o700)
    os.chmod(p["ssh"], 0o700)


def write_private_json(path: Path, data: Any) -> None:
    """Atomically write JSON readable only by the current user."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def load_lock(runtime_or_profile: Path) -> dict[str, Any]:
    return json.loads((runtime_or_profile / "bootstrap.lock.json").read_text(encoding="utf-8"))


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_receipt(p: dict[str, Path], action: str, ok: bool, args: dict[str, Any], result: Any, started: str) -> Path:
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = p["operations"] / f"{stamp}-{action}-{secrets.token_hex(3)}.json"
    write_private_json(path, {
        "schemaVersion": 1,
        "profile": PROFILE,
        "action": action,
        "ok": ok,
        "args": args,
        "startedAt": started,
        "finishedAt": utc_now(),
        "result": result,
    })
    return path


def chat_models(ids: list[str]) -> list[str]:
    return [m for m in ids if m and not NON_CHAT_MODEL.search(m)]


class HttpError(Exception):
    def __init__(self, status: int, body: Any, url: str):
        super().__init__(f"HTTP {status} from {url}")
        self.status = status
        self.body = body
        self.url = url


def http_json(method: str, url: str, body: Any = None, token: str | None = None,
              timeout: float = 30.0) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "sudoprivate-hosted-bootstrap/1")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            parsed: Any = json.loads(raw)
        except ValueError:
            parsed = raw.decode("utf-8", "replace")[:500]
        raise HttpError(err.code, parsed, url) from None


def error_message(body: Any) -> str:
    if isinstance(body, dict):
        for key in ("msg", "message", "detail", "error"):
            value = body.get(key)
            if isinstance(value, dict):
                value = value.get("message")
            if isinstance(value, str) and value:
                return value
    return str(body)[:300]


# ── Target execution ────────────────────────────────────────────────────────

def load_target(p: dict[str, Path]) -> dict[str, Any] | None:
    return read_json(p["target"])


def ssh_base(p: dict[str, Path], target: dict[str, Any], *, own_key: bool = True) -> list[str]:
    args = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", f"UserKnownHostsFile={p['ssh'] / 'known_hosts'}",
        "-o", "ConnectTimeout=15",
        "-o", "ServerAliveInterval=30",
        "-p", str(target.get("port", 22)),
    ]
    if own_key:
        args += ["-i", str(p["ssh"] / "id_ed25519"), "-o", "IdentitiesOnly=yes"]
    args.append(f"{target['user']}@{target['host']}")
    return args


def sudo_prefix(target: dict[str, Any]) -> str:
    return "" if target.get("is_root") else "sudo -n "
