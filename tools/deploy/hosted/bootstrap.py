#!/usr/bin/env python3
"""hosted-linux bootstrap wizard (no LLM).

1. Local preflight
2. Fetch and verify the pinned scode release
3. Sign in to SudoCloud (phone + SMS code, invitation registration) or paste a
   SudoRouter key, and obtain the SudoRouter key from /api/v1/client/local-runtime
4. Verify the key against the hosted SudoRouter with a real chat request
5. Write an isolated scode configuration (account, model, guard hook)
6. Start the SudoCode ops agent with the fixed system prompt and tool set

Secrets are read with hidden prompts and stored under <state>/secrets (0600);
they never appear on a command line or in the agent conversation.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import platform
import shlex
import shutil
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

PROFILE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PROFILE_DIR / "lib"))
import hosted_common as hc  # noqa: E402

ALLOWED_TOOLS = "bash,read_file,TodoWrite"
ACCOUNT = "sudorouter"
STRIP_ENV = ("PROXY_AUTH_TOKEN", "PROXY_BASE_URL", "SUDO_CODE_CONFIG_HOME", "SCODE_PROJECT_CONFIG_DIR")


class Abort(Exception):
    pass


def say(text: str = "") -> None:
    print(text, flush=True)


def ask(prompt: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        raise Abort("输入已结束") from None
    return value or (default or "")


def ask_secret(prompt: str) -> str:
    try:
        return getpass.getpass(f"{prompt}（输入不显示）: ").strip()
    except EOFError:
        raise Abort("输入已结束") from None


def choose(prompt: str, options: list[str], default: int = 1) -> int:
    for i, option in enumerate(options, 1):
        say(f"  {i}. {option}")
    while True:
        raw = ask(prompt, str(default))
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return int(raw)
        say("请输入列表中的序号。")


# ── 1. preflight ────────────────────────────────────────────────────────────

def platform_key() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    arch = {"x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(machine)
    os_name = {"Darwin": "macos", "Linux": "linux"}.get(system)
    if not arch or not os_name:
        raise Abort(f"不支持的控制端平台：{system} {machine}（支持 macOS 和 Linux）")
    return f"{os_name}-{arch}"


def preflight() -> None:
    if sys.version_info < (3, 8):
        raise Abort("需要 Python 3.8 或更高版本")
    missing = [t for t in ("ssh", "ssh-keygen", "ssh-keyscan") if not shutil.which(t)]
    if missing:
        say(f"提示：未找到 {', '.join(missing)}，只能部署到本机。")


# ── 2. scode ────────────────────────────────────────────────────────────────

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_scode(p: dict[str, Path], lock: dict[str, Any], override: str | None) -> Path:
    if override:
        path = Path(override).expanduser().resolve()
        if not os.access(path, os.X_OK):
            raise Abort(f"--scode 指向的文件不可执行：{path}")
        return path
    scode = lock["scode"]
    key = platform_key()
    dest = p["bin"] / f"scode-{scode['version']}" / "scode"
    marker = dest.with_suffix(".sha256")
    expected = scode["archiveSha256"][key]
    if dest.exists() and marker.exists() and marker.read_text().strip() == expected:
        return dest
    archive_name = f"scode-{key}.tar.gz"
    last_error = None
    with tempfile.TemporaryDirectory(dir=str(p["bin"])) as tmp:
        archive = Path(tmp) / archive_name
        for source in scode["sources"]:
            url = f"{source.rstrip('/')}/{archive_name}"
            say(f"下载 SudoCode {scode['version']}：{url}")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "sudoprivate-hosted-bootstrap/1"})
                with urllib.request.urlopen(req, timeout=60) as resp, archive.open("wb") as handle:
                    shutil.copyfileobj(resp, handle)
            except OSError as err:
                last_error = err
                say(f"  下载失败：{err}，尝试下一个源")
                continue
            actual = sha256_file(archive)
            if actual != expected:
                last_error = Abort(f"校验失败：期望 {expected}，实际 {actual}")
                say(f"  {last_error}，尝试下一个源")
                continue
            break
        else:
            raise Abort(f"无法获取 SudoCode：{last_error}")
        member_name = f"scode-{key}/scode"
        with tarfile.open(archive) as tar:
            member = tar.getmember(member_name)
            if not member.isfile():
                raise Abort("安装包结构异常")
            source = tar.extractfile(member)
            assert source is not None
            dest.parent.mkdir(parents=True, exist_ok=True)
            staged = dest.with_suffix(".new")
            with staged.open("wb") as handle:
                shutil.copyfileobj(source, handle)
            staged.chmod(0o755)
            os.replace(staged, dest)
    marker.write_text(expected + "\n")
    say(f"SudoCode 已校验并安装到 {dest}")
    return dest


# ── 3. SudoCloud sign-in ────────────────────────────────────────────────────

def cloud_post(origin: str, path: str, body: dict) -> dict:
    return hc.http_json("POST", f"{origin}{path}", body)


def send_code(origin: str, phone: str) -> None:
    try:
        resp = cloud_post(origin, "/api/v1/auth/send-code", {"phone": phone})
    except hc.HttpError as err:
        raise Abort(f"发送验证码失败：{hc.error_message(err.body)}") from None
    if not resp.get("success"):
        raise Abort(f"发送验证码失败：{hc.error_message(resp)}")
    say("验证码已发送。")


def phone_login(origin: str) -> dict:
    phone = ask("手机号")
    send_code(origin, phone)
    code = ask_secret("短信验证码")
    try:
        resp = cloud_post(origin, "/api/v1/auth/login", {"phone": phone, "code": code})
    except hc.HttpError as err:
        if isinstance(err.body, dict) and err.body.get("code") == "phone_not_registered":
            say("该手机号尚未注册 SudoCloud。")
            if ask("现在用邀请码注册？(y/n)", "y").lower().startswith("y"):
                return phone_register(origin, phone)
            raise Abort("未登录") from None
        raise Abort(f"登录失败：{hc.error_message(err.body)}") from None
    return resp.get("data") or resp


def phone_register(origin: str, phone: str | None = None) -> dict:
    phone = phone or ask("手机号")
    invitation = ask("邀请码")
    nickname = ask("昵称（显示名）")
    send_code(origin, phone)
    code = ask_secret("短信验证码")
    try:
        resp = cloud_post(origin, "/api/v1/auth/register", {
            "phone": phone, "code": code, "nickname": nickname, "invitation_code": invitation})
    except hc.HttpError as err:
        raise Abort(f"注册失败：{hc.error_message(err.body)}") from None
    say("注册成功，已开通 SudoRouter 账户。")
    return resp.get("data") or resp


RUNTIME_HINT = {
    "policy_denied": "你所在的组织未允许本地运行，请联系组织管理员。",
    "provider_unavailable": "SudoCloud 尚未为你的组织配置模型服务，请联系我们。",
    "models_unavailable": "账户当前没有可用模型，可能是余额不足。请到 SudoCloud 网页充值后重试。",
    "credential_pending": "SudoRouter 账户仍在开通中。",
}


def resolve_runtime(origin: str, data: dict) -> dict:
    token = data.get("access_token")
    for attempt in range(4):
        status = (data.get("localRuntime") or {}).get("status")
        if status == "ready" and data.get("sudorouter_key"):
            return data
        say(RUNTIME_HINT.get(status or "", f"SudoCloud 返回状态：{status}"))
        if status != "credential_pending" or not token or attempt == 3:
            break
        time.sleep(3)
        data = {**hc.http_json("GET", f"{origin}/api/v1/client/local-runtime", token=token), "access_token": token}
    raise Abort("未能从 SudoCloud 获取可用的 SudoRouter Key。")


def saved_cloud_runtime(p: dict[str, Path], origin: str) -> dict | None:
    """Return a ready local-runtime from the saved SudoCloud session, refreshing it once."""
    saved = hc.read_json(p["secrets"] / "sudocloud.json") or {}
    if saved.get("origin") != origin or not saved.get("access_token"):
        return None
    token = saved["access_token"]
    try:
        data = hc.http_json("GET", f"{origin}/api/v1/client/local-runtime", token=token)
    except hc.HttpError as err:
        if err.status != 401 or not saved.get("refresh_token"):
            return None
        try:
            fresh = hc.http_json("POST", f"{origin}/api/v1/auth/login",
                                 {"grant_type": "refresh_token", "refresh_token": saved["refresh_token"]})
        except (hc.HttpError, OSError):
            return None
        fresh = fresh.get("data") or fresh
        token = fresh.get("access_token")
        if not token:
            return None
        saved.update(access_token=token, refresh_token=fresh.get("refresh_token") or saved["refresh_token"],
                     saved_at=hc.utc_now())
        hc.write_private_json(p["secrets"] / "sudocloud.json", saved)
        data = fresh if fresh.get("sudorouter_key") else hc.http_json(
            "GET", f"{origin}/api/v1/client/local-runtime", token=token)
    except OSError:
        return None
    return {**data, "access_token": token, "refresh_token": saved.get("refresh_token")}


def obtain_credentials(p: dict[str, Path], lock: dict[str, Any], args) -> dict:
    origin = (args.cloud or lock["sudocloud"]["origin"]).rstrip("/")
    env_key = os.environ.get("SUDOROUTER_API_KEY", "").strip()
    if env_key:
        say("使用环境变量 SUDOROUTER_API_KEY 中的 Key。")
        return {"api_key": env_key, "source": "env", "cloud_origin": origin}
    if not args.relogin and not args.manual_key:
        data = saved_cloud_runtime(p, origin)
        if data and (data.get("localRuntime") or {}).get("status") == "ready" and data.get("sudorouter_key"):
            say("使用已保存的 SudoCloud 登录，无需再次输入验证码。")
            return {"api_key": data["sudorouter_key"], "source": "sudocloud", "cloud_origin": origin,
                    "cloud_base_url": data.get("model_service_url"),
                    "cloud_models": data.get("models") or [], "suggested_model": data.get("scode_auto_model")}
    if args.manual_key:
        method = 3
    else:
        say("")
        say(f"登录 SudoCloud（{origin}）以获取 SudoRouter Key：")
        method = choose("请选择", ["已有账号：手机号 + 验证码登录", "新用户：用邀请码注册", "手动粘贴 SudoRouter Key"])
    if method == 3:
        return {"api_key": ask_secret("SudoRouter Key"), "source": "manual", "cloud_origin": origin}
    data = phone_login(origin) if method == 1 else phone_register(origin)
    data = resolve_runtime(origin, data)
    hc.write_private_json(p["secrets"] / "sudocloud.json", {
        "origin": origin,
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token"),
        "user_id": (data.get("localRuntime") or {}).get("userId"),
        "organization_id": (data.get("localRuntime") or {}).get("organizationId"),
        "saved_at": hc.utc_now(),
    })
    return {
        "api_key": data["sudorouter_key"],
        "source": "sudocloud",
        "cloud_origin": origin,
        "cloud_base_url": data.get("model_service_url"),
        "cloud_models": data.get("models") or [],
        "suggested_model": data.get("scode_auto_model"),
    }


# ── 4. router verification ──────────────────────────────────────────────────

def list_models(base: str, key: str) -> list[str]:
    resp = hc.http_json("GET", f"{base}/models", token=key)
    items = resp.get("data", []) if isinstance(resp, dict) else []
    return sorted({str(item.get("id")) for item in items if isinstance(item, dict) and item.get("id")})


def insufficient_quota(err: Exception) -> bool:
    """new-api answers 403 `insufficient_user_quota` when the account balance is exhausted."""
    if not isinstance(err, hc.HttpError):
        return False
    body = err.body if isinstance(err.body, dict) else {}
    error = body.get("error") if isinstance(body.get("error"), dict) else {}
    code = str(error.get("code") or body.get("code") or "")
    return "insufficient" in code and "quota" in code or "额度不足" in hc.error_message(err.body)


def smoke_chat(base: str, key: str, model: str) -> None:
    hc.http_json("POST", f"{base}/chat/completions", {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with the single word OK."}],
        "max_tokens": 16,
    }, token=key, timeout=90)


def verify_router(lock: dict[str, Any], creds: dict, answers: dict, auto: bool,
                  router_url: str | None = None) -> dict:
    candidates = [(router_url or lock["router"]["baseUrl"]).rstrip("/")]
    cloud_url = (creds.get("cloud_base_url") or "").rstrip("/")
    if cloud_url.startswith("https://") and cloud_url not in candidates:
        candidates.append(cloud_url)
    base, models = None, []
    for candidate in candidates:
        try:
            models = hc.chat_models(list_models(candidate, creds["api_key"]))
            base = candidate
            break
        except hc.HttpError as err:
            say(f"{candidate} 拒绝了该 Key（HTTP {err.status}）：{hc.error_message(err.body)}")
        except OSError as err:
            say(f"无法连接 {candidate}：{err}")
    if not base:
        raise Abort("SudoRouter Key 验证失败。")
    if base != candidates[0]:
        say(f"注意：该 Key 属于 {base}，而不是默认的 {candidates[0]}，将使用 {base}。")
    if not models:
        raise Abort("该 Key 没有可用的对话模型。")
    preferred = answers.get("model") or creds.get("suggested_model")
    if preferred in models and (auto or ask(f"使用模型 {preferred}？(y/n)", "y").lower().startswith("y")):
        model = preferred
    elif auto:
        model = models[0]
    else:
        say("可用模型：")
        shown = models[:30]
        model = shown[choose("选择部署助手使用的模型", shown) - 1]
    while True:
        say(f"用 {model} 做一次真实调用验证……")
        try:
            smoke_chat(base, creds["api_key"], model)
            say("验证通过。")
            break
        except (hc.HttpError, OSError) as err:
            detail = hc.error_message(err.body) if isinstance(err, hc.HttpError) else str(err)
            say(f"调用失败：{detail}")
            if insufficient_quota(err):
                # The key is valid; the account has no balance. Changing models will not help.
                say(f"SudoRouter Key 有效，但账户余额不足。请在 SudoCloud（{creds.get('cloud_origin', '')}）充值，"
                    "或联系管理员分配额度。")
                if auto or ask("充值完成后按回车重试，输入 q 退出", "").lower().startswith("q"):
                    raise Abort("账户余额不足。充值后重新运行向导即可，无需再次登录。") from None
                continue
            if isinstance(err, hc.HttpError) and err.status in (402, 429):
                say("可能是额度受限或请求过于频繁。")
            if auto or not ask("换一个模型重试？(y/n)", "y").lower().startswith("y"):
                raise Abort("模型调用验证失败。") from None
            model = models[choose("选择模型", models[:30]) - 1]
    return {"base_url": base, "models": models, "default_model": model}


# ── 5. configuration ────────────────────────────────────────────────────────

def sync_runtime(p: dict[str, Path], answers_file: Path | None) -> None:
    runtime = p["runtime"]
    staging = Path(tempfile.mkdtemp(dir=str(p["root"]), prefix=".runtime-"))
    for name in ("lib", "hooks", "agent"):
        shutil.copytree(PROFILE_DIR / name, staging / name,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(PROFILE_DIR / "bootstrap.lock.json", staging / "bootstrap.lock.json")
    if runtime.exists():
        shutil.rmtree(runtime)
    os.replace(staging, runtime)

    ws = p["workspace"]
    shutil.copy2(runtime / "agent" / "AGENTS.md", ws / "AGENTS.md")
    actions = ws / "actions"
    actions.mkdir(exist_ok=True)
    wrapper = actions / "ops"
    wrapper.write_text(
        "#!/bin/sh\n"
        f"SUDOPRIVATE_STATE={shlex.quote(str(p['root']))} "
        f"exec {shlex.quote(sys.executable)} -I {shlex.quote(str(runtime / 'lib' / 'ops.py'))} \"$@\"\n"
    )
    wrapper.chmod(0o755)
    if answers_file:
        shutil.copy2(answers_file, ws / "answers.json")


def read_only_allow_rules() -> list[str]:
    """Pre-approve read-only actions so semi-auto mode prompts only for changes.
    Safe as prefix rules because the guard hook rejects any shell syntax."""
    return [f"bash({entry} {action}:*)" for action in hc.READ_ONLY_ACTIONS
            for entry in ("actions/ops", "./actions/ops")]


def write_scode_config(p: dict[str, Path], router: dict, api_key: str, mode: str) -> None:
    home = p["scode_home"]
    config_path = home / "sudocode.json"
    config = hc.read_json(config_path, {}) or {}
    config.setdefault("auth_modes", {}).setdefault("proxy", {})[ACCOUNT] = {
        "baseUrl": router["base_url"], "apiKey": api_key}
    hc.write_private_json(config_path, config)
    guard = (f"SUDOPRIVATE_WORKSPACE={shlex.quote(str(p['workspace']))} "
             f"SUDOPRIVATE_STATE={shlex.quote(str(p['root']))} "
             f"{shlex.quote(sys.executable)} -I {shlex.quote(str(p['runtime'] / 'hooks' / 'guard.py'))}")
    hc.write_private_json(home / "settings.json", {
        "auth_profile": ACCOUNT,
        "model": router["default_model"],
        "hooks": {"PreToolUse": [guard]},
        "permissions": {"defaultMode": mode, "allow": read_only_allow_rules()},
    })


def launch_argv(scode: Path, p: dict[str, Path], router: dict, mode: str) -> list[str]:
    agent = p["runtime"] / "agent"
    return [
        str(scode),
        "--auth", "proxy",
        "--account", ACCOUNT,
        "--model", router["default_model"],
        "--permission-mode", mode,
        "--allowedTools", ALLOWED_TOOLS,
        "--system-prompt", (agent / "system-prompt.md").read_text(encoding="utf-8"),
        "--append-system-prompt", (agent / "scope-rules.md").read_text(encoding="utf-8"),
    ]


def launch_env(p: dict[str, Path]) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in STRIP_ENV}
    env["SCODE_GLOBAL_CONFIG_DIR"] = str(p["scode_home"])
    env["SUDOPRIVATE_STATE"] = str(p["root"])
    env["SUDOPRIVATE_WORKSPACE"] = str(p["workspace"])
    return env


# ── main ────────────────────────────────────────────────────────────────────

def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SudoCode hosted-linux 部署向导")
    parser.add_argument("--auto", action="store_true", help="全自动：只确认一次部署方案（danger-full-access + guard）")
    parser.add_argument("--answers", help="预填的 answers.json（非机密信息）")
    parser.add_argument("--cloud", help="SudoCloud 地址（默认取 bootstrap.lock.json）")
    parser.add_argument("--model", help="部署助手和 Mosswork 默认使用的模型")
    parser.add_argument("--router-url", help="SudoRouter 地址（默认取 bootstrap.lock.json 的 router.baseUrl）")
    parser.add_argument("--manual-key", action="store_true", help="跳过 SudoCloud 登录，手动粘贴 SudoRouter Key")
    parser.add_argument("--relogin", action="store_true", help="忽略已保存的凭证，重新登录")
    parser.add_argument("--scode", help="开发用：使用指定的 scode 可执行文件")
    parser.add_argument("--skip-launch", action="store_true", help="只完成配置，不启动对话")
    parser.add_argument("--continue", dest="resume", action="store_true", help="继续上一次的部署对话")
    parser.add_argument("--prompt", help="自动化用：发送一条消息并以非交互方式运行一轮（需配合 --auto）")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    p = hc.paths()
    hc.ensure_dirs(p)
    lock = hc.load_lock(PROFILE_DIR)
    answers_file = Path(args.answers).expanduser().resolve() if args.answers else None
    answers = json.loads(answers_file.read_text(encoding="utf-8")) if answers_file else {}
    if args.model:
        answers["model"] = args.model
    mode = "danger-full-access" if args.auto else "workspace-write"
    if not args.prompt:
        say("SudoCode 部署向导（托管 SudoRouter · Linux 单机 Mosswork）")
        say(f"数据目录：{p['root']}")
    try:
        preflight()
        scode = ensure_scode(p, lock, args.scode)
        saved = hc.read_json(p["secrets"] / "router.json")
        router = None
        if saved and not args.relogin:
            try:
                models = hc.chat_models(list_models(saved["base_url"], saved["api_key"]))
                if args.model and args.model in models:
                    saved["default_model"] = args.model
                    hc.write_private_json(p["secrets"] / "router.json", saved)
                if saved.get("default_model") in models:
                    router = {**saved, "models": models}
                    if not args.prompt:
                        say(f"使用已保存的 SudoRouter 凭证（{saved['base_url']}，模型 {saved['default_model']}）。")
            except (hc.HttpError, OSError, KeyError):
                say("已保存的 SudoRouter 凭证不可用，需要重新登录。")
        if router is None:
            creds = obtain_credentials(p, lock, args)
            router = verify_router(lock, creds, answers, args.auto, args.router_url)
            hc.write_private_json(p["secrets"] / "router.json", {
                **router, "api_key": creds["api_key"], "source": creds["source"], "verified_at": hc.utc_now()})
            router = {**router, "api_key": creds["api_key"]}
        sync_runtime(p, answers_file)
        write_scode_config(p, router, router["api_key"], mode)
    except Abort as err:
        say(f"\n已中止：{err}")
        return 1
    except KeyboardInterrupt:
        say("\n已取消。")
        return 130
    argv_ = launch_argv(scode, p, router, mode)
    if args.resume:
        argv_ += ["--resume", "latest"]
    if args.prompt:
        # One non-interactive turn (automation / e2e). Approvals cannot be
        # answered in print mode, so this is only useful together with --auto.
        argv_ += ["-p", args.prompt]
    else:
        say("")
        say(f"配置完成。部署助手将在 {p['workspace']} 启动（{'全自动' if args.auto else '半自动：改动系统的操作逐条确认'}）。")
        say("在对话中输入「开始部署」即可。输入 /exit 退出；之后可随时重新运行本向导继续。")
    if args.skip_launch:
        return 0
    os.chdir(p["workspace"])
    os.execve(argv_[0], argv_, launch_env(p))
    return 0


if __name__ == "__main__":
    sys.exit(main())
