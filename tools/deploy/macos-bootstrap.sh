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
while [ "$ROOT" != / ] && [ "${ROOT%/}" != "$ROOT" ]; do ROOT="${ROOT%/}"; done
[ ! -L "$ROOT" ] || { echo 'Choose a non-symlink deployment directory.' >&2; exit 1; }
# Resolve existing ancestors before rejecting HOME and its parents. This also
# handles a nonexistent leaf under a symlinked macOS /tmp or user directory.
resolve_directory() {
  local ancestor="$1" suffix="" leaf
  while [ ! -d "$ancestor" ]; do
    [ ! -e "$ancestor" ] && [ ! -L "$ancestor" ] || return 1
    leaf="$(basename "$ancestor")"
    case "$leaf" in .|..|/) return 1 ;; esac
    suffix="/$leaf$suffix"
    ancestor="$(dirname "$ancestor")"
  done
  (cd "$ancestor" && printf '%s%s\n' "$(pwd -P)" "$suffix")
}
ROOT="$(resolve_directory "$ROOT")" || { echo 'Invalid deployment directory.' >&2; exit 1; }
USER_HOME="$(cd "$HOME" && pwd -P)"
case "$ROOT" in /) echo 'Choose a dedicated deployment directory.' >&2; exit 1 ;; esac
case "$USER_HOME/" in "$ROOT/"*) echo 'The deployment directory cannot be HOME or one of its parents.' >&2; exit 1 ;; esac
if [ -d "$ROOT" ] && [ "$(stat -f '%u' "$ROOT")" != "$EUID" ]; then
  echo 'The existing deployment directory must belong to the desktop user.' >&2; exit 1
fi
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
  verify_bundle
  # Version strings can be identical for a release and a feature source build.
  # Check the selected executable before invoking any of its commands.
  . "$BUNDLE/release.env"
  case "$(uname -m)" in
    x86_64) EXPECTED_SHA="$SCODE_SHA256_X64" ;;
    arm64|aarch64) EXPECTED_SHA="$SCODE_SHA256_ARM64" ;;
    *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
  esac
  ACTUAL_SHA="$(shasum -a 256 "$SCODE" | awk '{print $1}')"
  [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || {
    echo 'The existing CLI differs from the pinned release executable.' >&2
    echo 'An explicit owner upgrade is required; nothing has been replaced.' >&2
    exit 1
  }
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
doctor() (
  need_binary
  # Diagnose the deployment, not an unrelated project in the caller's directory.
  # Keep diagnostics read-only when the workspace has not been created yet.
  if [ -d "$ROOT/workspace" ]; then
    cd "$ROOT/workspace"
  else
    cd "$BUNDLE"
  fi
  "$SCODE" --version
  "$SCODE" setup --check --output-format json
  "$SCODE" --auth proxy --account sudorouter doctor
  echo 'Inspect pending authentication and perform the live task/restart checks in PROFILE.md.'
)

case "$ACTION" in
  bootstrap)
    verify_bundle
    mkdir -p "$ROOT/bin" "$ROOT/config" "$ROOT/workspace"
    chmod 700 "$ROOT" "$ROOT/config" "$ROOT/workspace"
    # Release and mirror are supplied by the reviewed product profile.
    # shellcheck source=/dev/null
    . "$BUNDLE/release.env"
    if [ -e "$SCODE" ]; then
      need_binary
      ACTUAL="$("$SCODE" --version)"
      [ "$ACTUAL" = "scode ${SCODE_VERSION#v}" ] || {
        echo "Existing binary differs from the pinned release: $ACTUAL" >&2
        echo 'An explicit owner upgrade is required; nothing has been replaced.' >&2
        exit 1
      }
    else
      SCODE_INSTALL_DIR="$ROOT/bin" SCODE_VERSION="$SCODE_VERSION" SCODE_MIRROR="$SCODE_MIRROR" \
        /bin/sh "$BUNDLE/install.sh" --no-sudo
      need_binary
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
