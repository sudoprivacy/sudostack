#!/bin/bash
# Container stand-in for systemd: run sshd, and start dockerd once the
# bootstrap's docker-install action has installed it (a real host's
# `systemctl enable --now docker` does this).
#
# Nested Docker on cgroup v2 (same fix as the official docker:dind entrypoint):
# move this container's processes into a child cgroup and delegate all
# controllers, otherwise containers with resource limits fail with
# "cannot enter cgroupv2 ... it is in threaded mode".
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  mkdir -p /sys/fs/cgroup/init
  xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || :
  sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
    > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || :
fi
/usr/sbin/sshd -e
while true; do
  if [ -x /usr/bin/dockerd ] && ! pgrep -x dockerd >/dev/null; then
    nohup /usr/bin/dockerd >>/var/log/dockerd.log 2>&1 &
  fi
  sleep 2
done
