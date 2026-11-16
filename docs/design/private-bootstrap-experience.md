# Private bootstrap, Cloud sign-in and desktop delivery

Status: integration design, updated 2026-11-16. This records the requested product
direction and remaining composition work; it does not qualify unimplemented
login, secret delegation or installer behavior. Measured coverage stays in
[personal macOS acceptance](../deployment/personal-macos.md).

## Deployment and authority

Sudo Private is a customer-operated deployment with explicit owners and policies.
One LAN is a convenient initial placement, not its identity boundary. A customer's
Mac, Spark and roaming laptop can belong to the same Private deployment. Two
unrelated customers on one LAN do not thereby share authority. A Private deployment
can contain multiple owners with distinct access, rather than one universal admin.

Sudo Cloud is our hosted deployment of the same service contracts, with tenant
isolation. It can also distribute components and coordinate delegated Private
placements. A network of Private deployments is an optional federation topology,
not the definition of Cloud. SudoEdge means an entire environment delivered as one
appliance; a GPU host within Private remains part of Private.

| Network location | Same authority | Different authorities |
| --- | --- | --- |
| Same LAN/VLAN | Authenticate native identities and apply owner grants | Explicit delegation/federation; LAN reachability grants nothing |
| Across networks | Reachable authenticated transport; preserve identity while roaming | Authenticated transport plus explicit cross-authority policy |

This refines the [Cloud plan](../sudo-cloud-plan.md), especially its shared
Cloud/Private components and trust-domain/owner distinction. It preserves the
[cohost and domain-join design](cohost-deploy-and-domain-join.md). LAN and WAN are
transport choices, not two replacement authentication schemes. A Cloud relay
can supply reachability without blanket authority over local files.

## The first Agent and each execution host

The bootstrap or "mother" Agent is an ordinary Nexus Agent, conceptually
`/agents/bootstrap/`. SudoCode inspects the deployment, applies existing component
installers, requests authorized work from other Agents and retains actual results.
It does not mint its own users, certificates or model keys. The current
`private-executor` can carry this role; no identity rename is needed. Workspace
instructions describe behavior, not additional authority.

Prefer one local operations Agent on each managed, capable execution host. Its
permissions and lifecycle belong to that host's owner. Task or specialist Agents
can share a host; one host is not limited to one Agent. Unsupported equipment is
managed through an authorized connector on another host. Device Agents need not
run inference continuously. Adding devices or Agents does not automatically add
Raft voters or make a two-node quorum appropriate.

Human, node, Agent and session identity remain distinct from model choice.
Mosswork owns the selected human-facing workbench and management integration.
Nexus owns native admission, identities and A2A. SudoCode owns local execution
and its service-host lifecycle. The minimum needs native credentials and owner
grants; it does not need another complete human IAM.

## Secret custody without a new password store

Reuse Nexus Vault and SudoCode's existing service-host Vault capability. This
facade is not an Agent-facing tool. At SudoCode main `57e2d80f`, source inspection
found no Vault registration in the tools, runtime, CLI or bundled plugins. On the
official v0.2.42 ARM64 binary, an isolated `scode mcp serve` catalog query returned
30 built-in tools and no Vault/secret/password entry. This check covers built-ins,
not every separately installed extension; it made no model or Vault request.

