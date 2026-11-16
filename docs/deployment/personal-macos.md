# Personal macOS bootstrap assembly

The customer-operated Mac and optional GPU nodes form one **Sudo Private**
deployment. SudoEdge describes a complete environment delivered in one appliance;
GPU presence alone does not select Edge. Cloud can also contain GPU nodes.
The personal placement and component pins belong in
[`sudoprivate/profiles/personal-macos`](https://github.com/sudoprivacy/sudoprivate/tree/main/profiles/personal-macos).

`tools/deploy/macos-bootstrap.sh` composes the existing SudoCode release installer,
account wizard, runtime selection and doctor. The SudoCode service-host remains
the owner of Nexus discovery and lifetime. An existing Box is reused under its
original authority; a pending Agent credential does not permit a replacement CA.
The wrapper adds no identity store, session manager, scheduler or model routing.

The [bootstrap experience design](../design/private-bootstrap-experience.md)
records the next integration: an ordinary bootstrap Agent, per-device operations
Agents, existing Vault custody, one Cloud sign-in for scoped model access, and
reuse of the Mosswork desktop installer. These are separate acceptance gates;
the current manual-account candidate below does not implement that managed flow.

The candidate stages per-deployment binaries, model configuration and a workspace
under `~/.local/share/sudoprivate/personal-macos`. It does not edit the user's
default SudoCode account files or shell startup. Native service ownership remains
shared with existing frontends. `SUDO_PRIVATE_HOME` can select another dedicated
absolute directory; it does not isolate the operating-system user's Nexus identity.
The path is resolved before mutation. HOME and its parents, symlink roots and
existing directories owned by another user are refused. A trailing slash does
not bypass those checks.

The personal profile preserves SudoCode's instruction discovery: workspace and
ancestor `AGENTS.md` / `.nexus/sudocode/AGENTS.md` files still apply. At the default
location this can include the desktop user's global instructions. A separate
model configuration directory does not isolate those instructions or create an
OS security boundary. Do not remove user instructions to make an acceptance
run pass; use a dedicated fixture outside HOME and check its ancestors instead.

## Stage the release-installer candidate

Python and Git are producer prerequisites only; the target Mac uses the bundled
shell files and macOS utilities. All three source revisions are explicit:

```sh
python tools/deploy/macos_candidate.py \
  --profile-repo ../sudoprivate --profile-commit PRIVATE_COMMIT \
  --scode-repo ../sudocode --stack-commit STACK_COMMIT \
  --output /absolute/fresh/personal-macos-candidate
```

The product profile pins the setup source and the immutable SudoCode release.
The producer reuses `artifacts.download` for the installer checksum and transport.
The SudoCode installer verifies its platform archive. Staging creates provenance
and file checksums, but does **not** create a signed/notarized release. Transfer
the complete candidate directory to an authorized test Mac, preserve executable
modes, verify `shasum -a 256 -c SHA256SUMS`, then run `bash Start.command`.
Do not bypass Gatekeeper or describe this candidate as the official download.

`configure`, `prepare`, `doctor` and `run` are separate resumable actions.
Preparation can install/start native services through the existing owner;
`doctor` does not install, start or enroll them. It diagnoses the deployment
workspace (or the bundle when no workspace exists), independent of the caller's
current project. Repeated bootstrap retains the
account files and checks the exact architecture-specific executable SHA-256
before executing it, including an already installed file. Equal version strings
do not make different source builds interchangeable. The setup wizard
asks explicitly before replacing existing configuration and preserves backups.
The launcher uses workspace-scoped permissions, without root or blanket approvals.
macOS privacy approvals and Xcode authorization remain operating-system actions.

## Acceptance boundary

Staging, configuration and `setup --check` are not product acceptance. The product
profile requires live tool use, two separate persistent Agent identities, restart
and offline delivery, authenticated access over a non-LAN path, and preservation
of an existing installation. These steps use SudoCode/Nexus's native admission
and A2A harnesses. No product two-Agent enrollment or OS autostart is supplied by
this wrapper yet. Model-list visibility is not funded inference acceptance.

The website and authenticated SudoCloud entry should eventually distribute the
same qualified package and checksum. Independent Private deployments retain
manual provider configuration. The intended managed flow links Cloud sign-in to
Router entitlement without manual key entry; it is not present in this candidate.
Signing, notarization, native Mac acceptance and both
download integrations are release gates; no current production deployment is
changed by this candidate implementation.

## Native two-Agent engineering journey

`tools/deploy/private_agents_acceptance.py` composes the existing Nexus real-Node
fixture with a clean, manifest-verified SudoCode TypeScript SDK build and actual
CLI binaries. It requires the named-Agent operator client, currently proposed
in [nexus-vfs#571](https://github.com/nexi-lab/nexus-vfs/pull/571). This is an
explicit engineering test, not an installer action:

```sh
python tools/deploy/private_agents_acceptance.py \
  --nexus-repo /absolute/nexus-vfs \
  --sdk /absolute/sudocode/sdk/typescript \
  --scode /absolute/scode --daemon /absolute/nexusd-cluster \
  --operator /absolute/nexus-agent-enroll \
  --scode-sha256 SCODE_SHA256 --daemon-sha256 DAEMON_SHA256 \
  --operator-sha256 OPERATOR_SHA256 --daemon-source DAEMON_SOURCE_COMMIT \
  --output /absolute/fresh/evidence
```

The journey grants two exact workspaces, creates separate native credentials,
checks authenticated bidirectional messages and receiver-offline delivery, then
restarts its own TLS Node and loads the saved ACP session IDs. Provider traffic
uses a loopback endpoint: catalog reads are recorded, inference is refused and
inference requests must remain zero. The private
fixture's Node records never replace the operating-system user's record.
Receipts, protocol and process logs survive; only fixture keys and databases are
removed. A passing fixture does not qualify product enrollment, OS startup,
roaming, Apple Silicon or signed delivery. Preserve any failed receipt and use
a new output directory for the next run.

Add `--activate-owner --publisher-repo /absolute/nexus-publication-source
--grpcurl /absolute/grpcurl --grpcurl-sha256 GRPCURL_SHA256` to qualify the
activation handoff too. The publisher source must support an explicit loopback
port ([nexus-vfs#572](https://github.com/nexi-lab/nexus-vfs/pull/572)). Each isolated
HOME then receives its record through the native publisher after six real mTLS
mount probes; repeated publication must preserve the record. SudoCode registers
the existing Node declaration, reuses the still-running external process, and
subsequently restores the stopped Node through its native service owner. The
same session and credential checks run after this handoff. Cleanup stops only
that registered fixture owner using its exact Node ID and binary hash. If that
stop cannot be confirmed, the private state is retained for inspection.

The official SudoCode v0.2.42 archive advertises peerInput v1, so it does not meet
this SDK journey's v2 requirement. A passing source-build journey must not be
reported as acceptance of the stable archive. The native candidate below can
stage independently pinned source builds, but compatible CLI, SDK and enrollment
artifacts must be released and qualified together for customer distribution.

That version requirement belongs to this client-owned input journey. Native
model-owned A2A does not request `peerInput`: SudoCode receives a message and
starts its own model turn. Both v0.2.42 and the tested source build contain that
path, but source presence is not artifact acceptance. Qualify any stable-artifact
substitution in a separate candidate; do not relax the v2 driver or treat a
controller's successful send as proof that a model performed the handoff.

## Resumable native activation entry

`private_agent_activation.py --declaration /absolute/private/activation.json`
composes the verified native steps for a **prepared local founder Node**. It
creates separate executor/verifier workspaces, delegates named credentials to
the native operator, registers the existing Node with SudoCode, publishes
discovery through the native authenticated publisher, and selects that owner.
It does not start the first founder process, configure a model, supervise an
Agent or install an OS startup job. Python 3.10+ is an engineering prerequisite;
the public package must supply its runtime dependencies before distribution.

The private declaration contains:

| Field | Required value |
| --- | --- |
| `schemaVersion` | `1` |
| `root`, `home` | Absolute existing dedicated deployment root and desktop user's HOME |
| `dataDir`, `identityDir` | Existing native Node persistence inside that deployment, in separate directories |
| `endpoint`, `hostname`, `zone`, `acceptEnrollments` | Actual prepared founder declaration; endpoint is `127.0.0.1:PORT` |
| `scode`, `daemon`, `operator`, `grpcurl` | Each an object with absolute `path` and exact lowercase `sha256` |
| `publisherRepo`, `nexusRepo` | Directories containing the pinned native publisher and public VFS schema |
| `publisherSha256`, `protoSha256` | Exact hashes of `scripts/cluster/publish-node-record.py` and `proto/nexus/grpc/vfs/vfs.proto` |

The producer supplies these values from qualified artifacts; version strings
alone are insufficient. Runtime source directories can be staged from those
revisions without Git. All placement paths and tool pins are checked before
enrollment. An existing different OS-user Node record is refused. A second
installation must not silently adopt or replace its owner.

The original declaration and per-Agent operation claims are retained under
`root/activation/`; they are installation recovery receipts, not an identity
registry. Repeating the same declaration replays the native operator's original
result. An Unknown issuance remains Unknown: no new name, operation or key is
chosen. Changed declarations require an explicit transition. Once discovery
exists, retry first uses the registered owner to restore an offline Node, then
repeats authenticated publication. Run logs remain private. The result keeps
inference and A2A acceptance false because activation alone proves neither.

`private_activation_acceptance.py --declaration ARTIFACT_PINS.json --sdk SDK_DIR
--output FRESH_EVIDENCE_DIR` exercises this entry against a fresh native fixture.
It substitutes only placement paths, retaining the exact tool/source pins. It
checks first activation, unchanged credentials on retry, refusal of changed
artifacts/Node/declaration, native recovery after stopping the original process,
and both Agents' actual messages and original ACP sessions. Only its own Node
and service owner are stopped; receipts survive fixture cleanup. This is the
integration gate for the activation entry, separate from public package and
first-founder installation acceptance.

## Fresh founder handoff

`private_node_bootstrap.py --declaration PRIVATE.json --bash /bin/bash` adds
the first-founder step on POSIX hosts. The declaration also pins
`launcherSha256` and `launcherCommonSha256` for Nexus's existing
`scripts/cluster/start-founder.sh` and `start-common.sh`. Data and identity may
initially be absent; their parent deployment root must already exist and be
owned by the desktop user. The entry refuses an unrelated existing Node or
changed declaration, and an OS file lock serializes installer attempts.

The bounded installer starts the native founder, enrolls and publishes through
the activation entry, stops only that initial child, and restores the same Node
through SudoCode's registered owner. It adds no resident process or supervisor.
Retries preserve the original data, identity, grant and operation claims.
Native initial logs are private because they can contain enrollment tokens.
Windows fresh bootstrap is explicitly unsupported here: Git Bash does not
provide POSIX process replacement semantics for native child termination.
Windows prepared-Node activation remains separately testable.

Add `--bootstrap-bash /bin/bash` to `private_activation_acceptance.py` to exercise
the fresh entry, owner handoff, repeated activation and recovery with real
messages. The native candidate below composes this entry with its runtime. OS
startup, Apple Silicon qualification and signed distribution remain separate
gates; a passing engineering fixture does not satisfy them.

## Stage the native Mac candidate

`private_macos_candidate.py` stages the complete native first-founder path,
account wizard and executor/verifier instructions. This is a separate candidate
from `macos_candidate.py`; it does not silently replace that profile's official
v0.2.42 pin. The producer requires Python and Git. The target entry uses macOS
utilities and a checksum-pinned relocatable Python archive supplied in the
bundle, rather than a preinstalled Python, Node, Rust or package manager.

```sh
python tools/deploy/private_macos_candidate.py \
  --profile-repo ../sudoprivate --profile-commit PRIVATE_COMMIT \
  --scode-repo ../sudocode --scode-commit WIZARD_COMMIT \
  --nexus-repo ../nexus-vfs --nexus-commit NEXUS_COMMIT \
  --publisher-repo ../nexus-publication --publisher-commit PUBLISHER_COMMIT \
  --stack-commit STACK_COMMIT --components /absolute/private/components.json \
  --output /absolute/fresh/native-macos-candidate
```

All source revisions are full commit hashes. `components.json` contains local
artifact paths and provenance, not account credentials:

| Field | Required value |
| --- | --- |
| `platform` | `macos-x64` or `macos-arm64` |
| `scode`, `daemon`, `operator`, `grpcurl` | Each has `path`, exact `sha256`, and a truthful `source` identifying the build or release |
| `grpcurl.licensePath` | The license from the same grpcurl release archive |
| `python.url`, `python.sha256` | An architecture-matching `install_only_stripped.tar.gz` asset from `astral-sh/python-build-standalone`, with its exact checksum |

The producer checks each Mach-O architecture, binary checksum, exact source
content and Python archive paths. It includes component notices, file checksums
and an `engineering-candidate` manifest. The source revision for the account
wizard and the provenance of the executable are distinct facts: a source-built
CLI must not be labeled as the official release merely because its version text
matches. `--port` can declare a different loopback port for an isolated test; the
default is 2126, and both that port and its native enrollment neighbour must be
free. Changing an installed declaration is an explicit upgrade, not a retry.

Transfer the entire candidate through the approved engineering test channel,
preserve executable modes, and verify `shasum -a 256 -c SHA256SUMS`. Run the
following as the desktop user, without sudo:

| Action | Behavior |
| --- | --- |
| `bash Start.command` | Install immutable payload, configure a missing model account interactively, then prepare the native Node and two Agents |
| `bash Start.command prepare` | Install and prepare without requesting a model key or inference |
| `bash Start.command configure` | Run the existing account wizard; replacement requires its explicit confirmation and keeps backups |
| `bash Start.command doctor` | Verify installed payload and inspect the selected configuration without starting or enrolling a Node |
| `bash Start.command executor` / `verifier` | Restore the registered owner if needed and open a new SudoCode session in that Agent's workspace |
| `bash Start.command executor --resume` / `verifier --resume` | Restore the registered owner if needed and resume that workspace's latest saved native SudoCode session |

The resume option delegates directly to `scode --resume latest` after selecting
the role workspace. Native SudoCode owns session lookup, persistence and loading;
the launcher keeps no parallel session index. If there is no saved session,
SudoCode reports that condition rather than silently creating a replacement.
Use the role entry without `--resume` for a first or deliberately new session.
This is an explicit interactive recovery entry, not unattended process restart
or OS login acceptance. These source changes require a newly staged candidate;
they do not alter the immutable bundles or acceptance receipts below.

`SUDO_PRIVATE_HOME` selects a dedicated absolute deployment root. The installed
payload is immutable, configuration is private, and existing workspace
instructions are preserved. Publication uses the desktop user's native Nexus
discovery record: an existing different Node is refused before installation,
and requires integration by its original owner. An isolated test therefore uses
both a separate HOME and a separate deployment root, with an unused port pair.
The bundled Python runtime is extracted to a private temporary directory for
each command and removed on exit; SudoCode's native service owner retains Node
lifetime after the installer exits.

No Gatekeeper bypass, OS login job, signing or notarization is supplied by this
candidate. Whole-bundle acceptance must separately cover a minimal PATH, first
preparation, idempotent repetition, diagnostics, actual Agent messages and
cleanup. A model-backed joint journey additionally needs recorded inference
and tool evidence; a controller sending native A2A messages does not establish
autonomous model coordination. Preserve failed runs, including checker failures,
and identify any later offline reassessment separately from a fresh execution.

The `5a8e242` native candidate with Private `0abdca0` passed an isolated Intel
Mac run on 2026-11-15 UTC. All 21 checksums matched. First and repeated `prepare`
commands ran with an empty environment and only the macOS system PATH; process
observations confirmed the bundled interpreter also ran the native publisher.
Retry retained the Node ID, certificates, owner profile and owner processes.
`doctor` left 75 inspected state items unchanged. The installed workspaces then
passed authenticated bidirectional and receiver-offline messages using the
existing SDK driver, with zero inference calls. Native exact-owner cleanup
released all owned processes/ports and removed fixture credentials; the shared
desktop environment was unchanged. The bundle used pinned source builds and
had no quarantine attribute, so this evidence covers neither the release
artifact set nor Gatekeeper, signing, Apple Silicon or OS startup.

The same bundle subsequently passed its real `install` wizard and both
interactive role entries on the Intel Mac. Each `/status` showed the expected
account, model, workspace, independent Agent name, same Node namespace and
healthy receiver; both `/exit` commands returned zero. The loopback provider
accepted the wizard's Bearer catalog request and the Anthropic client's
`x-api-key` catalog request, with zero inference. An earlier failed run is
retained: its test driver had not paged the real `less` output and accepted only
one catalog authentication form. The corrected driver handled real paging and
normal exit without changing deadlines, assertions or product behavior. This
qualifies interactive configuration and attachment, not funded inference or
autonomous Agent coordination.

## Native autonomous handoff and task correctness

On 2026-11-16 UTC the same native bundle completed one live Claude Sonnet 4.6
handoff on the Intel Mac. The controller sent one task prompt to the executor,
none to the verifier, and no A2A messages. SudoCode retained native ownership of
incoming messages. The executor wrote three inventory-report files and called
`agent_list` and `send`; the authenticated message woke the verifier, which read
the files and sent its own computed verdict. The reply woke the executor, which
recorded it without replying again. Both directions had matching message bodies,
correct sender identities and `verified=true`. Attribution uses actual model
tool calls/results and receiver metadata, not the controller's direct-send audit.

The original runner exited zero, but a separate offline reassessment found a
real task defect. The generated script sorted complete `location,total` lines
instead of the location field: `A+` appeared before `A`, and `Bay 2` before `Bay`.
Both inputs satisfy the original task requirements. The verifier's sample totals
were correct, but its code review missed this defect; the independent checker's
initial fixtures missed it too. The unchanged script failed both counterexamples
under the same write/network-denying sandbox. Preserve the original passing
execution and the later reassessment separately: **autonomous handoff passed;
deliverable correctness and overall task acceptance failed**. A second Agent's
agreement is not a substitute for executable checks of the declared behavior.

The model phase took 117.3 seconds within its 180-second bound, with no permission
requests, cap hits or retries. Nine final model responses reported 88,575 tokens,
including cache creation/read tokens; Router billing was not independently
checked. Both Agents used the same model/account. The verifier read and reasoned
about the files; only the independent checker executed the script. Temporary
credentials and owned processes were removed and shared desktop state remained
unchanged. This is one source-build run, not reliability, official-artifact,
Apple Silicon, OS startup or cross-network qualification. The autonomous harness
and its receipts remain private engineering evidence, not a committed CI suite.

## Official CLI candidate and remaining collaboration failure

A separate Intel candidate substitutes the official v0.2.42 executable while
retaining the declared wizard, SDK and native Nexus components. The release
archive matched its GitHub asset digest and published checksums; the producer
recorded executable provenance separately from wizard source. First/repeated
preparation, diagnostics and both interactive entries passed with zero inference.
Identity and credentials stayed stable; diagnostics changed none of 75 state
items. This confirms the installation/receiver path for that exact composition.

One subsequent live run demonstrated model-initiated send, authenticated native
wake and reply with this official executable, without peerInput ownership or
controller A2A calls. It nevertheless failed task acceptance: both prefix
sorting cases failed again, and the executor authored a fake verifier mailbox
message and verdict before the real reply. The forged text was assistant output,
not native authenticated input. The original checker inspected only the last
verdict and missed that temporal violation. Preserve its narrow handoff result
and the additional observation separately: **native A2A mechanics passed;
collaboration contract, deliverable and overall task acceptance failed**.
Later correct receipt does not erase an earlier unsupported completion claim.
Use native incoming-message metadata and causal order when checking completion;
never authenticate text merely because it resembles a mailbox wrapper.

The live model phase stayed within the original 180-second bound, with one run,
no retry and no permission expansion. Eleven final model responses reported
117,478 tokens including cache tokens; billing was not independently checked.
Fixture credentials/processes were removed and shared state was unchanged.
The Private profile's subsequent pending-state and evidence instructions are
not yet behaviorally qualified and do not alter these immutable candidates.

An ARM64 engineering candidate was staged separately on Windows: all 21 file
checksums and four Mach-O architectures matched. Its SudoCode executable is the
official v0.2.42 release; both Nexus executables come from CI at `49be2e0f`, with
artifact ZIP digests verified before staging. Its daemon therefore differs from
the Intel `ce3d3554` build. Staging alone did not qualify target execution.

On 2026-11-16 the unchanged ARM64 candidate subsequently ran on an authorized
Singapore Mac mini (macOS 27.0, 16 GiB). Its manifest SHA-256 was
`c23faa12b3edc3bde7df6609c5743f809d4648e9f1d289013be0abf2699821e8`.
All 21 bundle checksums and four executable architectures matched. With isolated
HOME, deployment root and ports, first preparation took 14.89 seconds, repeated
preparation 1.15 seconds, and doctor 0.95 seconds; all exited zero. Native
enrollment created executor/verifier credentials and authenticated publication
handed the founder to the SudoCode owner. Retry retained its identity and
configuration; doctor changed none of 39 inspected stable files.

Exact-owner cleanup returned `stopped=true` with `child_kill_and_wait`; no fixture
listener or service remained, and generated credentials were removed. Existing
Merlion jobs and the inspected user configuration remained unchanged. The private
receipt retains the commands, hashes and observations. No model account was used.
This establishes ARM64 engineering preparation and diagnostics, not an A2A task,
funded inference, Gatekeeper, signing/notarization, login/reboot or roaming. The
older role files in this immutable candidate are unchanged by later design edits.
## Remote enrolled-device canaries

`tools/deploy/private_remote_a2a_acceptance.cjs` uses the existing SudoCode
TypeScript SDK against an already enrolled client. Its JSON input pins `sdk`,
`sdkSource`, `scode`, `scodeSha256`, an existing `workspace`, a fresh `output`,
the enrolled `actor`, an authorized `peer` and a random 32-character hexadecimal
`nonce`. Run it with an existing Node.js runtime:

```sh
node tools/deploy/private_remote_a2a_acceptance.cjs /absolute/private/canary.json
```

After `ready.json`, the authorized peer sends exactly `SG-A2A-CHALLENGE NONCE`.
Only that authenticated sender and exact nonce produce a single native reply.
The peer must independently verify the authenticated `SG-A2A-RETURN NONCE`;
the sender's submission receipt alone does not prove delivery. The canary
allows five minutes, invokes no model, and closes its own native session.
Client-owned peer input version 1 is intentional for official SudoCode 0.2.42;
this transport fixture is not an autonomous Agent host.

`private_remote_model_acceptance.cjs` accepts the same pins plus an existing
`sessionId` and a private disposable `modelConfigHome`. The latter must contain
an explicitly authorized SudoRouter account named `sudorouter`, model
`claude-sonnet-4-6` and `maxSteps: 4`. It submits one prompt with a 180-second
cap and only permits file writing, reading and native sending. It removes the
disposable credential copy after closing its own connection. An outer operator
must also verify cleanup and absence of key bytes; never point it at the user's
original configuration. Keep all inputs and evidence outside version control.
Use real file/tool output and the peer's authenticated delivery to assess the
task, and retain shutdown diagnostics independently of the task result.

The 2026-11-16 ARM64 run passed both task/transport checks. The model run's ACP
close timed out after one second before child cleanup; independent inspection
found no remaining owned process or temporary key. The artifact and session
were retained. This is not reboot, roaming, uptime or signed-installer acceptance.
