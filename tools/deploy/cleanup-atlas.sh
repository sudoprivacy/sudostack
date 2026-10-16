#!/usr/bin/env bash
# Remove the default Atlas installation from a dedicated single-node test host.
set -euo pipefail

ATLAS_CLEANUP_DRY_RUN=0
ATLAS_K3S_UNINSTALLER=/usr/local/bin/k3s-uninstall.sh
ATLAS_K3S_AGENT_UNINSTALLER=/usr/local/bin/k3s-agent-uninstall.sh

usage() {
  cat <<'HELP'
用法：sudo bash cleanup-atlas.sh [--dry-run]

仅适用于专用测试机，以及默认 /data/atlas 安装目录。
会永久删除整个 k3s 集群、容器镜像、本地数据卷、数据库、会话、
Router 渠道/API Key、账号凭据、安装缓存、gVisor 和 Helm。
同时删除本机集群和页面访问端口的放行规则。

  --dry-run  只打印清理命令，不修改系统；可在非 root 环境预览
  -h, --help 显示说明

系统基础依赖、另存的备份、独立下载的安装/清理脚本、客户端 CA
和云平台安全组规则需要按各自用途保留或另行处理。
HELP
}

die() {
  printf '清理失败：%s\n' "$*" >&2
  exit 1
}

run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  if (( ! ATLAS_CLEANUP_DRY_RUN )); then
    "$@"
  fi
}

uninstall_k3s() {
  # An old worker is a cluster migration, not an Atlas single-node cleanup.
  # Report its actual uninstaller without silently deleting the worker's data.
  if [[ ! -f "$ATLAS_K3S_UNINSTALLER" && -f "$ATLAS_K3S_AGENT_UNINSTALLER" ]]; then
    die "检测到 k3s-agent 节点。请先备份旧节点数据并完成退群安排，再执行 sudo sh ${ATLAS_K3S_AGENT_UNINSTALLER}；该操作删除本机 k3s 数据，保留整包下载缓存。退出旧 agent 后可继续安装；如需清空 Atlas 和缓存，再运行本脚本。"
  fi
  if (( ATLAS_CLEANUP_DRY_RUN )) || [[ -f "$ATLAS_K3S_UNINSTALLER" ]]; then
    run sh "$ATLAS_K3S_UNINSTALLER" || die 'k3s 卸载失败，尚未继续删除 Atlas 配置和凭据。'
    if (( ! ATLAS_CLEANUP_DRY_RUN )); then
      if systemctl is-active --quiet k3s || systemctl is-active --quiet k3s-agent; then
        die 'k3s 仍在运行，停止删除 Atlas 配置和凭据。'
      fi
      if [[ -e /usr/local/bin/k3s || -d /var/lib/rancher/k3s ]]; then
        die 'k3s 程序或数据目录仍然存在，请先处理卸载脚本报告的错误。'
      fi
    fi
  elif command -v k3s >/dev/null 2>&1 || [[ -d /var/lib/rancher/k3s ]]; then
    die '检测到 k3s，但缺少 /usr/local/bin/k3s-uninstall.sh，停止清理。'
  else
    printf '未检测到 k3s，继续清理 Atlas 文件。\n'
  fi
}

remove_atlas_files() {
  # These are host paths. /var/lib/atlas is a path INSIDE the application Pods.
  # Never remove an install-atlas.sh from the caller's arbitrary working directory.
  run rm -rf -- /data/atlas /var/cache/sudostack \
    /etc/rancher/node /usr/local/bin/gvisor-bin
  run rm -f -- /usr/local/bin/helm /usr/local/bin/runsc \
    /usr/local/bin/containerd-shim-runsc-v1 \
    /etc/profile.d/k3s-kubeconfig.sh \
    /etc/rancher/k3s/config.yaml.d/90-atlas.yaml
}

remove_firewall_rules() {
  local port failed=0 use_ufw=0 use_firewalld=0
  if (( ATLAS_CLEANUP_DRY_RUN )) || command -v ufw >/dev/null 2>&1; then
    use_ufw=1
  fi
  if (( ATLAS_CLEANUP_DRY_RUN )) || {
    command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1
  }; then
    use_firewalld=1
  fi
  for port in 6443/tcp 8472/udp 10250/tcp 80/tcp 443/tcp 8443/tcp 9443/tcp; do
    if (( use_ufw )); then
      run ufw --force delete allow "$port" || failed=1
    fi
    if (( use_firewalld )); then
      run firewall-cmd --permanent --remove-port="$port" || failed=1
      run firewall-cmd --remove-port="$port" || failed=1
    fi
  done
  return "$failed"
}

main() {
  while (( $# )); do
    case "$1" in
      --dry-run) ATLAS_CLEANUP_DRY_RUN=1 ;;
      -h|--help) usage; return 0 ;;
      *) die "未知参数：$1；运行 --help 查看说明。" ;;
    esac
    shift
  done

  if (( ! ATLAS_CLEANUP_DRY_RUN )); then
    [[ "$(uname -s)" == Linux ]] || die '仅支持 Linux 测试机。'
    [[ "$EUID" -eq 0 ]] || die '请以 root 用户执行。'
    command -v systemctl >/dev/null 2>&1 || die '需要 systemd 管理的 k3s 安装。'
    # Share the installer's lock, so cleanup cannot race an installation.
    command -v flock >/dev/null 2>&1 || die '缺少 flock（util-linux）。'
    exec 9>/run/lock/atlas-install.lock
    flock -n 9 || die '安装或清理正在运行，请等待其完成。'
  fi

  printf '清理范围：整个 k3s 集群、/data/atlas、/var/cache/sudostack、gVisor、Helm 和相关本机端口规则。\n'
  if (( ATLAS_CLEANUP_DRY_RUN )); then
    printf '预览模式：以下命令不会执行；防火墙命令仅在对应工具可用时执行。\n'
  fi
  uninstall_k3s
  remove_atlas_files
  local firewall_failed=0
  remove_firewall_rules || firewall_failed=1
  run systemctl daemon-reload
  # Keep the lock inode until all other cleanup operations have finished.
  run rm -f -- /run/lock/atlas-install.lock
  if (( firewall_failed )); then
    die '服务和文件已清理，但部分防火墙规则清理失败，请检查上面的错误。'
  fi
  if (( ATLAS_CLEANUP_DRY_RUN )); then
    printf '预览结束，未修改系统。\n'
  else
    printf '清理完成。另存的备份、独立脚本、客户端 CA 和云安全组规则请另外处理。\n'
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
