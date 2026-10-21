# Agent management 1.1 source-checkout qualification

`../agent_management.py` starts the three application services of the existing
synthetic qualification topology from committed source checkouts and prepared
build outputs. It preserves the owner Registry/IAM/file APIs. It does not build
installers, issue acceptance reports, publish Agents, change permissions, pull
images or initialize a database during normal startup.

This is a local development deployment, not a production installer, HA receipt,
bit-for-bit reproducible build or offline inference qualification. The earlier
`agent_lab.py` five-image example alone does not compose the additional hosted
runtime, real IAM and content path introduced by Agent management 1.1.

## Inputs and prerequisites

Prepare the existing Nexus Secret runtime, mutual-TLS VFS/content kernel, Router,
PostgreSQL for WebUI, and a Docker daemon that passes the owner's memory/swap/PID
and isolation checks. Preload the reviewed Dify, LangGraph and native images. The
native image must contain the recorded Linux SudoCode binary and native runner.
The privileged Docker control endpoint stays with the trusted supervisor; never
mount it in an Agent container. An SSH tunnel can reach an isolated remote Router
using a loopback endpoint. Its database and billing authority must be preserved
when moving an existing instance.

Build Moss and WebUI using their recorded source and lockfiles; prepare Nexus's
Python dependencies. Use the existing owner configuration formats for:

- Moss server, Registry client and hosted runtime configuration;
- Registry domain/Zone and domain-policy mappings, signing key and API token;
- the Nexus task execution policy with exact model/tool resources and principals;
- mutual-TLS VFS snapshots/content path, using its existing CA and identity;
- WebUI configuration, database URL, session HMAC key and token AES key.

Keep private files `0600` and their directories `0700`. Do not put raw credentials
in the manifest, source control, command line or handoff archive. The launcher
accepts only the service environment keys listed in `REQUIRED_ENV` and
`OPTIONAL_ENV`; it drops inherited application switches and unrelated credentials.
The manifest has this shape (replace all paths and full revisions):

```json
{
  "schema_version": 1,
  "scope": "synthetic",
  "sources": {
    "moss": {"path": "/checkouts/moss", "revision": "FULL_40_HEX_COMMIT"},
    "work": {"path": "/checkouts/sudowork", "revision": "FULL_40_HEX_COMMIT"},
    "nexus": {"path": "/checkouts/nexus", "revision": "FULL_40_HEX_COMMIT"},
    "stack": {"path": "/checkouts/sudostack", "revision": "FULL_40_HEX_COMMIT"}
  },
  "services": {
    "moss": {
      "env": {
        "MOSS_SERVER_CONFIG": "/private/moss.json",
        "MOSS_AGENT_REGISTRY_CONFIG_FILE": "/private/registry-client.json",
        "MOSS_AGENT_HOSTED_CONFIG_FILE": "/private/hosted-runtime.json",
        "MOSS_AGENT_HOSTED_TASKS_ENABLED": "1",
        "MOSS_AGENT_EXTERNAL_TASK_CONTEXT_ORIGIN": "http://127.0.0.1:43138",
        "MOSS_NEXUS_MODE": "external",
        "MOSS_NEXUS_ENDPOINT": "http://127.0.0.1:22143",
        "MOSS_AUTH_PROXY_PORT": "22144",
        "MOSS_INSTANCE_ID": "qualified-local-controller",
        "MOSS_PUBLIC_BASE_URL": "http://127.0.0.1:43138"
      },
      "secret_files": {}
    },
    "webui": {
      "env": {"CONFIG_PATH": "/private/webui.json", "NODE_ENV": "development"},
      "secret_files": {
        "DATABASE_URL": "/private/webui-database-url",
        "SESSION_HMAC_KEY": "/private/webui-session-key",
        "TOKEN_AES_KEY": "/private/webui-token-key"
      }
    },
    "registry": {
      "python": "/prepared/nexus-venv/bin/python",
      "database_url_file": "/private/registry-database-url",
      "signing_key_file": "/private/signing.pem",
      "token_file": "/private/registry-token",
      "domain_zones": {"office.example.test": "office-zone"},
      "inventory_zone_domains": {"office-zone": "office"},
      "attestors": [],
      "execution_policy_file": "/private/execution-policy.json",
      "host": "127.0.0.1",
      "port": 22141,
      "vfs": {
        "endpoint": "https://127.0.0.1:22160",
        "tls": {"ca": "/private/ca.pem", "cert": "/private/client.pem", "key": "/private/client-key.pem"},
        "known_zones": "/private/known-zones"
      }
    }
  }
}
```

The manifest is operator input, not a cross-platform Agent contract. Do not use
a placeholder organization or automatically grant attestor privileges. Configure
actual reviewed identities; a registered attestor still cannot bypass independent
IT review, source validity, migration evidence or execution checks.

## Explicit operations

```sh
python3 tools/deploy/agent_management.py check --config /private/management.json
# Only for a new database / explicit additive schema upgrade, after backup:
python3 tools/deploy/agent_management.py initialize-registry --config /private/management.json
# Run separately under your process supervisor:
python3 tools/deploy/agent_management.py run-registry --config /private/management.json
python3 tools/deploy/agent_management.py run-moss --config /private/management.json
python3 tools/deploy/agent_management.py run-webui --config /private/management.json
```

`check` verifies full source commits, clean tracked files, required prepared entry
points, private-file references, explicit task switches and loopback bindings. It
prints no credentials and explicitly reports `runtime_acceptance: false` and
`offline_acceptance: false`. Existing missing/old schema fails at owner startup;
normal startup never calls initialization. WebUI schema migration remains its
separate owner command. Legacy task cutover still needs its original maintenance
procedure; `initialize-registry` does not perform that migration.

An already populated deployment must retain its database, signing identity,
organization mappings, session keys and runtime-authority identity. Stop the old
writers and take consistent backups before switching launchers. Use explicit
service shutdown; this tool intentionally does not search for and kill processes.

## Evidence after starting

Verify authenticated inventory, authorized native/hosted directory, fixed version,
actual Task output, independently checked Router billing, revoked IAM/delegation
and Router credentials, closed container marker and retained history after a
restart. Record the manifest hash, source revisions, build/image/binary digests,
real service versions and sanitized Task/Attempt references. `check` alone proves
none of these runtime results.

For full offline acceptance, provision an actual internal inference model and
preload all runtime dependencies. Test with public network access blocked, plus
missing-image/dependency/model denial and restart recovery. An online Router,
a deterministic stub or a container with no external network does not establish
complete offline inference. Desktop signing and IM integration remain separate.
