#!/bin/sh
# SudoCode hosted-linux bootstrap entry (macOS / Linux control host).
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if ! command -v python3 >/dev/null 2>&1; then
  echo "需要 python3。macOS 请先运行：xcode-select --install；Linux 请用包管理器安装 python3。" >&2
  exit 1
fi
exec python3 -I "$here/bootstrap.py" "$@"
