# Inspect a Compose deployment

Use `tools/operations/compose_status.py` to read actual container image IDs,
configured image references, process status and health. It reports an error
when Docker fails or the exact project has no containers. It never prints
container environment variables or changes host permissions.

Docker's root-owned socket is an operating-system privilege boundary. Select
the deployment host's established access method explicitly. On hosts that
authorize deployment through sudo, use `--sudo`; the tool does not silently
retry a rejected operation with more privileges.

```powershell
python tools/operations/compose_status.py sudowork-webuid --host ubuntu@43.138.120.200 --identity C:/Users/songym/.ssh/sudowork_saas_ed25519 --sudo
```

For a local Docker endpoint accessible to the current account:

```sh
python3 tools/operations/compose_status.py my-compose-project
```

SSH uses batch authentication and requires a previously trusted host key. An
SSH, sudo, Docker or JSON failure exits with a nonzero status. Operators must
resolve the reported failure through the host's supported access process.

The report verifies deployed images. Application behavior, per-user runtime
placement and recovery require their own end-to-end acceptance.
