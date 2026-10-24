# Shared deploy and cross-domain Agent collaboration

Status: source proposal and executable-placement foundation. Domain join is not
implemented or enabled by this change. The target is an existing Edge cohost
Agent, followed by existing Cloud Agents; a parallel standalone Agent does not
qualify that product path.

## Ownership and target

Cloud and Edge consume one deployment spine. They retain different placement
adapters: Kubernetes and owner allocations on Cloud, existing user services,
local models and appliance networking on Edge. Neither adapter owns another
authentication protocol, mailbox implementation or credential issuer.

| Concern | Owner |
| --- | --- |
| CA verification, current peer classification, revocation, authorization, durable A2A objects | nexus-vfs |
| Resolved managed Agent, session execution, send/list/receiver, ACP | sudocode |
| Shared release composition, deploy/join sequencing and evidence | sudostack |
| Appliance service/GPU/network selection and deployment record | sudoedge |
| Cloud tenant/allocation/Kubernetes selection | sudocloud / existing Moss adapter |

The accepted runtime is `SudoWork -> Moss -> local ManagedAgentService ->
in-process scode -> local Nexus`. Its collaboration writes must pass that
local Kernel's authorization and configured content gate. Directly connecting
an unrelated CLI to the remote broker would qualify a different path.

`deploy` assembles, inspects, stages, activates and verifies a runtime and its
connections. `spawn` creates an execution under a resolved Agent and owner.
`move` transfers durable state with writer fencing. Deploy does not implicitly
spawn another identity or implement move by copying a directory.

## Existing source, separately from the proposal

The source cut for the Nexus findings is `v0.8.23`; the composed scode cut is
`f6cb2593bcb7cc51ab00c2f801d6f327d4c6e822`. Review these exact owner sources:

- Nexus `proto/nexus/raft/transport.proto`: node-authorized live
  `RegisterForeignCa`, `ListForeignCas`, `UnregisterForeignCa` already exist.
- `rust/transport/src/peer_identity.rs`: classification verifies signatures
  against local and registered foreign anchors. A foreign CA can attest an
  Agent, and cannot turn its certificate into a local cluster Node.
- `rust/transport/src/auth.rs`: `resolved_agent_id` qualifies a foreign Agent;
  `display_id` is presentation and is not a canonical input constructor.
- `rust/a2a/src/foreign_containment.rs`: current foreign access is primarily a
  path-shape boundary. Transcript admission does not bind the caller to that
  conversation's participants. Every foreign reader-register write is denied.
- `rust/a2a/src/addresses.rs`: conversation IDs derive from participant strings;
  chat-list paths assume a single Agent segment. Qualified foreign names need
  an explicit address encoding and common participant identity on both sides.
- scode `engine-host/src/managed_agent.rs`: the managed task builds its mailbox
  over the same `KernelFsBackend` as file tools. A remote client injected in
  place of that backend would bypass the required local path.
- scode `runtime/src/mailbox.rs`: discovery, index creation, stream provision,
  seat acquisition and the Agent's own reader commits are part of operation.
  A handshake and one remote append do not prove this lifecycle works.

Consequently CA registration alone is not a completed domain join. The
existing local six-peer network is not evidence for cross-domain isolation.
Do not widen generic VFS foreign access just to make its receiver work.

## Join, authentication and authorization

The following are selected design constraints, not claims about deployed code.

1. **Domain enrollment** binds a full public-CA fingerprint to an operator
   approved domain and endpoint. Exchange public anchors only. Keep private
   CA keys on their existing authority. Validate the remote server under an
   explicitly trusted anchor and expected service identity; do not disable TLS
   or enroll a foreign domain as a Raft voter to obtain mailbox access.
2. **Agent authentication** comes from the actual mTLS peer and the current
   installed verifier. A typed principal binds issuer fingerprint, subject
   kind and the signed Agent identity. A profile, body field, PID, display
   label or broker host is not that principal. The local cohost must bind an
   outbound leaf to its authenticated resolved Agent/owner; a shared Node or
   controller credential cannot impersonate all hosted Agents.
3. **Collaboration authorization** is distinct from anchor trust. An explicit,
   scoped grant authorizes the participating principals and collaboration
   space. It confers no owner adoption, local filesystem, secret, model,
   administrative or cluster membership permission. Reuse the existing
   authoritative control store and immutable conversation metadata. Do not
   introduce a second directory/identity database or a relay daemon.
4. **Current authority** is rechecked on every attempt, query and receipt
   replay, including a long-lived TLS connection after expiry or revocation.
   Local issuer continuity, foreign-anchor removal and the applicable current
   CRL must govern access. Cached directory entries are not authorization.
   Cross-process/offline CRL ordering must be established before claiming
   atomic revocation through an append; the existing process-local mutex alone
   does not prove it.
