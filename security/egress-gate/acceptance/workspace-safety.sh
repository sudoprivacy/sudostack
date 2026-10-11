#!/usr/bin/env bash
# Reject a reused workspace before touching another acceptance run or its data.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
mkdir "$test_dir/evidence" "$test_dir/bin"
printf 'keep\n' > "$test_dir/evidence/proof.txt"
for tool in systemctl systemd-run docker; do
  printf '#!/bin/sh\nprintf "unexpected call\\n" >> "$CALLS"\nexit 99\n' > "$test_dir/bin/$tool"
  chmod +x "$test_dir/bin/$tool"
done
export CALLS="$test_dir/calls" GATE_BIN=/bin/false NEXUS_VFS_PROTO="$test_dir" ROUTER_KEY=synthetic
export PATH="$test_dir/bin:$PATH"
for target in "$test_dir/evidence" / "$HOME"; do
  if WORK="$target" bash "$here/run.sh" > "$test_dir/output" 2>&1; then
    echo 'Acceptance unexpectedly allowed an existing workspace.' >&2
    exit 1
  else
    test "$?" -eq 2
  fi
  grep -q 'existing evidence is never removed' "$test_dir/output"
  test "$(cat "$test_dir/evidence/proof.txt")" = keep
  test ! -e "$CALLS"
done
echo 'PASS: existing evidence retained, host resources untouched'
