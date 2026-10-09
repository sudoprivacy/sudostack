# Egress content gate — shared assembly

The egress content gate classifies what a write is about to send off a node
and redacts or refuses it, on the kernel write seam every write syscall
funnels through. Sudo Cloud, Sudo Private and SudoEdge assemble it the same
way; only which mounts count as egress differs by form.

| Concern | Lives in |
|---|---|
| Behaviour: hook, planes, detectors, redaction, policy | nexus-vfs `rust/egress_gate` |
| Session runtime carrying it | sudocode `nexusd-cohost`, which forwards `egress-gate` / `egress-gate-presidio` to `nexus-cluster` and composes its default service set, so the gate arrives with the feature |
| Shared assembly: build features, env contract, analyzer image, acceptance | here |
| Per-form wiring and acceptance records | each deployment repository (e.g. sudoedge runbook) |

## Build

The daemon that hosts sessions carries the gate: `nexusd-cohost` built with
`daemon,driver-ai,egress-gate-presidio` (its released build), or
`nexusd-cluster` built with `driver-ai,egress-gate-presidio`. A build without
the gate feature has no gate, and no environment variable can arm one. A
build with it claims nothing until a deployment names the mounts below, so
building it in changes no behaviour by itself.

## Configuration contract

All variables are read at boot. A value that does not parse, model mounts
named on a build without the model driver, or an analyzer named on a build
without the provider **aborts boot** — a typo in the setting that decides
what may leave never leaves the daemon running ungated.

| Variable | Meaning | Default |
|---|---|---|
| `NEXUS_EGRESS_GATE_POLICY` | `redact`, `deny` or `observe` (log only) | `redact` |
| `NEXUS_EGRESS_GATE_MODEL_MOUNTS` | comma-separated model mounts whose prompts leave the node | none gated |
| `NEXUS_EGRESS_GATE_A2A_MOUNTS` | comma-separated mounts under which conversation transcripts are shared with another domain | none gated |
| `NEXUS_EGRESS_GATE_PRESIDIO_URL` | the analyzer; must resolve to loopback | no contextual detection |
| `NEXUS_EGRESS_GATE_PRESIDIO_LANGUAGE` | analyzer language | `zh` |
| `NEXUS_EGRESS_GATE_PRESIDIO_THRESHOLD` | minimum score, 0–1 | `0.5` |
| `NEXUS_EGRESS_GATE_PRESIDIO_ENTITIES` | entity types to request | all |
| `NEXUS_EGRESS_GATE_PRESIDIO_TIMEOUT_MS` | per-write analyzer deadline | `2000` |

A transcript is gated only under `NEXUS_EGRESS_GATE_A2A_MOUNTS`, never
everywhere: a managed session's turns are themselves a conversation, so
gating every transcript would redact what a user tells the agent on their own
node. With neither mount list set, the gate is armed and claims nothing, and
says so at boot. The analyzer image is `presidio/` here; run one per gated
daemon, on loopback, because the text it classifies is sent to it.

## Assembly rules

| Rule | Why | Enforced by |
|---|---|---|
| A Router credential that can reach a non-local model channel is held only by a mount listed in `NEXUS_EGRESS_GATE_MODEL_MOUNTS`. On new-api: non-local channels sit in their own group, reached by their own token; the local mount's token is in a group with local channels only. | The gate decides by mount. One token that reaches both a local GPU and a cloud provider makes every prompt on that mount potentially egress, and the gate cannot tell which. | none (acceptance demonstrates the split; no check prevents a deployment from merging the groups) |
| Prompts to a node-local model are not gated. | The local model is the one allowed to see customer data; redacting its prompts breaks the private-data path. | `egress_gate` `test_model_plane::a_prompt_to_a_local_mount_reaches_the_model_intact` |
| Session turns are not gated; cross-domain conversations live under their own mount. | Sessions ride A2A transcripts. Only conversations shared with another domain are egress, and a path can reveal that only if they have their own namespace. | `egress_gate` `test_session_not_gated::a_session_turn_is_not_gated_by_default` (the namespace itself: none) |
| The analyzer runs on loopback. | Classification sends the content to the analyzer. | `egress_gate` `presidio::tests::refuses_an_analyzer_off_loopback` (the provider refuses any URL that does not resolve to loopback) |
| Bring a deployment up with `observe`, read the audit lines, then switch to `redact`. | A first deployment meets real traffic shapes the tests did not. | none |

Per form: on SudoEdge the local GPU mount is ungated and the cloud mount is
gated. On Sudo Cloud and Sudo Private every model endpoint is outside the
node; which of them count as egress is the tenant's or the customer's
policy, expressed through `NEXUS_EGRESS_GATE_MODEL_MOUNTS` and the rule
above.

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
two company names, a location and ordinary technical prose. Organization scores
are not multiplied down below the gate threshold. This small regression set
does not establish business-corpus precision/recall or artifact export coverage.
