# Egress content gate — shared assembly

The egress content gate classifies what a write is about to send off a node
and redacts or refuses it, on the kernel write seam every write syscall
funnels through. Sudo Cloud, Sudo Private and SudoEdge assemble it the same
way; only which mounts count as egress differs by form.

| Concern | Lives in |
|---|---|
| Behaviour: hook, planes, detectors, redaction, policy | nexus-vfs `rust/egress_gate` |
| Session runtime carrying it | sudocode `nexusd-cohost`, which forwards `egress-gate` / `egress-gate-presidio` to `nexus-cluster` and composes its default service set, so the gate arrives with the feature |
| Shared assembly: policy contract, storage, delivery, analyzer image, acceptance | here and `packages/egress-policy`, `packages/user-runtime` |
| Authenticated policy administration and UI | Moss |
| Per-form wiring and acceptance records | each deployment repository (e.g. sudoedge runbook) |

## Build

The daemon that hosts sessions carries the gate: `nexusd-cohost` built with
`daemon,driver-ai,egress-gate-presidio` (its released build), or
`nexusd-cluster` built with `driver-ai,egress-gate-presidio`. A build without
the gate feature has no gate, and no environment variable can arm one. A
build with it claims nothing until a deployment names the mounts below, so
building it in changes no behaviour by itself.

## Live configuration contract

The live-policy runtime uses one deployment variable,
`NEXUS_EGRESS_GATE_CONFIG`, pointing to a controller-owned JSON file. The
shared [policy package](../../packages/egress-policy) validates the complete
document and owns scoped storage and revision conflicts. The existing native
`egress_gate` service reloads an admitted revision before an outbound write.
It exposes read-only `get_policy_status_v1`; agents have no policy mutation RPC.

Moss supplies platform defaults and organization overrides through its
authenticated settings API and **Data egress protection** admin page. The
shared runtime SDK projects the policy read-only in managed cohost Pods or
atomically replaces a trusted host cohost's policy file. Saving a desired
revision and applying it are separate states, compared against the native
service's actual report. The deployed runtime must carry this interface;
source availability alone does not prove a production rollout.

The deployment repositories own initial profiles: Cloud defaults disabled
with `/model` declared external; Edge protects `/cloud-model` and excludes
local GPU `/model`; Private starts disabled until its customer's outbound
boundary is configured. Bootstrap files seed fresh storage. Subsequent edits
use the policy API and persist in Moss storage.

`modelMounts` identifies external model planes. `a2aMounts` identifies only
cross-domain transcript planes: ordinary local session history retains its
original content. Empty lists assert no coverage for those planes. Invalid
startup policy aborts boot; malformed or rolled-back replacement policy denies
writes on the last admitted planes until a valid revision is restored.

`redact` replaces supported sensitive prose and denies detection failures or
unsafe redaction. `deny` rejects sensitive writes. `observe` sends the original
content and does not enforce confidentiality. Disabling the policy passes
content unchanged while retaining the service and its applied status.

The analyzer image is shared in `presidio/`. Host cohosts can call it directly
on loopback. Managed runtimes can use the
[node analyzer transport](node-analyzer/README.md), which loads one Chinese
model per node and retains the native loopback-only analyzer boundary.
Business-policy edits travel on each trusted classification request, without
restarting the analyzer and without persisting another organization's rules.

## Assembly rules

| Rule | Why | Enforced by |
|---|---|---|
| A Router credential that can reach a non-local model channel is held only by a mount listed in policy `modelMounts`. On new-api: non-local channels sit in their own group, reached by their own token; the local mount's token is in a group with local channels only. | The gate decides by mount. One token that reaches both a local GPU and a cloud provider makes every prompt on that mount potentially egress, and the gate cannot tell which. | none (acceptance demonstrates the split; no check prevents a deployment from merging the groups) |
| Prompts to a node-local model are not gated. | The local model is the one allowed to see customer data; redacting its prompts breaks the private-data path. | `egress_gate` `test_model_plane::a_prompt_to_a_local_mount_reaches_the_model_intact` |
| Session turns are not gated; cross-domain conversations live under their own mount. | Sessions ride A2A transcripts. Only conversations shared with another domain are egress, and a path can reveal that only if they have their own namespace. | `egress_gate` `test_session_not_gated::a_session_turn_is_not_gated_by_default` (the namespace itself: none) |
| The analyzer runs on loopback. | Classification sends the content to the analyzer. | `egress_gate` `presidio::tests::refuses_an_analyzer_off_loopback` (the provider refuses any URL that does not resolve to loopback) |
| Bring a deployment up with `observe`, read the audit lines, then switch to `redact`. | A first deployment meets real traffic shapes the tests did not. | none |

Per form: on SudoEdge the local GPU mount is ungated and the cloud mount is
gated. The Cloud profile declares `/model` external. Private deployments
classify their model endpoints against the customer's boundary. Policy
`modelMounts` declares the external planes in each form.

