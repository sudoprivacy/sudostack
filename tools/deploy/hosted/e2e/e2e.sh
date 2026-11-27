#!/bin/bash
# hosted-linux end-to-end harness (macOS/Linux control host + Linux container target).
#
#   e2e.sh up            build and start the disposable amd64 target container
#   e2e.sh prepare       stage runtime/workspace without credentials (action smoke runs)
#   e2e.sh wizard [...]  run the real bootstrap wizard (key from $WORK/sudorouter.key)
#   e2e.sh say "msg"     send one user turn to the ops agent (resumes the session)
#   e2e.sh reset         forget the deployment state, keep scode and router credentials
#   e2e.sh fingerprint   print the target's ED25519 host key fingerprint
#   e2e.sh copy-id       simulate the user running ssh-copy-id in another terminal
#   e2e.sh chat ["msg"]  log in to the deployed Mosswork and send one chat turn
#   e2e.sh ops ...       run an action directly (diagnostics)
#   e2e.sh down          remove the container and its Docker volume
#
# Everything the test writes on the host stays under $WORK
# (default: <sudoprivate>/.e2e-work, gitignored). The target's nested Docker
# storage is the named volume sp-e2e-docker.
set -euo pipefail
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
profile=$(dirname "$here")
repo=$(git -C "$profile" rev-parse --show-toplevel)
WORK=${E2E_WORK:-$repo/.e2e-work}
STATE=$WORK/state
NAME=sp-e2e-target
IMAGE=sp-e2e-target:latest
mkdir -p "$WORK"
export SUDOPRIVATE_STATE=$STATE

key() {
  [ -s "$WORK/sudorouter.key" ] || { echo "Put the SudoRouter key in $WORK/sudorouter.key (chmod 600)" >&2; exit 1; }
  tr -d '[:space:]' < "$WORK/sudorouter.key"
}

case "${1:-}" in
  up)
    docker build --platform linux/amd64 -q -t "$IMAGE" -f "$here/Dockerfile.target" "$here" >/dev/null
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" --platform linux/amd64 --privileged \
      -v sp-e2e-docker:/var/lib/docker \
      -p 127.0.0.1:2222:22 -p 127.0.0.1:8088:8088 "$IMAGE" >/dev/null
    for _ in $(seq 1 30); do docker exec "$NAME" pgrep -x sshd >/dev/null 2>&1 && break; sleep 1; done
    echo "target up: ops@127.0.0.1:2222 (Mosswork will be published on 127.0.0.1:8088)"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume rm sp-e2e-docker >/dev/null 2>&1 || true
    echo "target removed"
    ;;
  reset)
    # Forget the deployment (target, receipts, SSH keys, agent sessions);
    # keep the scode binary and the verified router credentials.
    rm -rf "$STATE/target.json" "$STATE/operations" "$STATE/ssh" "$STATE/workspace" \
      "$STATE/secrets/mosswork-admin.json" "$WORK/.session-started"
    echo "state reset (kept bin/, scode-home/, secrets/router.json)"
    ;;
  fingerprint)
    docker exec "$NAME" ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
    ;;
  copy-id)
    pub=$(cat "$STATE/ssh/id_ed25519.pub")
    docker exec -i "$NAME" bash -c 'install -d -m 700 -o ops -g ops /home/ops/.ssh
      touch /home/ops/.ssh/authorized_keys; grep -qxF "$1" /home/ops/.ssh/authorized_keys || echo "$1" >> /home/ops/.ssh/authorized_keys
      chown ops:ops /home/ops/.ssh/authorized_keys; chmod 600 /home/ops/.ssh/authorized_keys' _ "$pub"
    echo "installed $STATE/ssh/id_ed25519.pub for ops@target"
    ;;
  prepare)
    # Stage the runtime and workspace without credentials (action-only smoke runs).
    (cd "$profile" && python3 -I -c "import sys; sys.path[:0]=['.','lib']
import bootstrap, hosted_common as hc
p=hc.paths(); hc.ensure_dirs(p); bootstrap.sync_runtime(p, None)")
    echo "staged $STATE"
    ;;
  wizard)
    shift
    SUDOROUTER_API_KEY=$(key) "$profile/start.sh" --auto --skip-launch --answers "$here/answers.json" "$@"
    ;;
  say)
    shift
    resume=()
    [ -f "$WORK/.session-started" ] && resume=(--continue)
    touch "$WORK/.session-started"
    "$profile/start.sh" --auto "${resume[@]+"${resume[@]}"}" --prompt "$1" </dev/null
    ;;
  chat)
    # Independent check: a user chats with the deployed Mosswork.
    shift
    uv run -q --no-project --with websockets python -I "$here/chat_probe.py" \
      "$STATE/secrets/mosswork-admin.json" "${1:-你好，请用一句话介绍你自己。}"
    ;;
  ops)
    shift
    "$STATE/workspace/actions/ops" "$@"
    ;;
  *)
    sed -n '2,19p' "$0"; exit 2 ;;
esac
