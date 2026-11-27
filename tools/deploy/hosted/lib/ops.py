"""Fixed operations the SudoCode ops agent may run (`actions/ops <action>`).

Each action is deterministic, prints a short human summary for the agent and
writes a JSON receipt under <state>/operations. Secrets (router key, Mosswork
admin password) are read and written by these scripts directly and are never
printed, so they never enter the model conversation.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hosted_common as hc  # noqa: E402

RUNTIME = Path(__file__).resolve().parent.parent
HOST_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$|^\[?[0-9A-Fa-f:]+\]?$")
USER_RE = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$", re.I)
JOB_RE = re.compile(r"^[a-z][a-z0-9-]{1,40}$")
FP_RE = re.compile(r"^SHA256:[A-Za-z0-9+/=]{20,}$")
MAX_WAIT = 90


class OpsError(Exception):
    pass


def out(line: str = "") -> None:
    print(line, flush=True)


def require_target(p: dict[str, Path]) -> dict[str, Any]:
    target = hc.load_target(p)
    if not target:
        raise OpsError("尚未选择部署目标。请先运行：ops authorize --local 或 ops authorize --host <主机> --user <用户>")
    return target


def target_label(target: dict[str, Any]) -> str:
    if target.get("mode") == "local":
        return "本机"
    return f"{target['user']}@{target['host']}:{target.get('port', 22)}"


def remote(p, target, script: str, *, timeout: float = 600, data: str | None = None,
           check: bool = True) -> subprocess.CompletedProcess:
    payload = (f"SUDOPRIVATE_DATA={shlex.quote(data)}\n" if data is not None else "") + script
    if target.get("mode") == "local":
        cmd = ["bash", "-s"]
    else:
        cmd = hc.ssh_base(p, target) + ["bash -s"]
    proc = subprocess.run(cmd, input=payload, text=True, capture_output=True, timeout=timeout)
    if check and proc.returncode != 0:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-8:]
        raise OpsError("目标机命令失败（退出码 %d）：\n%s" % (proc.returncode, "\n".join(tail)))
    return proc


# ── authorize ───────────────────────────────────────────────────────────────

def ensure_keypair(p) -> str:
    key = p["ssh"] / "id_ed25519"
    if not key.exists():
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "sudoprivate-bootstrap",
                        "-f", str(key)], check=True)
    return (p["ssh"] / "id_ed25519.pub").read_text().strip()


def scan_host_keys(host: str, port: int) -> list[tuple[str, str]]:
    proc = subprocess.run(["ssh-keyscan", "-T", "10", "-p", str(port), host],
                          text=True, capture_output=True, timeout=30)
    lines = [l for l in proc.stdout.splitlines() if l.strip() and not l.startswith("#")]
    if not lines:
        raise OpsError(f"无法连接 {host}:{port} 获取主机公钥，请检查地址、端口和网络。")
    result = []
    for line in lines:
        fp = subprocess.run(["ssh-keygen", "-lf", "-"], input=line + "\n", text=True,
                            capture_output=True).stdout.split()
        if len(fp) >= 2:
            result.append((fp[1], line))
    return result


def act_authorize(p, a) -> dict[str, Any]:
    if a.local:
        uid = subprocess.run(["id", "-u"], text=True, capture_output=True).stdout.strip()
        target = {"mode": "local", "is_root": uid == "0", "host": "127.0.0.1"}
        hc.write_private_json(p["target"], target)
        out("部署目标已设为本机。")
        return {"target": "local"}
    if not a.host or not a.user:
        raise OpsError("远程目标需要 --host 和 --user（或使用 --local）。")
    if not HOST_RE.match(a.host) or not USER_RE.match(a.user):
        raise OpsError("主机名或用户名格式无效。")
    port = int(a.port)
    scanned = scan_host_keys(a.host, port)
    if not a.fingerprint:
        out(f"目标主机 {a.host}:{port} 的主机公钥指纹：")
        for fp, line in scanned:
            out(f"  {line.split()[1]:<22} {fp}")
        out("")
        out("请用户核对指纹（例如在目标机上运行 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub）。")
        out(f"确认无误后运行：ops authorize --host {a.host} --user {a.user} --port {port} --fingerprint <上面的 SHA256:...>")
        return {"stage": "fingerprint_pending", "fingerprints": [fp for fp, _ in scanned]}
    if not FP_RE.match(a.fingerprint):
        raise OpsError("指纹格式应为 SHA256:...")
    if a.fingerprint not in {fp for fp, _ in scanned}:
        raise OpsError("指纹与目标主机当前提供的公钥不一致，已中止。可能是地址错误或存在中间人。")
    known = p["ssh"] / "known_hosts"
    existing = known.read_text().splitlines() if known.exists() else []
    lines = existing + [line for _, line in scanned if line not in existing]
    known.write_text("\n".join(lines) + "\n")
    known.chmod(0o600)

    pub = ensure_keypair(p)
    target = {"mode": "ssh", "host": a.host, "user": a.user, "port": port}
    probe = "id -u"
    proc = subprocess.run(hc.ssh_base(p, target) + [probe], text=True, capture_output=True, timeout=30)
    if proc.returncode != 0:
        # Fall back to the user's own SSH identities/agent, then install our key.
        fallback = subprocess.run(hc.ssh_base(p, target, own_key=False) + ["bash -s"],
                                  input=("umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; "
                                         f"grep -qxF {shlex.quote(pub)} ~/.ssh/authorized_keys || "
                                         f"echo {shlex.quote(pub)} >> ~/.ssh/authorized_keys\n"),
                                  text=True, capture_output=True, timeout=30)
        if fallback.returncode == 0:
            proc = subprocess.run(hc.ssh_base(p, target) + [probe], text=True, capture_output=True, timeout=30)
    if proc.returncode != 0:
        pubfile = p["ssh"] / "id_ed25519.pub"
        out("无法用密钥登录目标机。请用户在另一个终端（不要在本对话中输入密码）运行：")
        out(f"  ssh-copy-id -i {pubfile} -p {port} -o UserKnownHostsFile={known} {a.user}@{a.host}")
        out("完成后再次运行同一条 ops authorize 命令。")
        return {"stage": "key_install_required"}
    target["is_root"] = proc.stdout.strip() == "0"
    hc.write_private_json(p["target"], target)
    out(f"已授权部署目标 {target_label(target)}（{'root' if target['is_root'] else '普通用户，需要免密 sudo'}）。")
    return {"stage": "authorized", "target": target_label(target), "is_root": target["is_root"]}


# ── inspect ─────────────────────────────────────────────────────────────────

PROBE = r"""
set +e
kv(){ printf '%s=%s\n' "$1" "$2"; }
kv os "$(uname -s)"
kv arch "$(uname -m)"
kv kernel "$(uname -r)"
if [ -r /etc/os-release ]; then . /etc/os-release; kv distro "${PRETTY_NAME:-}"; fi
kv cpus "$(getconf _NPROCESSORS_ONLN 2>/dev/null)"
kv mem_kb "$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)"
d=/opt; [ -d /opt ] || d=/
kv disk_free_kb "$(df -Pk "$d" 2>/dev/null | awk 'NR==2{print $4}')"
if [ "$(id -u)" = 0 ]; then kv sudo root; elif sudo -n true 2>/dev/null; then kv sudo nopasswd; else kv sudo password_required; fi
kv docker "$(docker --version 2>/dev/null)"
kv compose "$( (docker compose version 2>/dev/null || sudo -n docker compose version 2>/dev/null) | head -1)"
kv docker_running "$( (docker info >/dev/null 2>&1 || sudo -n docker info >/dev/null 2>&1) && echo yes || echo no)"
for t in curl tar sha256sum; do kv "has_$t" "$(command -v $t >/dev/null && echo yes || echo no)"; done
if command -v ss >/dev/null; then kv port_busy "$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -c ":$PORT\$")"; fi
kv router_http "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$ROUTER/models")"
kv github_http "$(curl -s -o /dev/null -m 10 -w '%{http_code}' https://github.com)"
kv existing_install "$( [ -e "$INSTALL_DIR/current" ] && echo yes || echo no)"
kv time_utc "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
"""


def evaluate(facts: dict[str, str], lock: dict[str, Any], port: int) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []

    def add(name: str, status: str, detail: str) -> None:
        checks.append({"check": name, "status": status, "detail": detail})

    add("系统", "ok" if facts.get("os") == "Linux" else "fail",
        f"{facts.get('distro') or facts.get('os')}（Mosswork Server 需要 Linux）")
    arch = facts.get("arch", "")
    add("架构", "ok" if arch in lock["mosswork"]["targetArch"] else "fail",
        f"{arch}（MVP 只支持 amd64；arm64 镜像尚未发布）")
    sudo = facts.get("sudo")
    add("权限", "ok" if sudo in ("root", "nopasswd") else "fail",
        {"root": "root", "nopasswd": "免密 sudo"}.get(sudo or "", "sudo 需要密码；MVP 需要 root 或免密 sudo"))
    docker = facts.get("docker", "")
    compose = facts.get("compose", "")
    add("Docker", "ok" if docker and compose else "warn",
        f"{docker or '未安装'}；{compose or 'Compose v2 未安装'}" + ("" if docker and compose else "（可运行 ops docker-install）"))
    if docker and compose and facts.get("docker_running") != "yes":
        add("Docker 服务", "fail", "Docker 已安装但服务未运行（需要在目标机上执行 sudo systemctl start docker）")
    for tool in ("curl", "tar", "sha256sum"):
        if facts.get(f"has_{tool}") != "yes":
            add(f"工具 {tool}", "fail", "缺失")
    mem_gb = int(facts.get("mem_kb") or 0) / 1024 / 1024
    add("内存", "ok" if mem_gb >= 8 else "warn", f"{mem_gb:.1f} GiB（建议 ≥ 8 GiB）")
    disk_gb = int(facts.get("disk_free_kb") or 0) / 1024 / 1024
    add("磁盘", "ok" if disk_gb >= 30 else ("warn" if disk_gb >= 15 else "fail"),
        f"/opt 可用 {disk_gb:.0f} GiB（建议 ≥ 30 GiB）")
    if facts.get("port_busy", "0") not in ("", "0") and facts.get("existing_install") != "yes":
        add("端口", "warn", f"{port} 已被占用，需要换一个端口")
    router = facts.get("router_http", "000")
    add("SudoRouter 连通", "ok" if router in ("200", "401") else "fail",
        f"{lock['router']['baseUrl']} → HTTP {router}")
    gh = facts.get("github_http", "000")
    add("下载源连通", "ok" if gh.startswith(("2", "3")) else "fail", f"github.com → HTTP {gh}")
    if facts.get("existing_install") == "yes":
        add("已有安装", "warn", f"{lock['mosswork']['installDir']} 已存在 Mosswork，安装时需加 --upgrade 或换目录")
    return checks


def act_inspect(p, a) -> dict[str, Any]:
    target = require_target(p)
    lock = hc.load_lock(RUNTIME)
    port = int(a.port or lock["mosswork"]["defaultPort"])
    env = (f"PORT={port}\nROUTER={shlex.quote(lock['router']['baseUrl'])}\n"
           f"INSTALL_DIR={shlex.quote(lock['mosswork']['installDir'])}\n")
    proc = remote(p, target, env + PROBE, timeout=90)
    facts = dict(line.split("=", 1) for line in proc.stdout.splitlines() if "=" in line)
    checks = evaluate(facts, lock, port)
    out(f"目标 {target_label(target)} 检查结果：")
    icon = {"ok": "✓", "warn": "!", "fail": "✗"}
    for c in checks:
        out(f"  {icon[c['status']]} {c['check']}: {c['detail']}")
    blocking = [c for c in checks if c["status"] == "fail"]
    out("")
    out("结论：" + ("可以部署。" if not blocking else f"有 {len(blocking)} 项不满足，需先处理。"))
    if not blocking:
        target["is_root"] = facts.get("sudo") == "root"
        target["inspected"] = {"arch": facts.get("arch"), "docker": facts.get("docker_running") == "yes"}
        hc.write_private_json(p["target"], target)
    return {"facts": facts, "checks": checks, "deployable": not blocking, "_ok": not blocking}


# ── jobs ────────────────────────────────────────────────────────────────────

JOB_START = r"""
J="$HOME/.sudoprivate-bootstrap/jobs/$JOB"
if [ -f "$J/pid" ] && [ ! -f "$J/rc" ] && kill -0 "$(cat "$J/pid")" 2>/dev/null; then
  echo "already_running"; exit 0
