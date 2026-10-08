#!/bin/bash
# Egress-gate acceptance against real artifacts: a gate-armed daemon, the
# real Router and model, and (unless PRESIDIO=0) the Chinese analyzer from
# ../presidio. A recording proxy sits between the daemon's model mounts and
# the Router, so the assertions are on the bytes that actually left.
#
# Runs on any form's host that has systemd user units and Docker. Everything
# it starts is a transient, memory-capped unit or container on loopback, and
# a trap stops all of it on exit, pass or fail.
#
# Required:
#   GATE_BIN         daemon built with `--features driver-ai,egress-gate-presidio`
#                    (nexus-vfs `nexusd-cluster`, or sudocode `nexusd-cohost`)
#   NEXUS_VFS_PROTO  that nexus-vfs revision's `proto/` directory
#   ROUTER_KEY       a key the Router accepts (passed by environment only)
# Optional (defaults):
#   ROUTER_URL=http://127.0.0.1:3000   MODEL=qwen3-30b   PORT_BASE=22150
#   PRESIDIO=1   PRESIDIO_IMAGE=sudo-presidio-zh:local   CREDENTIALS=1
#   MODEL_MOUNTS=/cloud-model   NODE=node   NODE_MODULES=<existing dir>
#   WORK=<new directory under this dir>/work/run-XXXXXXXX
#   Existing nonempty workspaces are refused; acceptance evidence is retained.
#
# Red controls: `MODEL_MOUNTS=` puts every raw value on the wire;
# `PRESIDIO=0` with the Presidio verifier leaks the name.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
: "${GATE_BIN:?set GATE_BIN}" "${NEXUS_VFS_PROTO:?set NEXUS_VFS_PROTO}" "${ROUTER_KEY:?set ROUTER_KEY}"
export ROUTER_URL=${ROUTER_URL:-http://127.0.0.1:3000} MODEL=${MODEL:-qwen3-30b}
PORT_BASE=${PORT_BASE:-22150}
export PRESIDIO=${PRESIDIO:-1}
PRESIDIO_IMAGE=${PRESIDIO_IMAGE:-sudo-presidio-zh:local}
NODE=${NODE:-node}
if [ -n "${WORK:-}" ]; then
  if [ -e "$WORK" ] && { [ ! -d "$WORK" ] || [ -n "$(find "$WORK" -mindepth 1 -maxdepth 1 -print -quit)" ]; }; then
    echo 'WORK must be a new or empty directory; existing evidence is never removed.' >&2
    exit 2
  fi
  mkdir -p "$WORK"
else
  mkdir -p "$HERE/work"
  WORK=$(mktemp -d "$HERE/work/run-XXXXXXXX")
fi
WORK=$(realpath "$WORK")
export WORK CAPTURE="$WORK/capture"
RUN_ID="$$-$(date +%s%N)"
DAEMON_UNIT="egress-gate-accept-$RUN_ID"
PROXY_UNIT="egress-gate-proxy-$RUN_ID"
ANALYZER_NAME="egress-gate-presidio-$RUN_ID"
DAEMON_PORT=$PORT_BASE PROXY_PORT=$((PORT_BASE + 2)) ANALYZER_PORT=$((PORT_BASE + 3))
# Assembled so the repository never holds a contiguous key-shaped string.
if [ "${CREDENTIALS:-1}" = 1 ]; then export FAKE_KEY="sk""-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345"; else export FAKE_KEY=; fi

cleanup() {
  systemctl --user stop "$DAEMON_UNIT" "$PROXY_UNIT" 2>/dev/null || true
  systemctl --user reset-failed "$DAEMON_UNIT" "$PROXY_UNIT" 2>/dev/null || true
  docker rm -f "$ANALYZER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$WORK/data" "$WORK/id"
if [ -n "${NODE_MODULES:-}" ]; then
  modules=$(realpath "$NODE_MODULES")
elif [ ! -d "$HERE/node_modules" ]; then
  (cd "$HERE" && npm install --no-audit --no-fund >/dev/null) || { echo "npm install failed"; exit 1; }
  modules="$HERE/node_modules"
else
  modules="$HERE/node_modules"
fi
ln -s "$modules" "$WORK/node_modules"
cp "$HERE/drive.mjs" "$WORK/drive.mjs"

PRESIDIO_ENV=()
if [ "$PRESIDIO" = 1 ]; then
  docker run -d --name "$ANALYZER_NAME" --memory 4g -p 127.0.0.1:$ANALYZER_PORT:3000 \
    "$PRESIDIO_IMAGE" >/dev/null || { echo "analyzer image $PRESIDIO_IMAGE missing (build ../presidio)"; exit 1; }
  for _ in $(seq 1 120); do curl -sf http://127.0.0.1:$ANALYZER_PORT/health >/dev/null && break; sleep 2; done
  curl -sf http://127.0.0.1:$ANALYZER_PORT/health >/dev/null || { echo "analyzer did not come up"; exit 1; }
  PRESIDIO_ENV=(--setenv=NEXUS_EGRESS_GATE_PRESIDIO_URL=http://127.0.0.1:$ANALYZER_PORT
                --setenv=NEXUS_EGRESS_GATE_PRESIDIO_ENTITIES=PERSON,LOCATION,ORGANIZATION
                --setenv=NEXUS_EGRESS_GATE_PRESIDIO_TIMEOUT_MS=10000)
fi

systemd-run --user --quiet --unit="$PROXY_UNIT" -p MemoryMax=512M \
  -p StandardOutput=append:"$WORK/proxy.log" -p StandardError=append:"$WORK/proxy.log" \
  --setenv=ROUTER_URL="$ROUTER_URL" --setenv=CAPTURE="$CAPTURE" \
  python3 "$HERE/proxy.py" $PROXY_PORT

systemd-run --user --quiet --unit="$DAEMON_UNIT" -p MemoryMax=4G \
  -p StandardOutput=append:"$WORK/daemon.log" -p StandardError=append:"$WORK/daemon.log" \
  --setenv=NEXUS_DATA_DIR="$WORK/data" --setenv=NEXUS_IDENTITY_DIR="$WORK/id" \
  --setenv=NEXUS_EGRESS_GATE_MODEL_MOUNTS=${MODEL_MOUNTS-/cloud-model} --setenv=RUST_LOG=info \
  "${PRESIDIO_ENV[@]}" \
  "$GATE_BIN" --cluster-init egress-gate-accept --hostname "$(hostname)" \
  --bind-addr 127.0.0.1:$DAEMON_PORT --advertise-addr 127.0.0.1:$DAEMON_PORT

for _ in $(seq 1 90); do
  ss -lnt | grep -q "127.0.0.1:$DAEMON_PORT " && [ -f "$WORK/data/tls/node.pem" ] && break
  sleep 1
done
ss -lnt | grep -q "127.0.0.1:$DAEMON_PORT " || { echo "daemon did not come up"; tail -30 "$WORK/daemon.log"; exit 1; }

ENDPOINT=127.0.0.1:$DAEMON_PORT PROXY_URL=http://127.0.0.1:$PROXY_PORT PROTO="$NEXUS_VFS_PROTO" \
  "$NODE" "$WORK/drive.mjs" || { echo "drive failed"; tail -30 "$WORK/daemon.log"; exit 1; }
python3 "$HERE/verify.py"