5. **Canonical addressing** must be owned once by Nexus A2A and consumed by
   scode. Both domains must derive the same global participant identity and
   conversation ID. Presentation aliases and path-safe leaf encodings are
   separate. Preserve existing local conversations; negotiate a new capability
   for a new cross-domain shape, and explicitly refuse unsupported peers.
   No slash replacement, ambiguous concatenation or unannounced ID migration.

The concrete principal encoding, grant fields, participant binding and native
operation capability must be reviewed in nexus-vfs before producing generated
cross-repo contracts. This document deliberately does not freeze another JSON
schema alongside that semantic owner.

## Data and recovery boundary

Use the existing cohost and Kernel. Its local collaboration mount/backend
must carry the verified Agent's identity to the remote authority and apply
the local content policy before any outbound write. Local session transcripts,
model mounts and collaboration logs stay distinct; mounting over the existing
`/agents` or `/conversations` roots must not replace current product state.

The remote authority must bind an immutable participant set before accepting
operations. It may expose only the authorized transcript/index and the
caller's own reader/receipt operations. Reading or advancing another Agent's
reader is a separate, explicit authorization decision. Do not remove the
current denial for every reader just to repair delivery.

Choose one authoritative transcript per conversation. Local forwarding state,
if required, is delivery/reconciliation evidence, not a second authoritative
transcript. An admission refusal proves no append only at the native pre-write
boundary. A lost response after submission remains **Unknown**; retain the
original operation and reconcile. Do not automatically resend a possibly
committed append or claim exactly-once execution from a successful RPC.

Directory visibility does not prove online status. An outer controller's
active/idle callback acceptance is also distinct from scode consuming a frame.
Existing ownership, approval, pause/worker fences and one-receiver semantics
continue to apply to managed and standalone consumers.

## Shared deploy sequence

1. Inspect actual product adapters, running executable hashes, public issuer
   fingerprints, source/ABI/protocol versions, service ownership and durable
   paths. Do not derive live versions from repository HEAD or filenames.
2. Plan against a pinned release composition. Keep an existing runtime, Agent,
   owner, Session, volume, CA, model configuration and policy unless an explicit
   reviewed transition changes that specific item. Report unsupported native
   capabilities before making trust or runtime changes.
3. Stage source/digest verified, immutable artifacts. `tools/deploy/cohost.py`
   supplies the shared Linux user-service placement step. `inspect` is read
   only, `stage` changes no service, and `install` starts only a fresh unit.
   An existing different unit/runtime requires its native owner-controlled
   drain/adoption path; this installer does not interrupt it or overwrite it.
4. Apply the product's controlled maintenance/admission procedure. Preserve
   unit drop-ins, state and identity. Fresh executable activation proves only
   the running bytes, not authenticated readiness or domain joining.
5. Establish the explicit join and scoped grant through supported native APIs;
   reuse an identical existing enrollment and reject conflicting bindings.
   Ambiguous mutation responses are reconciled, not interpreted as absence.
6. Verify authenticated readiness and actual collaboration, then write a
   source-bound deployment/acceptance receipt. Roll back executable/config
   selection without restoring an old database over newer writes.

The cohost command's `authenticatedReady:false` and `domainJoinAccepted:false`
are intentional boundaries. A placement receipt cannot become full deploy
acceptance merely because systemd reports active.

## DGX and seven-party qualification

The observed DGX has an existing vault/login service at `22140`, and a distinct
Moss execution cohost with model/content-policy drop-ins at `22141`. These are
existing product state, not disposable fixtures. Keep host locations and secret
paths in the private deployment record and sudoedge device documentation.

Before activation, qualify the actual old data/identity/configuration with the
selected cohost and preserve a tested application rollback. Do not replace the
whole appliance stack, its model or its trust roots as an installer side effect.

Seven-party acceptance requires the six existing participants and a real Agent
in the DGX product runtime. The matrix must include each directed pair and
actual durable append/receive/commit evidence. Explicit one-time acknowledgments
are correlated to cases and are never themselves acknowledged automatically.
Also qualify same-name/different-domain isolation, forged identity, unrelated
conversation access, wrong reader writes, expiry/revocation on a live connection,
content deny/redaction/outage, lost response without resend, restart/reentry,
and preservation of existing local Moss history/model behavior.

Cloud is the next consumer of the same native contracts and common deploy/join
sequence. Its existing Agents and allocation bindings participate in their own
real runtime; another demonstration Agent or a cloud deployment change is not
implicitly authorized by this Edge qualification. Kubernetes placement and
user-owned volumes remain the responsibility of the existing Cloud adapter.
