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

Reuse Nexus Vault and SudoCode's existing service-host Vault capability. Mosswork
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

Task acceptance has three independent results: authenticated A2A mechanics,
compliance with the collaboration task, and executable deliverable correctness.
Two retained live runs demonstrated delivery; both missed a sorting defect, and
one executor claimed a verdict before the real reply. Assistant-generated
mailbox-shaped text is not authenticated input. A task stays pending until actual
peer evidence and independent checks justify completion. Later receipt does not
erase an earlier false claim. Two examples do not establish model reliability.
