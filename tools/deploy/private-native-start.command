#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
[ "$(uname -s)" = Darwin ] && [ "$EUID" -ne 0 ] || {
  echo 'Run this Mac candidate as the desktop user, without sudo.' >&2; exit 1;
}
shasum -a 256 -c SHA256SUMS
# Use a verified relocatable runtime. No system Python, Homebrew, Xcode, Rust,
# Node or package-manager installation is required on the target Mac.
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/sudoprivate-python.XXXXXXXX")"
cleanup() {
  case "$runtime_dir" in */sudoprivate-python.????????) rm -rf -- "$runtime_dir" ;; esac
}
trap cleanup EXIT
/usr/bin/tar -xzf python-runtime.tar.gz -C "$runtime_dir"
if [ "$#" -eq 0 ]; then set -- start; fi
"$runtime_dir/python/bin/python3" -E -s -B private_macos_entry.py "$@"
