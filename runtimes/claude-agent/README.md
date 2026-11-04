# Claude runtime preparation

This opt-in image layer installs the reviewed third-party ACP adapter and its
unmodified, exact-pinned official Agent SDK/native CLI in a qualified owner Pod
image. It preserves that image's cohost entrypoint and working directory. It
does not select a new runtime for an existing Agent or deploy a replacement Pod.

The launch policy and real adapter `initialize`/EOF smoke pass without an
account or model call. **Production A2A integration, gVisor image qualification,
account login, session recovery and a real coding task remain unqualified.**
Do not advertise this preparation artifact as an available production backend.
See [the architecture and integration gates](../../docs/design/claude-agent-runtime.md).

Build from the repository root with a previously qualified digest-pinned
`USER_RUNTIME_IMAGE` that contains Node 22.21+ and npm:

```sh
docker build -f runtimes/claude-agent/Dockerfile \
  --build-arg USER_RUNTIME_IMAGE=REGISTRY/QUALIFIED_RUNTIME@sha256:FULL_DIGEST \
  -t PRIVATE_REGISTRY/claude-runtime:CANDIDATE .
```

An existing managed Claude policy is refused rather than overwritten. Merge it
explicitly into a reviewed candidate before building. Promote a candidate only
through the existing owner drain/upgrade path after its source, executable
digest, gVisor startup and authenticated lifecycle qualify. Do not copy a node's
personal `.claude` directory or credentials into an image.

The authenticated product controller must create an account-dedicated allocation
and private binding file. Its native owner/org/micro-pool authorization must run
before spawn and before each task; JSON fields here are deployment assertions,
not a replacement identity or admission protocol. The persistent config directory
`/data/claude/<accountId>` must already exist with mode 0700, owned by uid 1000.
Keep all sessions of that account on this allocation and hold one exclusive
runtime lease. Keep other owners/accounts in separate Pods and PVCs. A shared
household IP does not permit sharing credentials, browser profiles or pool scope.

Example binding (values are operator selections, not credentials):

```json
{
  "ownerId": "AUTHENTICATED_OWNER",
  "organizationId": "AUTHORIZED_ORG",
  "microPoolId": "AUTHORIZED_MICRO_POOL",
  "accountId": 123,
  "email": "owner@example.com",
  "httpProxy": "http://FIXED_MANAGED_CONNECT_ENDPOINT:1055",
  "privacy": {
    "policyVersion": "claude-optional-data-v1",
    "email": "owner@example.com",
    "locationMetadata": false,
    "modelImprovement": false,
    "persistedReadback": true
  }
}
```

Stage the binding as a regular file with mode 0600 owned by the controller/runtime
user; a Kubernetes Secret projection's symlink is intentionally not accepted
directly. The owning deployment must copy a reviewed projection into its private
runtime configuration during initialization, not make it writable by other
tenants. Never let a task provide this path or choose an owner. The runtime user's
own code can access that user's own credentials; gVisor does not separate a task
from secrets mounted into its execution container.

The external-spawn command is:

```sh
node /opt/claude-runtime/launch.mjs \
  --binding /private-runtime-config/claude-account.json \
  --owner AUTHENTICATED_OWNER
```

The launcher passes stdin/stdout directly to upstream ACP, clears unrelated
operator/provider credentials, requires the pinned HTTP CONNECT endpoint, and
applies official optional-traffic settings. No base URL, user agent, system
prompt, API request or session metadata is synthesized. The upstream adapter
uses the official `claude_code` prompt and tool presets by default; it is a
third-party ACP adapter over the official SDK, not Anthropic-native ACP.

Provision the owner login using the producer CLI under this same retained
`CLAUDE_CONFIG_DIR` and fixed HTTP proxy. Use that person's own authorized
subscription login; never reuse the gateway's collected OAuth token as a
substitute or mount an admin home directory. Direct inference authentication
remains the official client's responsibility. The network boundary must allow
only the assigned proxy and authorized control/MCP endpoints, with no direct
Anthropic fallback. Environment variables alone do not enforce egress.

CLI optional traffic is off in both the launcher and image managed settings.
These do not turn off required authentication, inference metadata, country/IP
security collection, or WebFetch security checks. Provider UI privacy must be
verified separately using Ladder's shared `claude_privacy.py` after identity
verification; a missing or stale assertion leaves admission pending.

Session titles are local metadata. The pinned third-party adapter normally calls
the SDK's `generateSessionTitle`, which can request inference even with optional
CLI traffic disabled. Our explicit downstream patch replaces that one call with
the adapter's existing bounded text sanitizer. Existing stored titles and user
renames still win. Local titles are sent as ACP UI metadata; they are not written
into the official transcript by a synthetic model call. The product can use its
own task name for display. No JetBrains/AIR client identity is impersonated.

`npm run prepare:adapter` applies only the checked-in single-file patch. Exact
upstream/output SHA-256 and package version are required; unknown bytes fail
before writing. Reapplying is idempotent. Both image build and CI prepare it
explicitly, and the launcher rejects an unprepared adapter. The npm lock and
official SDK/CLI bytes are unchanged. This proves the covered adapter title path
does not request a model; real tasks must still account for necessary main calls,
tools, compaction, retries and any other auxiliary behavior separately.

Before exposing this adapter to an ordinary client, the product adapter must
validate standard ACP and reject client overrides that can select environment,
executable, provider credentials, working root, bypass mode or a replacement
system prompt. MCP commands/configuration must come from the authorized owner
catalog, not an arbitrary A2A message. The launcher does not parse ACP or replace
that product boundary.

The caller sends `session/cancel` and drains the result before runtime teardown.
The launcher translates a stop signal into SIGINT then bounded termination;
forced shutdown is an unknown outcome, not proof that an accepted task failed.
Never replay that task automatically. Persist the official ACP session ID and
transcript and resolve existing effects before recovery. Retain the PVC and exit
assignment when retiring a Pod; do not retire a busy allocation.

Run `npm ci --ignore-scripts && npm run prepare:adapter && npm test`. Startup checks never send
`authenticate`, `session/new` or `session/prompt` and do not represent acceptance
of a subscribed account, a useful task, A2A delivery or gVisor compatibility.

CI also builds this exact Dockerfile on a digest-pinned public Node fixture base
and runs `node container-smoke.mjs LOCAL_IMAGE`. It starts the complete launcher
as uid 1000 with a read-only root, no capabilities and `--network none`, creates
only an empty fixture account, and sends ACP initialize/EOF. This catches missing
launcher modules/configuration; it does not qualify that fixture base as an owner
runtime or claim to run gVisor. No production image is published by this check.