## Boundary

The gate sees exactly the writes that cross its daemon's kernel: prompts on
the model mounts it was given, and transcripts under the cross-domain mounts
it was given. Content
that leaves by another route is governed by the controls on that route —
network policy for sandbox egress, the Router's channel groups for model
traffic that does not pass through a mount, and the transport for messages a
node writes straight to a remote broker. For cross-domain A2A to be gated, the
messages travel through the sending node's own daemon first.

## Acceptance

`acceptance/managed-session.py` exercises real managed ACP sessions against a
caller-supplied `nexusd-cohost` executable. Set `GATE_BIN`, `NEXUS_PROTO_ROOT`
(the matching Nexus proto directory), and `NODE_MODULES` (containing
`@grpc/grpc-js` and `@grpc/proto-loader`). `WORK` must name a fresh private
evidence directory. Linux uses owned transient user units; set
`GATE_PROCESS_MODE=1` to use owned child processes, including on Windows.

With `LIVE_POLICY=1`, one daemon runs disabled, redact, deny, analyzer outage,
invalid analyzer output, and disabled again. The runner asserts actual native
revision receipts, original local history, visible replies, and upstream
request counts `1,1,0,0,0,1`. Session credentials use the production
controller delegation flow. The analyzer fault endpoints and model upstream
are synthetic loopback fixtures. The
[Windows candidate receipt](acceptance/evidence/managed-live-policy-20261025-windows.json)
and [Linux ARM64 receipt](acceptance/evidence/managed-live-policy-20261025-linux-arm64.json)
record exact source and executable digests; they prove native session
enforcement, while production rollout and real model quality require separate
deployment acceptance. Keep generated TLS material outside Git.

With `PROVIDER_ROUTES=1`, also set `SHARED_MODEL_BUILDER` to the built SDK's
`dist/modelConfiguration.js`. The same runner uses
`buildCohostModelConfiguration` to declare independent `/model` and
`/cloud-model` accounts with different credentials and provider-qualified
aliases for the same upstream model ID. A local control retains its original
prompt while the cloud case is redacted. An undeclared alias must fail before
the original cloud selection continues. The
[Linux ARM64 provider-route receipt](acceptance/evidence/managed-provider-routes-20261025-linux-arm64.json)
records seven cases with upstream counts `1,1,1,0,0,0,1`, credential selection,
raw upstream model IDs and native policy receipts. This is a synthetic model
control, not a GPU or production cloud-model acceptance.

Set `SCODE_BIN` to a caller-supplied CLI executable to run the same matrix with
real `scode --print` processes. The runner mints each CLI's node credential,
uses a private home and node record, and checks the local transcript plus the
same native policy receipts and upstream observations. It records both daemon
and CLI executable digests. The user's node record and credentials are untouched.
The CLI adds peer-only HTTP and unattached HTTP controls; both retain direct
model behavior outside DLP. A managed CLI profile must choose a Nexus model
route for coverage. The [CLI candidate receipt](acceptance/evidence/cli-live-policy-20261025-windows.json)
records all eight cases and uses the shipping CLI dependency tag without a
local override. Candidate receipts do not establish production deployment.

`acceptance/run.sh` starts a gate-armed daemon, the analyzer, and a recording
proxy in front of the real Router, then sends a prompt with a synthetic name,
identity number, mobile, card and API key to a gated and an ungated mount —
once as written and once escaped the way Python's `json.dumps` writes it. It
asserts on the bytes the proxy forwarded: the gated route carries only
redaction markers, the ungated route carries the originals, the real model
answers all three, and the daemon log never contains a raw value. The script
header lists its inputs; `MODEL_MOUNTS=` and `PRESIDIO=0` are its red
controls. Each deployment records its run in its own runbook.

`acceptance/analyzer-regression.py` calls the real Chinese analyzer at the gate's
default `0.5` threshold. CI builds the pinned analyzer image and checks two names,
two company names, a location and ordinary technical prose on three fresh starts.
The image disables Gunicorn's unused control socket because the pinned base has
a [worker startup deadlock](https://github.com/benoitc/gunicorn/issues/3529).
HTTP health checks and container lifecycle management remain available.
Organization scores are not multiplied down below the gate threshold. This small regression set
does not establish business-corpus precision/recall or artifact export coverage.

[evaluation/](evaluation/README.md) holds shared public-corpus source pins,
adapters and analyzer quality reports. It evaluates recognition separately from
masking policy and records excluded categories; runtime acceptance continues to
assert on the actual exported bytes.

[COMPOSITION.md](COMPOSITION.md) records the selected components, shared Compose
deployment, configurable customer-list/public-company policy, runtime wire runner
and admission gaps. The policy is installed after upstream recognition; an
explicit protection cannot be removed by a caller's NER entity filter.
