# Shared DLP composition and admission

The shared text DLP assembly uses the following owners. A detector result alone
does not admit the assembly: the runtime must also prove that protected content
does not leave and that normal local inference remains usable.

| Direction | Selected component | Admission evidence |
|---|---|---|
| Contextual text recognition | Microsoft's Presidio Analyzer + spaCy Chinese/English pipelines, pinned container base | Three fresh starts, synthetic recognition regressions, full pinned public-corpus reports |
| Structured identifiers and secrets | Nexus `egress_gate` checksum/format and credential detectors | Owner tests; shared real Router wire acceptance |
| Customer lists and public-company exceptions | Deployment-owned literal business policy in this repository | Policy unit tests, real analyzer tests, actual cohost/Nexus write and wire assertions |
| Redact, deny and provider failure | Nexus kernel write hook and gate policy | Zero downstream requests for rejected writes and analyzer outage; valid redacted JSON; local originals retained |
| Model routing | `sudoprivacy/new-api`, separate local/external token groups | Both routing and restart acceptance in the deployment repository |
| Public evaluation | TAB + PII Bench ZH pinned adapters here | Exact Unicode spans, full span/character coverage, unsupported categories and source licenses retained |
| Application workflow | Moss → ManagedAgentService → cohost → Nexus model mount | Deployment's browser/session acceptance; the model-write runner does not exercise this entire path |

Presidio remains upstream. We do not need a fork to add deployment policy.
The public comparison in [pii-detect-model](https://github.com/whyiug/pii-detect-model/blob/873d3beed438df3e00e12be3cce54346e152973b/docs/benchmark_landscape.md)
is useful evidence for evaluating Chinese hybrids, but not sufficient to select
that package as a production dependency: it is a release candidate and its
[CLUENER model preparation](https://github.com/whyiug/pii-detect-model/blob/873d3beed438df3e00e12be3cce54346e152973b/docs/community-model-service.md)
explicitly records an undeclared upstream weight license. OpenAI's
[Privacy Filter](https://github.com/openai/privacy-filter) is an Apache-2.0
candidate for a separate measured comparison. Neither candidate is a default
dependency of this assembly.

## Deploy the shared analyzer

Run from `presidio/` on the gated node:

```bash
docker compose -f compose.yml up -d --build --wait
curl --noproxy '*' --fail http://127.0.0.1:59080/policy
```

To install an organization policy, set `DLP_POLICY_FILE` to an absolute file path
readable by container uid 1001. It must exist; Compose will not create a directory
for a missing policy. Set `PRESIDIO_PORT` to a free loopback port when accepting a
candidate alongside a running deployment. The kernel's configured analyzer URL
must point to this same service. Keep tenant policy files outside Git; the checked
in fixture is synthetic. No tenant values are returned by `/policy`.

The exact version-1 schema is:

```json
{
  "version": 1,
  "public_organizations": ["a company whose exact NER span may be public"],
  "protected_terms": ["a customer name or alias protected even if NER misses it"],
  "protected_markers": ["an explicit marker classifying the whole submitted text"]
}
```

Matching is case-sensitive, literal and uses Unicode code points. Include aliases
and case variants explicitly. `public_organizations` suppresses only an exact
`ORGANIZATION` finding, not other entities or longer names. Protected terms and
marked records always take precedence, including when the caller selects fewer
NER entities or a higher NER threshold. A marker protects all analyzed prose in
that write: it is explicit record classification, not semantic understanding of
a request discussing customer lists. This can deliberately over-redact a marked
write. Client allow-lists and ad-hoc recognizers are rejected on this service.

Policies are loaded at worker startup. Malformed/missing configuration aborts
startup. To change a mounted policy, recreate the analyzer and verify the new
`/policy` hash; repeat a real model write. This is deployment configuration, not
an admin WebUI or policy management API.

## Repeatable runtime acceptance

On Linux with Docker and systemd user units:

```bash
export GATE_BIN=/absolute/path/to/released/nexusd-cohost
export NEXUS_VFS_PROTO=/absolute/path/to/that/nexus/revision/proto
export NODE_MODULES=/absolute/path/to/grpc-js-and-proto-loader/node_modules
export PRESIDIO_IMAGE=sudo-presidio-zh:local
python3 acceptance/business-wire.py
```

The runner boots isolated cohost/Nexus daemons with real TLS and real hooks.
It refuses an existing `WORK` directory, retains evidence, and stops only the
containers and transient units it created. It uses a synthetic loopback model by
default and labels that scope. To additionally require real inference:

```bash
export ROUTER_URL=https://your-router-origin
export ROUTER_KEY=your-dedicated-test-token
export MODEL=your-enabled-model
export LOCAL_ROUTER_URL=http://127.0.0.1:3000
export LOCAL_ROUTER_KEY=your-local-only-router-token
export LOCAL_MODEL=your-local-model
python3 acceptance/business-wire.py
```

The token is inherited in memory and never printed or saved in captures.
The `LOCAL_*` settings keep the raw local control on the node-local Router when
the protected mount targets a cloud model. If omitted, both routes use the same
configured Router; that arrangement is useful for a synthetic or local-model run.
The recording endpoint asserts on actual request bodies. It waits for terminal
reply events instead of assuming a stream exists immediately after Write.
Redact covers ordinary and ASCII-escaped JSON writers; deny and outage assert
request counts including clean allowed traffic. Both policies preserve original
local-model input. `acceptance/run.sh` additionally exercises the native identity,
phone, card and credential rules. Choose a deployment's real external token and
verify its upstream channel to establish cloud inference; a loopback local model
does not establish that fact.

## Minimum bar and remaining admission gaps

Hard gates for the supported text/model path are: all explicit protected-list
and marked-record fixtures are protected; denied writes and unavailable detectors
emit zero requests; redaction preserves JSON routing fields; public-company and
clean fixtures stay usable; local prompts retain their originals; policy identity
survives analyzer recreation; and latest CI passes. These must all pass.

Contextual NER needs a separate release decision on held-out target-domain data.
The current public baseline has only 49.47% strict chat PERSON recall and 28.63%
full chat address coverage. It is **not admitted as general Chinese DLP**. A
successful test process or high pooled score must not hide per-type missed spans.
The public synthetic corpus has no clean-document set or company-name gold, so
business negatives and organization annotations must be added independently.
Set target-domain per-type precision/recall and clean-document false-positive
limits with the customer before admitting statistical recognition for their data.

Other explicit gaps: a production external model mount/credential must be accepted;
actual cross-domain A2A and artifact export require their sending-node routes;
binary/OCR/archives, obfuscation and unlabelled customer lists are outside this
text assembly; structured tool values outside Nexus's current prose-key selection
are not all covered by contextual recognition. The deterministic rules still scan
all bytes. These gaps cannot be converted into passes by substituting a detector.
