"""PreToolUse guard for the SudoCode ops agent (layer 2 of the scope policy).

Contract (scode runtime/src/hooks.rs): JSON payload on stdin. Exit 0 allows;
exit 2 denies. scode reads the hook's *stdout* (plain text or JSON with
`reason` / `hookSpecificOutput`) as the message returned to the model; stderr
is not forwarded. Anything this guard does not explicitly recognise is denied.

A hook `allow` cannot raise a call above the session's permission mode, so
read-only actions are pre-approved by `permissions.allow` prefix rules in the
generated settings.json instead (see bootstrap.read_only_allow_rules). Those
prefix rules are safe only because this guard rejects all shell syntax first.

Allowed:
  * bash: exactly `actions/ops <action> [args...]` with no shell syntax
  * read_file: files inside the bootstrap workspace (never secrets/config)
  * TodoWrite
"""

from __future__ import annotations

import json
import os
import shlex
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from hosted_common import ACTIONS  # noqa: E402

SHELL_SYNTAX = set(";&|<>`$\\\n\r(){}*?!~#")
SECRET_MARKERS = ("secrets", "sudocode.json", "settings.json", "settings.local.json", ".ssh", "id_ed25519")
SCOPE_HINT = (
    "SudoCode 部署助手只能执行固定的部署动作（actions/ops <动作>），"
    "以及查看工作区内的 runbook 和回执。其他命令、脚本或文件操作不在本助手的范围内。"
)


def tool_input(payload: dict) -> dict:
    value = payload.get("tool_input")
    if isinstance(value, dict):
        return value
    raw = payload.get("tool_input_json") or value or "{}"
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else {}
    except ValueError:
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


def check_bash(command: str, workspace: Path) -> str | None:
    command = command.strip()
    if not command:
        return "空命令"
    bad = sorted(ch for ch in set(command) if ch in SHELL_SYNTAX)
    if bad:
        return "不允许使用 shell 语法（%s）。" % " ".join(repr(c) for c in bad)
    try:
        argv = shlex.split(command)
    except ValueError:
        return "命令无法解析"
    allowed_entry = {"actions/ops", "./actions/ops", str(workspace / "actions" / "ops")}
    if argv[0] not in allowed_entry:
        return f"只允许运行 actions/ops，不允许 `{argv[0]}`。"
    if len(argv) < 2:
        return None
    if argv[1] in ("-h", "--help"):
        return None
    if argv[1] not in ACTIONS:
        return f"未知动作 `{argv[1]}`。可用动作：{', '.join(ACTIONS)}"
    return None


def check_read(path_value: str, workspace: Path) -> str | None:
    if not path_value:
        return "缺少路径"
    path = Path(path_value)
    if not path.is_absolute():
        path = workspace / path
    try:
        resolved = path.resolve()
    except OSError:
        return "路径无效"
    if resolved != workspace and workspace not in resolved.parents:
        return "只能读取部署工作区内的文件。"
    lowered = str(resolved).lower()
    if any(marker in lowered for marker in SECRET_MARKERS):
        return "该文件包含或可能包含凭证，部署助手不读取。"
    return None


def decide(payload: dict, workspace: Path) -> str | None:
    """Return None to allow, or a denial reason."""
    name = str(payload.get("tool_name") or "")
    key = name.lower()
    args = tool_input(payload)
    if key == "bash":
        return check_bash(str(args.get("command") or ""), workspace)
    if key in ("read_file", "read"):
        return check_read(str(args.get("path") or args.get("file_path") or ""), workspace)
    if key == "todowrite":
        return None
    return f"工具 {name} 不在部署助手的允许范围内。"


def main() -> int:
    workspace = Path(os.environ.get("SUDOPRIVATE_WORKSPACE") or os.getcwd()).resolve()
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        payload = {}
    payload = payload if isinstance(payload, dict) else {}
    reason = decide(payload, workspace)
    if reason is None:
        return 0
    print(json.dumps({"decision": "block", "reason": f"{reason}\n{SCOPE_HINT}"}, ensure_ascii=False))
    return 2


if __name__ == "__main__":
    sys.exit(main())
