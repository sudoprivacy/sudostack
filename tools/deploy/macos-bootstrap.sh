#!/bin/bash
# Compose existing SudoCode owners; this script does not create Agent identities.
set -euo pipefail
umask 077

ACTION="${1:-bootstrap}"
[ "$#" -le 1 ] || { echo 'Expected at most one action.' >&2; exit 2; }
if [ "$ACTION" = --help ]; then
  echo 'Usage: macos-bootstrap.sh [bootstrap|configure|prepare|doctor|run]'
  echo 'Run from a staged, checksum-verified personal-macos candidate bundle.'
  exit 0
fi
case "$ACTION" in bootstrap|configure|prepare|doctor|run) ;; *) echo 'Unknown action' >&2; exit 2 ;; esac
[ "$(uname -s)" = Darwin ] || { echo 'This candidate requires macOS.' >&2; exit 1; }
[ "$EUID" -ne 0 ] || { echo 'Run as the desktop user, without sudo.' >&2; exit 1; }
BUNDLE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${SUDO_PRIVATE_HOME:-$HOME/.local/share/sudoprivate/personal-macos}"
case "$ROOT" in /*) ;; *) echo 'SUDO_PRIVATE_HOME must be absolute.' >&2; exit 1 ;; esac
[ "$ROOT" != / ] && [ "$ROOT" != "$HOME" ] && [ ! -L "$ROOT" ] || { echo 'Choose a dedicated, non-symlink deployment directory.' >&2; exit 1; }
for name in bin config workspace; do
  [ ! -L "$ROOT/$name" ] || { echo "Refusing symlink: $ROOT/$name" >&2; exit 1; }
done
export SUDO_CODE_CONFIG_HOME="$ROOT/config"
SCODE="$ROOT/bin/scode"

# Provider overrides from another terminal must not select a different account.
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL OPENAI_API_KEY OPENAI_BASE_URL
unset PROXY_API_KEY PROXY_BASE_URL CLAUDE_CODE_OAUTH_TOKEN
# Nexus connection and owner settings remain under the native lifecycle owner.
# In particular, do not invent a second CA or service root for an existing Box.

verify_bundle() {
  (cd "$BUNDLE" && shasum -a 256 -c SHA256SUMS)
}
need_binary() {
  [ -x "$SCODE" ] || { echo 'Run bootstrap first.' >&2; exit 1; }
}
configure() {
  verify_bundle
  /bin/bash "$BUNDLE/scode-setup.sh" --config-dir "$SUDO_CODE_CONFIG_HOME"
}
prepare() {
  need_binary
  "$SCODE" setup --mode shared --output-format json
  echo 'Runtime preparation is not authenticated Agent enrollment or A2A acceptance.'
}
doctor() {
  need_binary
  "$SCODE" --version
  "$SCODE" setup --check --output-format json
  "$SCODE" --auth proxy --account sudorouter doctor
  echo 'Inspect pending authentication and perform the live task/restart checks in PROFILE.md.'
}

case "$ACTION" in
  bootstrap)
    verify_bundle
    mkdir -p "$ROOT/bin" "$ROOT/config" "$ROOT/workspace"
    chmod 700 "$ROOT" "$ROOT/config" "$ROOT/workspace"
    # Release and mirror are supplied by the reviewed product profile.
    # shellcheck source=/dev/null
    . "$BUNDLE/release.env"
    if [ -e "$SCODE" ]; then
      ACTUAL="$("$SCODE" --version)"
      [ "$ACTUAL" = "scode ${SCODE_VERSION#v}" ] || {
        echo "Existing binary differs from the pinned release: $ACTUAL" >&2
        echo 'An explicit owner upgrade is required; nothing has been replaced.' >&2
        exit 1
      }
    else
      SCODE_INSTALL_DIR="$ROOT/bin" SCODE_VERSION="$SCODE_VERSION" SCODE_MIRROR="$SCODE_MIRROR" \
        /bin/sh "$BUNDLE/install.sh" --no-sudo
    fi
    if [ ! -f "$SUDO_CODE_CONFIG_HOME/sudocode.json" ] || [ ! -f "$SUDO_CODE_CONFIG_HOME/settings.json" ]; then
      configure
    else
      echo 'Keeping existing private configuration; use configure for an explicit change.'
    fi
    [ -f "$SUDO_CODE_CONFIG_HOME/sudocode.json" ] && [ -f "$SUDO_CODE_CONFIG_HOME/settings.json" ] || {
      echo 'Configuration is incomplete; runtime preparation has not started.' >&2; exit 1;
    }
    prepare
    doctor
    echo 'Candidate prepared. Two persistent Agents and live inference remain to be accepted.'
    ;;
  configure) configure ;;
  prepare) prepare ;;
  doctor) doctor ;;
  run)
    need_binary
    [ -d "$ROOT/workspace" ] || { echo 'Run bootstrap first.' >&2; exit 1; }
    cd "$ROOT/workspace"
    exec "$SCODE" --auth proxy --account sudorouter --permission-mode workspace-write
    ;;
esac