[SudoCode #1458](https://github.com/sudoprivacy/sudocode/issues/1458) requests a
first-party extension using the existing plugin/tool lifecycle and native custody.
SudoCode owner 7 accepted implementation; owner 8 reviews. The integration is not
yet shipped. Acceptance includes a real PTY/plugin entry, disposable Vault,
authorized target-side use, denied other-owner access, restart and canary-leak
checks. Do not equate the facade or a successful mock with that acceptance.

Mosswork
supplies human/organization policy and credential selection where its adapters
are qualified. Starting the entire Mosswork server solely to obtain a password
store is not a prerequisite for the first CLI Agent.

The current Mac candidate does not bundle or qualify Vault. Integration gates:

1. Prepare the existing service/plugin through its native lifecycle owner;
   qualify encrypted persistence, restart and recovery of its root material.
2. Resolve credential references under the current owner, Agent, purpose and
   resource scope. Agents do not inherit every secret visible to their human.
3. Inject the credential through an existing authenticated tool/runtime boundary;
   avoid secret values in model messages, A2A and logs.
4. Qualify denial for other owners, expiry/revocation and safe reauthentication.
   Fail closed when the permission or credential cannot be resolved.

The password-agent administrator CLI is not the product's multi-user Vault API.
Its standalone loopback deployment has a different trust boundary. Do not expose
that interface or copy its entire collection into Private. The manual model wizard
currently writes private account files, not qualified Vault-backed custody.

### Vault integration contract under review

The #1458 implementation direction is a first-party SudoCode plugin with
grant-limited metadata discovery and tool-side credential use. It must not expose
the existing facade's plaintext `vault.get` or `vault.batchGet` to the model.
Private/Stack supplies deployment bindings; Nexus remains the custody and identity
authority. The plugin proposal and these source checks are not runtime acceptance.

Keep the following bindings distinct:

| Binding | Existing owner | Required deployment behavior |
| --- | --- | --- |
| Human/organization and selected Agent | Trusted application policy and native identity | Resolve current grants; never infer owner authority from a model-supplied name |
| `serve-user` server identity | Nexus issuer and runtime | Match the signed owner and server name; replace the native credential bundle atomically |
| Calling session identity | Nexus issuer and client | Authenticate independently; renewal retains the signed subject and owner |
| Secret and permitted operation | Native Vault policy and approved executor | Enforce Agent, namespace/key, purpose and target scope at the authority boundary |

At Nexus `b338cd306dcc0753a509694c192a05b8bdef6d5e`, the Node client already
provides `mintSessionAgent`, `mintUserRuntime`, `renewSessionAgent` and
`createUserRuntimeCredentialBundle`. The server verifies renewal proof and retains
the existing subject and owner. `serve-user` runtime credentials have a native
300-second maximum; session-Agent certificates do not have that same maximum in
the inspected signer. A shorter session lifetime can be deployment policy, not a
claim about that signer. Re-minting a different Agent on each renewal is not needed.
Named device admission alone does not provide an owner-bound session credential;
retain the native distinction rather than substituting a named certificate for
the delegated client identity. Any durable-device/session binding needs its own
native contract.

The actual issuer coordinator, artifact versions, configuration schema and renewal
lifecycle still need qualification. Private/Stack must consume that native path,
not implement its own issuer or identity store. An initial endpoint and credential
file alone do not complete this contract. Expiry, revocation and failed renewal
must stop credential use without falling back to `serve-local` or open access.
Bundle publication uses generation-specific files and an atomic manifest switch;
replacing several fixed filenames separately can mix credential generations.

Two-owner isolation is insufficient for scoped delegation: acceptance also needs
two Agents of the same owner with different secret/use grants. Plugin-side filters
do not establish backend authorization. If those native grants or an executor-only
use operation are absent, record them as prerequisites to scoped delivery.

Credential injection targets a fixed approved operation. HTTP use binds the
origin, method, header, body schema and redirect behavior; subprocess use binds
the executable, permitted argument shape, working directory, environment and
stdin. Arbitrary model-selected commands or destinations are not such an
operation, and output scrubbing alone does not establish secrecy.
Canary acceptance covers actual tool results and subprocess output. Linux PTY
coverage is an initial gate; the delivered macOS ARM64 plugin/runtime path also
needs qualification. These checks require synthetic secrets, not the user's
personal collection.

Native dependency tracking, verified open on 2026-11-16:

| Item | Delivery relevance |
| --- | --- |
| [Nexus #578: credential bundle publication](https://github.com/nexi-lab/nexus-vfs/issues/578) | Renewable credentials for an external Agent process; reuse the existing renewal owner |
| [Nexus #579: scoped credential use](https://github.com/nexi-lab/nexus-vfs/issues/579) | Required before normal deployments enable `vault_use`; configured operations alone are not authorization |
| [Nexus #580: durable/delegated identity](https://github.com/nexi-lab/nexus-vfs/issues/580) | Design question, not a prerequisite imposed on the first plugin |
| [Nexus #581: access audit](https://github.com/nexi-lab/nexus-vfs/issues/581) | Record use and outcome at the grant boundary without secret values |

macOS ARM64 qualification remains a separate acceptance item on SudoCode #1458.
The plugin can progress with metadata and explicit refusal before #579, but that
intermediate version does not complete the password-library requirement.

## Default journey: one Cloud account

The intended managed experience is:

1. Download one architecture-matched installer from the website or SudoCloud.
2. Sign in through the existing Cloud human account flow and choose the owner,
   organization and local device being paired.
3. Use native admission to register the device and bootstrap Agent under bounded
   delegation. Human login, device credential and model entitlement stay separate.
4. Resolve or provision owner-scoped SudoRouter access through the existing Router
   authority, with model group, quota, expiry and billing owner. Store the credential
   or reference through the qualified custody path.
5. Fetch the actual permitted catalog, choose a preferred tool-capable model,
   complete a bounded real task, then guide optional component deployment.

The target flow needs no separate API-key copy/paste. Cloud login alone is not
funded model access. Existing-account linking, new-account provisioning, exhausted
quota and expired delegation each need real acceptance. No endpoint or exchange
implementation is invented here. Mosswork's machine-credential exchange is not a
Router-key or billing provisioner; credential-reference readers alone do not
complete steps 3–4.

Independent Private deployments retain manual provider configuration and an
offline/local-model option. Cloud is not a permanent prerequisite for local A2A.
Cloud inference still needs connectivity and valid entitlement. Keep the manual
SudoRouter walkthrough usable until the managed path is accepted, and later as
the independent-deployment fallback.

Preferred models are versioned configuration selected using tool success, task
correctness, latency and cost on the actual allowed catalog. The test owner's
Claude-only key is not a general GPT limitation or a release blocker by itself.
Each supported model/protocol still needs real acceptance for its scope.

## A consistent installation contract

Installer behavior comes from a versioned deployment profile and native owner
records. A strong model helps explain and execute supported steps; it does not
choose identity boundaries or improvise an installer for each customer.

The managed entry must distinguish these explicit journeys:

- **Create Private:** select its human/organization owner, create native identity
  once, and retain the resulting deployment and device references.
- **Join Private:** select an existing environment and use its native invitation
  or enrollment grant. A new network location must not create a new environment.
- **Resume or upgrade:** inspect the existing owner record, resume the same
  installation on a retry, or run the owner's explicit version upgrade. Refuse
  unrelated existing state without silently replacing it.

Record profile/artifact version, authority and owner references, device identity,
model policy and completed checks. Re-running a completed step verifies its state
rather than creating a duplicate. The same profile must lead to the same supported
operations across customers; authorized optional capabilities may differ. The
current engineering package implements fresh local preparation and retry, and
refuses unrelated existing discovery. It does not yet implement this complete
managed create/join UI or remote-device admission.

For the Singapore Mac mini, the first target is a managed device in the same
Private authority across networks. Payload staging and successful local ARM64
preparation are recorded separately from persistent Agent enrollment, session
lifetime and bidirectional A2A. Separate-Private federation requires the native
cross-domain collaboration contract; neither a shared CA client nor an SSH
transport tunnel qualifies it. Do not add a Raft voter just to make an Agent
visible.

On 2026-11-16, an ARM64 Mac mini joined the existing authority as a distinct
native Agent client. Its own certificate was issued by the existing online
MintAgent path; no Node, CA key or Raft voter was added. Six mTLS discovery
checks and idempotent publication passed. The existing deployment reports
`root` for `/agents` Stat metadata and `sharedzone` for the other two subtrees;
the native publisher's explicit client subtree declaration retained that
discrepancy instead of changing the existing topology.

A bounded native SDK canary received the Windows owner's exact authenticated
challenge, returned it as the enrolled Agent, and the Windows owner received
the authenticated response. It made no model calls. A separate single Claude
task loaded the same native session, executed `write_file`, `read_file` and
model-originated `send`, and produced the exact expected file and authenticated
return message. The temporary personal model credential was removed and the
owned tree scanned; existing application services retained their PIDs. The
SDK recorded a one-second `session/close` timeout during cleanup, although its
child exited and independent inspection found no residual test process.

These observations qualify that bounded same-authority cross-network path,
not an always-running device service or separate-Private federation. The
engineering SSH loopback transport was not tested for restart or roaming.
Payload, identity and session are retained; the test session has stopped and
no personal model credential remains. Durable hosting and scoped long-term
model entitlement remain delivery work.

### Persistent device session

Use an existing SudoCode session host and the operating system's lifecycle owner.
An attached interactive `scode` session in a persistent terminal is one candidate;
the native ACP session path is another when hosted by an accepted existing
controller. The Intel acceptance already observed native inbound peer turns with
no client `session/prompt` to the receiver. ACP client-owned notifications and
native session-owned input are different modes, not proof that ACP always lacks
inbound handling. Neither result qualifies a permanent Singapore service.

Persist the selected Agent, workspace and session reference, then recover that
same session through the host's native resume/load entry. Starting a fresh session
on every reconnect, forwarding peer messages as new prompts, or adding a Stack
mailbox scheduler would change the tested contract. Availability of an
`acp managed` child entry alone does not provide its required hosting and
credential lifecycle.

The next acceptance must cover owned-process restart, same-session recovery,
authenticated delivery across a transport interruption, and orderly shutdown.
Login/reboot survival is a separate check. Keep the model entitlement explicit:
the temporary personal key has been removed, so retain a prepared installation
rather than silently reconnecting that key for unattended inference. Hosting and
transport checks can use a local non-inference fixture while long-term entitlement
is integrated.

## Desktop and artifact reuse

Reuse Mosswork's Wails desktop shell, packaging and update UX, preserving its
interface. SudoCode service-host owns native payload lifecycle. Do not revive the
archived Sudowork frontend or add a competing supervisor.

Published [Mosswork v0.0.7 assets](https://github.com/sudoprivacy/mosswork/releases/tag/v0.0.7)
include a macOS ARM64 company DMG and a Windows installer. The company desktop
connects to its backend and starts its existing stdio worker. It is not the Private
minimum and does not start an independent local server. An optional signing build
argument does not prove a shipped asset was signed or notarized. Integrate the
current Private engineering payload with the desktop owner; renaming it is not
installer integration.

Website and authenticated Cloud download entries resolve to the same immutable
artifact per supported platform/version. Its manifest records executable hashes,
source/build provenance and compatible optional packs. Sign and notarize the final
Mac product, then test actual browser download with quarantine and Gatekeeper
intact. Retrying installation preserves native identity/configuration; version
changes use the existing owner's explicit upgrade procedure.

## Optional capability preparation

Cloud can provide catalog and download/provisioning entry; Private owns local
policy and state; Stack composes shared artifacts. Preparation and activation are
separate actions, reported truthfully by the product.

| Capability | Reused owner and placement | Preparation boundary |
| --- | --- | --- |
| Workbench/control services | Mosswork, with Private placement | Compatible desktop/server assets and accepted native execution integration |
| Cloud model access | SudoRouter authority | Entitlement and local credential/reference; no local Router just for an API call |
| Local model routing | new-api / SudoRouter | Matching image/config and provider credentials; explicit local activation |
| GPU inference/capacity | GPUStack and existing engines; qualified compute/site profiles | Target GPU/OS/architecture, drivers, digest, disk and memory |
| Training | Existing component selected by its product owner | Explicit compatible profile and resource budget; not inferred from an inference image |
| Mac development | SudoCode plus native Xcode/toolchain | Apple-native installation and OS permissions, not a Linux container payload |

Pre-download only selected compatible packs with known storage requirements.
Downloaded, verified, installed and healthy are different states. A Linux amd64
server archive is not a macOS ARM64 runtime. Spark stays in the same Private;
Edge can consume shared assembly later for its single-box profile. The local
device Agent performs authorized target-side activation. Installation does not
give the cloud controller indefinite root authority or bypass macOS TCC.

## Handoffs and acceptance

| Work | Existing owner | Current boundary |
| --- | --- | --- |
| Native minimum and artifacts | Private/Stack + SudoCode/Nexus | Intel installation and A2A measured; task correctness failed |
| Bootstrap/device roles | Private, native SudoCode/Nexus | Executor/verifier exist; additional devices and roaming need acceptance |
| Vault custody/delegated use | Nexus/SudoCode, Mosswork policy | Existing capability/source, not accepted in this bundle |
| Cloud login to model access | Mosswork/Cloud + Router | Required integration; reference readers/exchange do not prove provisioning |
| Desktop/signed distribution | Mosswork desktop + Stack/Private payload | Company installers exist; Private integration and download acceptance pending |
| Tencent migration | Existing production owner | Direction confirmed; deployed version and acceptance checked separately |

A retained production-owner observation on 2026-11-15 identified a separate
running Mosswork public server, with authenticated version lookup still pending.
It explicitly did not establish a cutover of the existing Cloud deployment.
The migration ledger remains incomplete; an available server or desktop release
is not evidence of accepted production migration.

Full Tencent production migration is **not** a prerequisite for Ji Ye's deployment.
Use an independently pinned Mosswork test deployment while the production owner
retains the old service. Keep its tenant, data, version, operator and upgrade path
explicit. The required gates depend on the stage being delivered:

- The first SudoCode/Nexus CLI development loop can be accepted without Mosswork.
- The Mosswork workbench stage must verify its actual native execution and A2A
  integration, retained sessions and current human/organization permissions.
- The one-login managed experience additionally needs device enrollment, actual
  Router model entitlement/quota and scoped credential custody. A healthy test
  homepage does not establish any of these contracts.

This avoids making the old production cutover a dependency while keeping test
deployment availability distinct from integration acceptance.

Task acceptance has three independent results: authenticated A2A mechanics,
compliance with the collaboration task, and executable deliverable correctness.
Two retained live runs demonstrated delivery; both missed a sorting defect, and
one executor claimed a verdict before the real reply. Assistant-generated
mailbox-shaped text is not authenticated input. A task stays pending until actual
peer evidence and independent checks justify completion. Later receipt does not
erase an earlier false claim. Two examples do not establish model reliability.