fi
mkdir -p "$J"; rm -f "$J/rc" "$J/log"
printf '%s\n' "$SUDOPRIVATE_DATA" > "$J/run.sh"
cat > "$J/wrap.sh" <<'WRAP'
J="$1"; bash "$J/run.sh"; echo $? > "$J/rc"
WRAP
if command -v setsid >/dev/null; then L=setsid; else L=; fi
nohup $L bash "$J/wrap.sh" "$J" > "$J/log" 2>&1 < /dev/null &
echo $! > "$J/pid"
echo "started"
"""

JOB_STATUS = r"""
J="$HOME/.sudoprivate-bootstrap/jobs/$JOB"
[ -d "$J" ] || { echo "state=missing"; exit 0; }
if [ -f "$J/rc" ]; then echo "state=finished"; echo "rc=$(cat "$J/rc")";
elif [ -f "$J/pid" ] && kill -0 "$(cat "$J/pid")" 2>/dev/null; then echo "state=running";
else echo "state=lost"; fi
echo "---log---"
tail -n "$LINES" "$J/log" 2>/dev/null | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g'
"""


def start_job(p, target, name: str, script: str) -> str:
    proc = remote(p, target, f"JOB={name}\n" + JOB_START, data=script, timeout=60)
    return proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "unknown"


def job_status(p, target, name: str, lines: int = 25) -> tuple[str, int | None, str]:
    proc = remote(p, target, f"JOB={name}\nLINES={lines}\n" + JOB_STATUS, timeout=60)
    head, _, log = proc.stdout.partition("---log---\n")
    kv = dict(l.split("=", 1) for l in head.splitlines() if "=" in l)
    rc = int(kv["rc"]) if kv.get("rc", "").strip().lstrip("-").isdigit() else None
    return kv.get("state", "unknown"), rc, log.rstrip()


def act_job_status(p, a) -> dict[str, Any]:
    if not JOB_RE.match(a.name):
        raise OpsError("任务名无效")
    target = require_target(p)
    deadline = time.time() + min(max(int(a.wait or 0), 0), MAX_WAIT)
    while True:
        state, rc, log = job_status(p, target, a.name)
        if state != "running" or time.time() >= deadline:
            break
        time.sleep(5)
    label = {"running": "进行中", "finished": "已结束", "missing": "不存在", "lost": "进程已退出但无结果"}.get(state, state)
    out(f"任务 {a.name}：{label}" + (f"，退出码 {rc}" if rc is not None else ""))
    if log:
        out("最近日志：")
        out(log)
    if state == "running":
        out(f"\n仍在进行。稍后运行：ops job-status {a.name} --wait {MAX_WAIT}")
    done_ok = state == "finished" and rc == 0
    if done_ok and a.name == "mosswork-install":
        target = require_target(p)
        pending = target.get("mosswork_pending")
        if pending:
            target["mosswork"] = pending
            target.pop("mosswork_pending", None)
            hc.write_private_json(p["target"], target)
    return {"job": a.name, "state": state, "rc": rc, "_ok": done_ok or state == "running",
            "_receipt": state != "running"}


def act_docker_install(p, a) -> dict[str, Any]:
    target = require_target(p)
    lock = hc.load_lock(RUNTIME)
    have = remote(p, target, "docker --version 2>/dev/null && (docker compose version 2>/dev/null || sudo -n docker compose version)",
                  check=False, timeout=60)
    if have.returncode == 0 and "Compose" in have.stdout:
        out("目标机已安装 Docker 和 Compose v2，无需安装。")
        return {"skipped": True}
    sudo = hc.sudo_prefix(target)
    mirror = " --mirror Aliyun" if a.mirror == "aliyun" else ""
    script = (
        "set -euo pipefail\n"
        f"curl -fsSL --retry 3 {shlex.quote(lock['docker']['installerUrl'])} -o /tmp/sudoprivate-get-docker.sh\n"
        f"{sudo}sh /tmp/sudoprivate-get-docker.sh{mirror}\n"
        f"{sudo}systemctl enable --now docker || true\n"
        f"{sudo}docker compose version\n"
    )
    state = start_job(p, target, "docker-install", script)
    out(f"Docker 安装任务：{state}。运行 ops job-status docker-install --wait {MAX_WAIT} 查看进度。")
    return {"job": "docker-install", "state": state, "_receipt": False}


def act_mosswork_install(p, a) -> dict[str, Any]:
    target = require_target(p)
    lock = hc.load_lock(RUNTIME)
    mw = lock["mosswork"]
    port = int(a.port or mw["defaultPort"])
    if not (1 <= port <= 65535):
        raise OpsError("端口无效")
    try:
        socket.inet_pton(socket.AF_INET6 if ":" in a.bind else socket.AF_INET, a.bind)
    except OSError:
        raise OpsError("监听地址无效") from None
    sudo = hc.sudo_prefix(target)
    extra = " --upgrade" if a.upgrade else ""
    script = (
        "set -euo pipefail\n"
        'cd "$(mktemp -d)"\n'
        f"curl -fsSL --retry 3 -o install-moss-server.sh {shlex.quote(mw['installerUrl'])}\n"
        f"echo '{mw['installerSha256']}  install-moss-server.sh' | sha256sum -c -\n"
        f"{sudo}bash install-moss-server.sh --version {shlex.quote(mw['version'])} "
        f"--install-dir {shlex.quote(mw['installDir'])} --port {port} --bind {shlex.quote(a.bind)}{extra}\n"
    )
    target["mosswork_pending"] = {"version": mw["version"], "port": port, "bind": a.bind, "installDir": mw["installDir"]}
    hc.write_private_json(p["target"], target)
    state = start_job(p, target, "mosswork-install", script)
    out(f"Mosswork {mw['version']} 安装任务：{state}（端口 {port}，监听 {a.bind}）。")
    out(f"首次安装需要下载约数 GB 镜像。运行 ops job-status mosswork-install --wait {MAX_WAIT} 查看进度。")
    return {"job": "mosswork-install", "state": state, "port": port, "bind": a.bind, "_receipt": False}


# ── Mosswork API access ─────────────────────────────────────────────────────

class Tunnel:
    """Local port forward to the target's loopback Mosswork port."""

    def __init__(self, p, target, port: int):
        self.p, self.target, self.port = p, target, port
        self.proc: subprocess.Popen | None = None
        self.base = f"http://127.0.0.1:{port}"

    def __enter__(self) -> "Tunnel":
        if self.target.get("mode") == "local":
            return self
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            local = s.getsockname()[1]
        args = hc.ssh_base(self.p, self.target)
        args[1:1] = ["-N", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{local}:127.0.0.1:{self.port}"]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(50):
            if self.proc.poll() is not None:
                raise OpsError("SSH 端口转发失败：" + (self.proc.stderr.read().decode()[-300:] if self.proc.stderr else ""))
            try:
                with socket.create_connection(("127.0.0.1", local), timeout=0.5):
                    break
            except OSError:
                time.sleep(0.2)
        self.base = f"http://127.0.0.1:{local}"
        return self

    def __exit__(self, *exc) -> None:
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def mosswork_info(target) -> dict[str, Any]:
    info = target.get("mosswork")
    if not info:
        raise OpsError("尚未完成 Mosswork 安装（先运行 ops mosswork-install，并等待 job-status 显示成功）。")
    return info


def admin_credentials(p, target, info) -> dict[str, str]:
    cached = hc.read_json(p["secrets"] / "mosswork-admin.json")
    if cached and cached.get("username") and cached.get("password"):
        return cached
    path = shlex.quote(info["installDir"] + "/initial-admin.json")
    proc = remote(p, target, f"{hc.sudo_prefix(target)}cat {path}", timeout=30)
    creds = json.loads(proc.stdout)
    hc.write_private_json(p["secrets"] / "mosswork-admin.json", {
        "username": creds["username"], "password": creds["password"], "source": "initial-admin.json"})
    return creds


def mosswork_login(base: str, creds) -> str:
    try:
        resp = hc.http_json("POST", f"{base}/api/auth/login",
                            {"username": creds["username"], "password": creds["password"]})
    except hc.HttpError as err:
        raise OpsError(f"Mosswork 管理员登录失败（HTTP {err.status}）：{hc.error_message(err.body)}。"
                       "如果已修改过初始密码，请用户在 Web 界面手动配置模型。") from None
    return resp["access_token"]


def act_mosswork_configure(p, a) -> dict[str, Any]:
    target = require_target(p)
    info = mosswork_info(target)
    router = hc.read_json(p["secrets"] / "router.json")
    if not router or not router.get("api_key"):
        raise OpsError("没有找到 SudoRouter 凭证。请退出并重新运行 Start.command 完成登录。")
    models = hc.chat_models(router.get("models") or [])
    model = a.model or router.get("default_model") or (models[0] if models else None)
    if not model or (models and model not in models):
        raise OpsError(f"模型 {model} 不在可用列表中。可选：{', '.join(models[:30])}")
    chosen = models if a.all_models else [model]
    body = {
        "kind": "openai",
        "base_url": router["base_url"],
        "api_key": router["api_key"],
        "models": [{"id": m, "name": m, "enabled": True, "input": ["text"]} for m in chosen],
        "note": "Configured by SudoCode hosted bootstrap (SudoRouter)",
    }
    creds = admin_credentials(p, target, info)
    with Tunnel(p, target, info["port"]) as tunnel:
        token = mosswork_login(tunnel.base, creds)
        providers = hc.http_json("GET", f"{tunnel.base}/api/admin/providers", token=token) or []
        existing = next((x for x in providers if x.get("name") == a.provider_name), None)
        if existing:
            row = hc.http_json("PATCH", f"{tunnel.base}/api/admin/providers/{existing['id']}", body, token=token)
        else:
            row = hc.http_json("POST", f"{tunnel.base}/api/admin/providers", {"name": a.provider_name, **body}, token=token)
        hc.http_json("PUT", f"{tunnel.base}/api/providers/active-model",
                     {"provider_name": a.provider_name, "model": model}, token=token)
    out(f"已在 Mosswork 中{'更新' if existing else '创建'}模型服务「{a.provider_name}」：{router['base_url']}")
    out(f"已启用模型 {len(chosen)} 个，默认模型 {model}。")
    return {"provider_id": row.get("id"), "provider": a.provider_name, "base_url": router["base_url"],
            "models": chosen, "active_model": model, "updated": bool(existing)}


def act_healthcheck(p, a) -> dict[str, Any]:
    target = require_target(p)
    info = mosswork_info(target)
    creds = admin_credentials(p, target, info)
    with Tunnel(p, target, info["port"]) as tunnel:
        token = mosswork_login(tunnel.base, creds)
        active = hc.http_json("GET", f"{tunnel.base}/api/providers/active-model", token=token) or {}
        providers = hc.http_json("GET", f"{tunnel.base}/api/admin/providers", token=token) or []
        row = next((x for x in providers if x.get("name") == active.get("provider_name")), None)
        if not row:
            raise OpsError("Mosswork 中没有配置默认模型服务，请先运行 ops mosswork-configure。")
        test = hc.http_json("POST", f"{tunnel.base}/api/admin/providers/{row['id']}/test",
                            {"model_id": active.get("model")}, token=token, timeout=90)
    ok = bool(test.get("ok", test.get("success", True))) if isinstance(test, dict) else True
    host = target.get("host", "127.0.0.1")
    url = f"http://{host}:{info['port']}"
    direct = None
    if target.get("mode") != "local":
        try:
            with socket.create_connection((host, info["port"]), timeout=5):
                direct = True
        except OSError:
            direct = False
    out(f"Mosswork 服务：正常（管理员可登录）")
    out(f"模型调用测试（{active.get('provider_name')}/{active.get('model')}）：{'通过' if ok else '失败'}")
    if not ok:
        out("  详情：" + json.dumps(test, ensure_ascii=False)[:400])
    out(f"访问地址：{url}" + ("" if direct in (None, True) else "（本机无法直连该端口，需开放防火墙或使用反向代理）"))
    out(f"管理员账号：{creds['username']}；密码保存在 {p['secrets'] / 'mosswork-admin.json'}，"
        "请用户自己查看（cat），首次登录后修改密码。")
    return {"url": url, "direct_reachable": direct, "model_test": test, "_ok": ok}


def act_status(p, a) -> dict[str, Any]:
    target = hc.load_target(p)
    router = hc.read_json(p["secrets"] / "router.json") or {}
    out(f"部署目标：{target_label(target) if target else '未设置'}")
    out(f"SudoRouter：{router.get('base_url', '未配置')}，默认模型 {router.get('default_model', '-')}，"
        f"可用模型 {len(hc.chat_models(router.get('models') or []))} 个")
    if target and target.get("mosswork"):
        m = target["mosswork"]
        out(f"Mosswork：{m['version']} 已安装，端口 {m['port']}")
    elif target and target.get("mosswork_pending"):
        out("Mosswork：安装中或未完成（ops job-status mosswork-install）")
    else:
        out("Mosswork：未安装")
    latest: dict[str, dict] = {}
    for f in sorted(p["operations"].glob("*.json")):
        r = hc.read_json(f) or {}
        latest[r.get("action", "?")] = r
    if latest:
        out("最近操作：" + "，".join(f"{k}={'成功' if v.get('ok') else '失败'}" for k, v in latest.items()))
    return {"_receipt": False}


def act_receipts(p, a) -> dict[str, Any]:
    files = sorted(p["operations"].glob("*.json"))[-int(a.last):]
    for f in files:
        r = hc.read_json(f) or {}
        out(f"{r.get('finishedAt')}  {r.get('action'):<20} {'成功' if r.get('ok') else '失败'}  {f.name}")
    if not files:
        out("暂无操作回执。")
    return {"_receipt": False}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ops", description="SudoCode hosted-linux 部署动作")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("status")
    s = sub.add_parser("authorize")
    s.add_argument("--local", action="store_true")
    s.add_argument("--host")
    s.add_argument("--user")
    s.add_argument("--port", default="22")
    s.add_argument("--fingerprint")
    s = sub.add_parser("inspect")
    s.add_argument("--port")
    s = sub.add_parser("docker-install")
    s.add_argument("--mirror", choices=["default", "aliyun"], default="default")
    s = sub.add_parser("mosswork-install")
    s.add_argument("--port")
    s.add_argument("--bind", default="0.0.0.0")
    s.add_argument("--upgrade", action="store_true")
    s = sub.add_parser("job-status")
    s.add_argument("name")
    s.add_argument("--wait", default="0")
    s = sub.add_parser("mosswork-configure")
    s.add_argument("--model")
    s.add_argument("--all-models", action="store_true")
    s.add_argument("--provider-name", default="sudorouter")
    sub.add_parser("healthcheck")
    s = sub.add_parser("receipts")
    s.add_argument("--last", default="10")
    return parser


HANDLERS: dict[str, Callable[[Any, Any], dict[str, Any]]] = {
    "status": act_status,
    "authorize": act_authorize,
    "inspect": act_inspect,
    "docker-install": act_docker_install,
    "mosswork-install": act_mosswork_install,
    "job-status": act_job_status,
    "mosswork-configure": act_mosswork_configure,
    "healthcheck": act_healthcheck,
    "receipts": act_receipts,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    p = hc.paths()
    hc.ensure_dirs(p)
    started = hc.utc_now()
    safe_args = {k: v for k, v in vars(args).items() if k != "action"}
    try:
        result = HANDLERS[args.action](p, args)
        ok = bool(result.pop("_ok", True))
        if result.pop("_receipt", True):
            receipt = hc.write_receipt(p, args.action, ok, safe_args, result, started)
            out(f"\n回执：{receipt}")
        return 0 if ok else 1
    except (OpsError, hc.HttpError, subprocess.TimeoutExpired, OSError, ValueError, KeyError) as err:
        message = str(err)
        if isinstance(err, hc.HttpError):
            message = f"{err} {hc.error_message(err.body)}"
        out(f"失败：{message}")
        receipt = hc.write_receipt(p, args.action, False, safe_args, {"error": message}, started)
        out(f"回执：{receipt}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
