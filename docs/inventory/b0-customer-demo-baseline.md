# B0 customer-demo baseline inventory

This document defines the evidence record that must exist before `SUDOSTACK-ASSEMBLY` or a G3 mixed-version/rollback rehearsal. It is an inventory and rehearsal specification, **not** a deployment manifest, migration instruction, release approval, or second Contract source of truth.

> **Manual gate:** the operational requirements in this document are currently `[enforced_by: none]`. No repository CI job consumes this inventory template, so a syntactically valid or fully populated JSON file is not by itself assembly/G3 approval.

The companion machine-readable template is [`manifests/inventory/b0-customer-demo-baseline.template.json`](../../manifests/inventory/b0-customer-demo-baseline.template.json). This document owns the human-readable collection and rehearsal procedure; the JSON stores per-environment evidence and points back to these stable IDs instead of copying Contract definitions. Copy it to an access-controlled evidence location for each environment; do not commit customer values or secret-bearing evidence to this repository.

## Current state and hard boundaries

Source cut: 2026-09-18; current F1 branch head `b966826edada1c2c1086ab6ee46cec9f85a398b5`.

| Item | Current state | Evidence status |
|---|---|---|
| ADR-005 | `Proposed` | Confirmed-Code |
| Contract baseline | Manifest-declared `draft-frozen`; alignment with the ADR real-consumer freeze criterion is unresolved | Conflicting |
| F1 Contract artifact | `candidate_unpublished` | Confirmed-Code |
| F1 manifest-declared deployment state | `not_deployed`; this is not an observation that no out-of-band deployment exists | Confirmed-Code; live state Unknown |
| Live B0 environment evidence | No live evidence was supplied or collected by this work item | Unknown |
| Target Contract consumer | Moss, `ZoneId` production argument-construction boundary; merged PR tests cover the helper, but the production startup call does not pass `clusterInit` | Conflicting; assembly-blocking |
| Confirmed production Contract consumers | None at the inspected revisions | Confirmed-Code |
| `ResourceRef` | Owner source is present in the proposed source closure, but there is no current production provider/consumer | Confirmed-Code; deferred |
| `ZonePath` | Owner source dependency for the deferred `ResourceRef` family; no G3 runtime adoption claim | Confirmed-Code; deferred |
| SudoWork and sudocode Contract consumers | Not in the included consumer set | Expected; deferred |
| `sudowork-server` | Retirement target; inspect only to discover a remaining B0 dependency | Legacy-Declared |
| Confirmed deployment records | **0** | — (count, not an evidence claim) |

The source references below span merged owner and consumer/F1 pull requests plus a docs-only post-merge F1 branch correction. VCS status, code existence, tests, package installation, or a green pull request does not establish that a customer environment runs those bytes. Only evidence gathered from the selected live environment may use `Confirmed-Deployment`.

## Evidence status vocabulary

Every material field and assertion uses one of these values:

| Status | Meaning |
|---|---|
| `Expected` | Required by the target architecture or this rehearsal procedure, but not observed in code or a live environment. |
| `Confirmed-Code` | Directly observed at the cited immutable repository revision or generated artifact. It says nothing about deployment. |
| `Confirmed-Deployment` | Directly observed from the selected running environment and tied to a timestamp plus an access-controlled evidence reference. |
| `Inferred` | Derived from indirect evidence; the inference and its assumptions must be recorded. It cannot satisfy an assembly or G3 blocking field. |
| `Conflicting` | Two or more sources disagree. Record every source and resolve the conflict before using the field as a gate. |
| `Unknown` | No adequate evidence exists. Do not replace it with a source-tree default or a likely value. |
| `Legacy-Declared` | Declared by historical, branch-only, or retirement-target material. It is useful for discovery, not a current release or deployment fact. |

`applicable`, `not_applicable`, and `unknown` are applicability values, not evidence statuses. An item can therefore be `not_applicable` with `Expected` architecture evidence, while its actual deployment state remains `Unknown`.

## B0 and B1 are different records

The proposed ADR defines B0 as the exact currently working customer baseline and B1 as an exact candidate derived from it. Its B0 clauses require recording the currently working SudoStack, Moss, SudoWork, `sudowork-server`, Nexus, sudocode, and nexus-vfs versions/artifacts/configuration, critical smoke, and a recoverable rollback target; prohibit forced immediate database migrations, historical Zone renames, legacy-route deletion, or repository-wide DTO replacement; and require an explicitly selected legacy/demo profile until mixed-version smoke and rollback pass. All three clauses are currently [`enforced_by: none`](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/docs/adr/ADR-005-product-contract-versioning.md#L139-L143).

`SUDOSTACK-ASSEMBLY` and G3 are initiative coordination labels, not identifiers defined in the current F1 tree. The entry criteria in this inventory operationalize the proposed ADR's [exact-assembly/demo exit conditions](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/docs/adr/ADR-005-product-contract-versioning.md#L314-L320); they do not add a Contract family or alter ADR status.

The operational consequence is:

- **B0** must be captured from a real selected environment: profile, running repository revisions, immutable artifact digests, actual runtime versions, sanitized configuration references, Schema/database migration state, Zone identifiers, smoke observations, and rollback references. This work item has no such live evidence, so every B0 value remains `Unknown`.
- **B1** may start from repository evidence, but its built package/image/binary digests and deployed observations remain `Unknown` until assembly. The proposed source chain is exact; it is still `candidate_unpublished` and `not_deployed`.
- B0 values must never be filled from current checkout HEADs, a Dockerfile tag, a package manifest, a design document, or the B1 candidate. Those sources can guide collection but cannot prove what is running.

### Proposed B1 source chain

These immutable revisions identify the candidate source closure and included consumer. They are not B0 rollback refs and not deployment evidence.

| Role | Exact revision | Status | Evidence |
|---|---|---|---|
| `ZoneId`/`ZonePath` semantic owner | `nexi-lab/nexus-vfs@24f6730ec90fab8a035b2f5400ed313bda343fbe`; ZoneId source SHA-256 `6f5fb408d08de19172ac1d10b793a143588494ec6dae5326e60f9de5a2bce4d7` | Confirmed-Code; PR 288 merged as `f0cb457f200b84a4809d3ca41ea289a0c05dd450` | [merged nexus-vfs PR 288](https://github.com/nexi-lab/nexus-vfs/pull/288), [exact ZoneId pin](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/contracts/zone-id/pin.json#L7-L28) |
| `ResourceRef` semantic owner source | definition `5139e2019d7f46d4dde3f73ee6cd21bb094a7dc1`, provenance `759842551697efa2579a92f24b16f8ae43829e7b`; Schema SHA-256 `15ce4b2ed53f1278a40dc313a837e170a77fb4ea026022898479dd0135b798b7` | Confirmed-Code; PR 4801 merged as `b0a0204737b3e43703d130ea02482bd8ab65664a`; runtime adoption deferred | [merged Nexus PR 4801](https://github.com/nexi-lab/nexus/pull/4801) |
| Exact-pin/derive/distribute candidate | private package `@sudo/contracts@0.2.0`; content `30da0ddd953268ff8a9a0f0980276300ab153003`, activation `60bd8dda6fb2d348ec8571b9b1a4eaa535e36dc5`, source-availability revision `aec52e9dc5438946dd83d5c56c07149a4800120a`, current docs-corrected F1 head `b966826edada1c2c1086ab6ee46cec9f85a398b5` | Confirmed-Code; PR 18 merged at `aec52e9…`; remote F1 branch advanced docs-only to `b966826…`; `candidate_unpublished`; `not_deployed` | [SudoStack PR 18](https://github.com/sudoprivacy/sudostack/pull/18), [candidate manifest at current F1 head](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/manifests/releases/0.2.0-candidate.gen.json#L218-L287) |
| Included target consumer for `ZoneId` | `sudoprivacy/moss@69615e049b8b7dbfc44f5362c1418d5fd715d8ab` | Conflicting; PR 272 merged; tests exercise the helper but the production startup caller omits the ZoneId | [Moss PR 272](https://github.com/sudoprivacy/moss/pull/272), [production call](https://github.com/sudoprivacy/moss/blob/69615e049b8b7dbfc44f5362c1418d5fd715d8ab/src/server/nexus/nexusManager.ts#L313-L346), [direct helper tests](https://github.com/sudoprivacy/moss/blob/69615e049b8b7dbfc44f5362c1418d5fd715d8ab/src/server/__tests__/nexusZoneId.test.ts#L25-L58) |

The G3 **target consumer set is Moss/`ZoneId` only**, but the inspected merged Moss revision does not yet make that a production consumer: embedded startup omits `clusterInit`, external mode returns before argument construction, and only tests pass a ZoneId directly to the helper. The confirmed production-consumer set is therefore empty and assembly remains blocked on real boundary wiring plus default-CI evidence. Nexus owner artifacts are part of the source closure, but `ResourceRef` has no production provider/consumer and is excluded from mixed-version and deployment claims. SudoWork, sudocode, and `sudowork-server` are not candidate consumers in this scope.

## Repository-derived evidence and unresolved facts

The immutable sources establish candidate identity and collection hints, not a coherent B0 deployment:

| ID | Observation | Status | Exact evidence or consequence |
|---|---|---|---|
| E-01 | This inventory worktree is based on SudoStack inventory commit `1c26d4c3044efe4fcd0d88ed61201c3e1d828fc1`; that tree still declares `@sudo/contracts` `0.1.0` and contains no checked-in deploy/profile/submodule spine. | Confirmed-Code | [`package.json` at the inventory base](https://github.com/sudoprivacy/sudostack/blob/1c26d4c3044efe4fcd0d88ed61201c3e1d828fc1/package.json); [inventory base tree](https://github.com/sudoprivacy/sudostack/tree/1c26d4c3044efe4fcd0d88ed61201c3e1d828fc1) |
| E-02 | Current remote F1 branch head `b966826edada1c2c1086ab6ee46cec9f85a398b5` carries the proposed B0/B1/rollback clauses, corrected implementation-status prose, and unchanged generated candidate/source-closure manifests. | Confirmed-Code | [ADR-005 at current F1 head](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/docs/adr/ADR-005-product-contract-versioning.md); [source closure](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/manifests/source-closure.gen.json) |
| E-03 | The candidate records exact owner revisions and reports `candidate_unpublished` plus `not_deployed`; actual producer/consumer declarations in the candidate remain empty. | Confirmed-Code | [candidate manifest](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/manifests/releases/0.2.0-candidate.gen.json) |
| E-04 | Nexus VFS supplies owner-local `ZoneId`/strict `ZonePath` sources and conformance artifacts at the merged owner revision. | Confirmed-Code | [merged nexus-vfs owner tree](https://github.com/nexi-lab/nexus-vfs/tree/24f6730ec90fab8a035b2f5400ed313bda343fbe/contracts) |
| E-05 | The merged Nexus owner revision supplies the draft-frozen `ResourceRef` owner source, but this initiative has no production `ResourceRef` caller. | Confirmed-Code | [Nexus owner manifest](https://github.com/nexi-lab/nexus/blob/759842551697efa2579a92f24b16f8ae43829e7b/src/nexus/contracts/schemas/common/v1/resource-ref.manifest.json); [merged Nexus PR 4801](https://github.com/nexi-lab/nexus/pull/4801) |
| C-04 | Moss PR 272 is the target consumer change, but at its exact head the production embedded-start caller omits the optional `clusterInit` argument and external mode bypasses argument construction; only tests pass ZoneIds directly to the helper. | Conflicting; assembly-blocking | [production caller and external-mode branch](https://github.com/sudoprivacy/moss/blob/69615e049b8b7dbfc44f5362c1418d5fd715d8ab/src/server/nexus/nexusManager.ts#L313-L346); [validator guard](https://github.com/sudoprivacy/moss/blob/69615e049b8b7dbfc44f5362c1418d5fd715d8ab/src/server/nexus/nexusManager.ts#L136-L159); [direct helper tests](https://github.com/sudoprivacy/moss/blob/69615e049b8b7dbfc44f5362c1418d5fd715d8ab/src/server/__tests__/contractsActivation.test.ts#L57-L71) |
| E-07 | Cloud, Private, and Edge are expected Atlas-hosting profiles sharing the SudoStack spine; Local explicitly has no Atlas. | Expected | [`README.md` profile model](https://github.com/sudoprivacy/sudostack/blob/1c26d4c3044efe4fcd0d88ed61201c3e1d828fc1/README.md#L137-L223) |
| E-08 | Repository package/runtime/config/migration declarations can disagree and are not release identities or deployment facts. A complete B0 must use running-artifact and live database evidence instead. | Confirmed-Code | See the component hints below; any unresolved disagreement is `Conflicting`, never silently selected. |
| E-09 | Current F1 head `b966826…` requires Node `>=22.21.0` and records CI Node `22.21.0`; merged Moss PR 272 aligns supported server build/deploy paths to Node `22.22.1`, but the actual running runtime remains Unknown. | Confirmed-Code | [F1 package metadata](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/package.json#L1-L9); [Moss PR 272 files](https://github.com/sudoprivacy/moss/pull/272/files) |
| E-10 | Neither main nor current F1 head contains executable Cloud/Private/Edge/Local profile manifests. The older unmerged deploy branch contains only three scaffold files and leaves deploy, real session-pod health, fresh-host e2e, and rollback automation absent/TODO. | Legacy-Declared | [`feat/deploy-automation@662ecd49`](https://github.com/sudoprivacy/sudostack/tree/662ecd49de552e245a9efaccc73904c067d01d01/deploy); [TODO checks](https://github.com/sudoprivacy/sudostack/blob/662ecd49de552e245a9efaccc73904c067d01d01/deploy/README.md#L49-L61) |
| E-11 | The old deploy scaffold declares Node `22.23.2`, Moss short revision `cf3b7e8`, nexusd-cluster `0.1.1`, scode `0.1.28`, a mutable `node:22-bookworm-slim` image tag, and only a `saas-tencent` profile; it has no immutable product artifact digests or DB/config/rollback versions. | Legacy-Declared | [`components.toml`](https://github.com/sudoprivacy/sudostack/blob/662ecd49de552e245a9efaccc73904c067d01d01/deploy/components.toml#L9-L57); [`saas-tencent` profile](https://github.com/sudoprivacy/sudostack/blob/662ecd49de552e245a9efaccc73904c067d01d01/deploy/profiles/saas-tencent/profile.toml#L8-L58) |
| E-12 | Current F1 head includes temporary-directory package pack/install/import/typecheck smoke, and Moss includes packaged-server and runtime-image smoke implementations. These are executable code-level checks, not evidence that the selected customer environment passed. | Confirmed-Code | [F1 package smoke](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/tools/contracts/package-smoke.mjs#L13-L151); [Moss release smoke wiring](https://github.com/sudoprivacy/moss/blob/be38bec235c4dea202e32791f4efd20529e18d20/.github/workflows/build-release.yml#L141-L226) |
| E-13 | F1 revision `b966826…` is a docs-only child of `aec52e9…`; candidate/runtime/source-availability artifacts are byte-identical. SHA-256 prefixes remain: package metadata `8e719f71…`, npm lock `d4ea67ef…`, source lock `454a36c2…`, compatibility `ca9dd590…`, candidate manifest `2a13fdaf…`, source closure `10613674…`, source availability `9f5d028f…`, activation `272d25c8…`. | Confirmed-Code | [docs-only comparison](https://github.com/sudoprivacy/sudostack/compare/aec52e9dc5438946dd83d5c56c07149a4800120a...b966826edada1c2c1086ab6ee46cec9f85a398b5) |
| C-03 | The candidate manifest declares `draft-frozen` while its actual producer/consumer arrays are empty; ADR005-FREEZE-01 says absence of a real consumer is a fail-closed `unfrozen` condition. | Conflicting | [freeze clause](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/docs/adr/ADR-005-product-contract-versioning.md#L162-L178); [candidate package/support state](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/manifests/releases/0.2.0-candidate.gen.json#L275-L287) |

### Resolved conflict history

| ID | Prior issue | Resolution | Evidence |
|---|---|---|---|
| C-01 | ADR-005's implementation snapshot said release/source-closure evidence was absent although generated manifests existed. | Resolved by docs-only F1 revision `b966826…`; §10.1 now enumerates exact closure, candidate, activation, availability, package and gate evidence while preserving `Proposed` / `candidate_unpublished` / `not_deployed` / empty actual support. | [corrected ADR status](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/docs/adr/ADR-005-product-contract-versioning.md#L223-L227) |
| C-02 | The ResourceRef README said remote owner-source verification was blocked after the source-availability operation recorded `available`. | Resolved by docs-only F1 revision `b966826…`; the README now says exact owner bytes are remotely available and explicitly separates availability from registry release, adoption and deployment. | [corrected ResourceRef status](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/contracts/common/v1/resource-ref/README.md#L34-L42); [availability record](https://github.com/sudoprivacy/sudostack/blob/b966826edada1c2c1086ab6ee46cec9f85a398b5/manifests/operations/source-availability.json#L6-L35) |

C-03 and C-04 remain assembly-blocking. They cannot be waived locally because they concern the ADR freeze rule and an absent production call. Their resolution must preserve the candidate's unpublished/not-deployed state unless separately authorized release or deployment evidence exists.

### Component and persistence hints

These hints identify what the live collector must inspect. They must not be copied into B0 as deployed values.

| Component | Repository evidence at the read-only inspection anchor | How B0 treats it |
|---|---|---|
| SudoStack/F1 | Main `44b4e9de…` declares `@sudo/contracts@0.1.0`; current F1 head `b966826…` declares private `@sudo/contracts@0.2.0`, Node `>=22.21.0`, generated source/release manifests, and package-level smoke, but no executable selected-profile deployment or live artifact digest. | Candidate source identity is Confirmed-Code; package/image/binary digest and deployment are Unknown. |
| Moss | Base inspection anchor `be38bec235c4dea202e32791f4efd20529e18d20` declares package `2.1.88`, independent server/runtime release identities, PostgreSQL migrations `1`–`4`, and installer rollback of config/current symlink—not a database rollback. PR 272 is the only included consumer and changes the candidate/runtime boundary. | Record the running Moss revision, installed Contract integrity/digest, server and separate session runtimes, image digest, applied migration state, config reference, actual boundary smoke, and DB restore evidence. [Package](https://github.com/sudoprivacy/moss/blob/be38bec235c4dea202e32791f4efd20529e18d20/package.json#L2-L14), [PostgreSQL registry](https://github.com/sudoprivacy/moss/blob/be38bec235c4dea202e32791f4efd20529e18d20/src/server/db/pg_schema.ts#L1234-L1287), [installer rollback](https://github.com/sudoprivacy/moss/blob/be38bec235c4dea202e32791f4efd20529e18d20/deploy/install.sh#L1275-L1300) |
| SudoWork | Inspection anchor `fed1d9ca6b9b5138a31a90230dd201b120ec1d27` declares product `0.2.18`, desktop SQLite schema `32`, and WebUI checksum-ledger migrations `001`–`004`; its scode/vault pins differ from Moss's declarations. It is not an included Contract consumer. | If the selected demo uses it, record the exact desktop/WebUI artifact, runtime, actual `PRAGMA user_version`, applied WebUI filename/checksums, and compatibility result; otherwise prove not applicable. [Package](https://github.com/sudoprivacy/sudowork/blob/fed1d9ca6b9b5138a31a90230dd201b120ec1d27/package.json#L2-L22), [desktop schema](https://github.com/sudoprivacy/sudowork/blob/fed1d9ca6b9b5138a31a90230dd201b120ec1d27/apps/desktop/src/process/database/schema.ts#L184-L208), [WebUI migration runner](https://github.com/sudoprivacy/sudowork/blob/fed1d9ca6b9b5138a31a90230dd201b120ec1d27/apps/webui/src/server/migrate.ts#L24-L106) |
| sudocode | Inspection anchor `cb28736ce6bd07b0b539d7367608f15938890611` declares Rust workspace/CLI `0.2.14` and multiple config discovery paths, but no installed artifact identity or numeric config-schema version. It is not an included Contract consumer. | Record the actual embedded/sidecar binary version, source/build provenance, digest, runtime, and selected sanitized config only if used by the selected profile. [Workspace manifest](https://github.com/sudoprivacy/sudocode/blob/cb28736ce6bd07b0b539d7367608f15938890611/rust/Cargo.toml#L1-L14), [config discovery](https://github.com/sudoprivacy/sudocode/blob/cb28736ce6bd07b0b539d7367608f15938890611/rust/crates/runtime/src/config.rs#L816-L865) |
| Nexus | Base inspection anchor `23d3717a052ccd4b28ab399de27a50f4879d38c0` declares Python package `0.10.1`, separate Rust assembly versioning, deployment profiles, and a multi-merge Alembic graph. Startup can `stamp("heads")` for a pre-existing schema without replaying history. | Record the running binary/image and exact assembly namespace, Schema digests, database engine, all live Alembic heads, applied schema invariants, and migration-set digest. A stamped revision alone is insufficient. [Package](https://github.com/nexi-lab/nexus/blob/23d3717a052ccd4b28ab399de27a50f4879d38c0/pyproject.toml#L3-L7), [database initializer](https://github.com/nexi-lab/nexus/blob/23d3717a052ccd4b28ab399de27a50f4879d38c0/scripts/init_database.py#L49-L94) |
| nexus-vfs | Base inspection anchor `557f0b9ba7c1847ae0eaadb1535ac6ea6d9099e1` has separate cluster/full/kernel package versions and durable `identity.json` schema version `2`; the `nexusd-cluster` filename overlaps a different Nexus assembly/release namespace. | Record source repository, artifact namespace, build stamp, digest, and durable identity schema separately; filename or crate version alone is ambiguous. [Cluster manifest](https://github.com/nexi-lab/nexus-vfs/blob/557f0b9ba7c1847ae0eaadb1535ac6ea6d9099e1/rust/profiles/cluster/Cargo.toml#L2-L15), [identity schema](https://github.com/nexi-lab/nexus-vfs/blob/557f0b9ba7c1847ae0eaadb1535ac6ea6d9099e1/rust/raft/src/identity.rs#L33-L80) |
| SudoRouter (`new-api`) | Inspection anchor `0455c26d3a0925bcaf1e4e9cbb7a4c4a5c354622` has an empty `VERSION`, build/release workflows that synthesize identity, mutable image defaults, and GORM `AutoMigrate` plus historical SQL rather than one proven schema head. | Read version, source revision, registry namespace, immutable image/binary digest, and actual DB state from the running release artifact; never use the empty source `VERSION` or a `latest` tag as B0. [Version initialization](https://github.com/sudoprivacy/new-api/blob/0455c26d3a0925bcaf1e4e9cbb7a4c4a5c354622/common/init.go#L34-L36), [migration path](https://github.com/sudoprivacy/new-api/blob/0455c26d3a0925bcaf1e4e9cbb7a4c4a5c354622/model/main.go#L181-L271) |
| `nova-gateway` | Inspection anchor `122354eef2491892134d3116cf3ecb94ee7188cf` is Legacy-Declared; it also has an empty source `VERSION`, different image namespace, GORM `AutoMigrate`, and no scalar migration head. | Prove whether the selected live route still uses it. If so, capture its exact artifact/DB/config evidence as B0 legacy; do not substitute it for `new-api`. [Version default](https://github.com/sudoprivacy/nova-gateway/blob/122354eef2491892134d3116cf3ecb94ee7188cf/common/constants.go#L1-L16), [migration path](https://github.com/sudoprivacy/nova-gateway/blob/122354eef2491892134d3116cf3ecb94ee7188cf/model/main.go#L176-L262) |
| `sudowork-server` | Inspection anchor `311636c7bbfa4fa1c655aa8bd5c7e898f565f263` is Legacy-Declared; the root package has no release version, core SQLite migrations are unnumbered add-if-missing operations, and QMS has a separate PostgreSQL/Timescale schema. | Inventory a remaining live dependency only. Record independent core/QMS DB state and exact artifact evidence; do not invent a scalar migration version or add new ownership/candidate adoption. [Package](https://github.com/sudoprivacy/sudowork-server/blob/311636c7bbfa4fa1c655aa8bd5c7e898f565f263/package.json#L2-L7), [core migrations](https://github.com/sudoprivacy/sudowork-server/blob/311636c7bbfa4fa1c655aa8bd5c7e898f565f263/src/db/migrations.ts#L10-L94) |

### Legacy Cloud plan evidence

The external ShareOne export `sudo-cloud-plan.html - ShareOne Viewer.mhtml` (saved 2026-09-12) is a planning/status narrative, not independent deployment evidence. Without copying its hostnames, addresses, or embedded credentials, it records the following discovery hints:

- a claimed Cloud demo baseline using SudoWork WebUI, sudocode, Nexus, Moss, Kubernetes/gVisor, `scode 0.1.28`, `server-v0.1.20`, `moss-runtime:latest`, and a Moss SQLite database;
- a claimed browser/WebSocket → Moss → session runner → sudocode ACP → SudoRouter → model path, but no repeatable command, assertion log, immutable image digest, or durable smoke artifact;
- conflicting credential-location descriptions, an ambiguous active Web entrypoint, unfinished one-command deployment orchestration, and no exact previous-release/database-restore/rollback smoke record;
- rollback hazards: a hand-built predecessor may not be present in `releases/`; server-only upgrade can break sessions when compute retains the old runtime image; a version-string-only nexusd check can accept same-version/different-digest bytes.

Treat every value from that plan as `Legacy-Declared` until the selected environment confirms it. The credential values printed in the source must never be copied into an inventory; they require separate security-owner assessment and rotation authorization.

## Profile applicability matrix

This table records **architectural applicability**, not deployment. All four live rows remain Unknown until a profile is selected and inspected.

| Profile | Atlas expected | Assembly applicability | Documented distinction | Current deployment evidence |
|---|---:|---|---|---|
| Cloud | yes | Applicable if selected | Shared spine plus cloud/multitenant additions | Unknown |
| Private | yes | Applicable if selected | Shared spine plus private ShareOne and internal identity integration | Unknown |
| Edge | yes | Applicable if selected | Shared spine plus local GPU/trust/packaging; excludes Hydra and multitenancy | Unknown |
| Local | no | Not applicable to Atlas mixed-version assembly | SudoWork plus embedded sudocode; it is not a local Atlas deployment | Unknown |

Passing one selected profile does not establish another profile. An Edge offline mode is an Edge configuration, not a fifth profile.

## Required B0 matrix

Create one row per running component in the selected environment, plus one environment-level row. Every cell needs its own status and evidence reference in the machine-readable record.

| Environment/profile | Repository SHA | Package/image/binary digest | Runtime version | Config / Schema / DB migration versions | Zone identifiers | Smoke evidence | Rollback refs | Overall status |
|---|---|---|---|---|---|---|---|---|
| Selected live environment | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |
| SudoStack assembly/deploy source | Unknown | Unknown | Unknown | Unknown | Unknown or not applicable with evidence | Unknown | Unknown | Unknown |
| Moss | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |
| SudoWork | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |
| `sudowork-server` legacy dependency | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |
| Nexus | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |
| sudocode | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |
| nexus-vfs | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |

The seven named repository rows are the proposed ADR's minimum B0 set, even when a repository is a retirement target. Add every other running dependency on the selected customer path—such as the active SudoRouter carrier, databases, ingress, orchestrator, and bundled runtime image—as a component row rather than hiding it behind one of the seven.

A complete row records at least:

1. non-sensitive environment label and exactly one profile;
2. repository and exact deployed revision obtained from artifact/build metadata;
3. every deployed package, OCI image, and binary version plus immutable digest;
4. runtime versions observed inside the running unit, not merely a Dockerfile or toolchain declaration;
5. sanitized config profile/version/reference, Schema/API versions or digests, database engine/version, all migration heads or a deterministic migration-set digest;
6. Zone identifiers and their non-sensitive purpose in the isolated test scope;
7. timestamped smoke result and access-controlled evidence reference;
8. exact known-good rollback revisions, artifact digests, config reference, database restore reference when needed, and dependency-aware order.

## Unknown live inputs

All 13 inputs below are `Unknown` in the source-only seed and block the relevant assembly or G3 claim until collected or explicitly marked not applicable with evidence. The JSON template carries only their stable IDs, field references, statuses, and evidence references; this table owns the human-readable requirement and safe-collection wording.

| ID | Required input | Safe collection rule |
|---|---|---|
| U-01 | Selected profile and non-sensitive environment label | Use an internal inventory ID, not a hostname, credential, customer name, or network address. |
| U-02 | Deployed repository revisions | Prefer immutable build labels/SBOM/provenance from the running artifact; do not use a developer checkout HEAD. |
| U-03 | Package, OCI image, and binary digests | Capture package integrity, OCI `RepoDigest`/runtime image ID, or cryptographic binary digest. Tags and filenames are insufficient. |
| U-04 | Runtime versions | Query at least one running unit per distinct immutable artifact/runtime configuration using a read-only command; inspect every mutable, overridden, or divergent unit separately. Include Node/Bun/Python/Rust-linked binary and database versions where applicable. |
| U-05 | Sanitized configuration identity | Record immutable config object/version and a digest of a redacted manifest. Never record secret values or hash low-entropy secret values. Secret references may record a non-sensitive version/resource version only. |
| U-06 | API and Schema identities | Record negotiated API versions and immutable Schema/Contract digests from the running artifact. Link owner sources rather than copying definitions. |
| U-07 | Database state | Use read-only engine and migration-status queries. Record every head or a deterministic migration-set digest and the approved backup/restore reference; do not run a migration to discover state. |
| U-08 | Zone identifiers and role mapping | Read only the minimum non-secret identifiers needed for the isolated smoke scope. Do not export memberships, grants, customer records, or credentials. |
| U-09 | Existing customer-demo path | Name the route/operation and sanitized request/result contract without recording hostnames, tokens, customer payloads, or raw traces. |
| U-10 | B0 smoke observations | Store timestamps, exit/status codes, bounded sanitized excerpts, and evidence URIs. Keep full logs in approved access-controlled storage. |
| U-11 | Rollback assets and order | Prove exact B0 artifacts/config are resolvable and document dependency order and time budget without activating them during inventory. |
| U-12 | Retirement-target dependency | Prove whether the selected path still calls `sudowork-server`; if not, record not-applicable evidence. Do not extend or modernize it in this initiative. |
| U-13 | Change control | Record change-window, approver-role, operator-role, stop conditions, and evidence-bundle location. Do not put personal credentials or access tokens in the record. |

After redaction, hash the evidence bundle itself so later review can detect changes. Do not hash secret values as a substitute for removing them: hashes of low-entropy secrets can leak information.

## B0 smoke procedure

No repository currently supplies a single cross-profile smoke command. The completed inventory must replace each abstract operation below with the selected profile's exact command or request and evidence location.

| Step | Action | Required observable result | Required negative-side-effect evidence |
|---|---|---|---|
| B0-SMOKE-01 | Compare the running revisions, immutable artifacts, runtimes, sanitized config, Schema/database state, and Zone identifiers with the completed B0 record. | Every value matches before traffic is exercised. | Any mismatch stops the run before a state-changing request. |
| B0-SMOKE-02 | Start or inspect the selected B0 profile and execute its documented readiness probes. | All required units reach their named readiness conditions within the recorded limit. | Readiness alone creates no migration, Zone, grant, task, or customer-data write. |
| B0-SMOKE-03 | Exercise the existing customer-demo path using a read-only probe or an approved disposable fixture. | The exact B0 request shape returns the sanitized expected result. | No duplicate task, orphan process, grant change, secret disclosure, or unrelated write; approved fixture changes are enumerated and cleaned up. |
| B0-SMOKE-04 | Re-read health, audit, task/process counts, migration heads, and fixture state. | Post-smoke state equals the recorded expectation and approved cleanup is complete. | No unexpected persistent delta remains. |

Code-level package/conformance tests may accompany this evidence, but they cannot replace these environment observations.

## Candidate and mixed-version smoke

Before changing a live environment, `B1-SMOKE-01` runs the exact candidate package smoke in isolation and records its package digest and runtime. For the target Moss boundary:

1. `B1-SMOKE-02`: a valid synthetic ZoneId reaches the production argument-construction boundary unchanged and produces the expected isolated downstream arguments;
2. `B1-SMOKE-03`: an invalid synthetic ZoneId is rejected before downstream process creation with the expected safe error, and creates no downstream process, task, success audit event, persistent write, or secret-bearing log;
3. `B1-SMOKE-04`: the candidate assembly restarts against an approved copy or isolated fixture representing existing B0 data, preserves the recorded migration level unless a separately authorized migration is under test, and reproduces the expected existing path;
4. `B1-SMOKE-05`: the active legacy/candidate selector is explicit in evidence, and a forced new-path failure surfaces as that failure rather than silently falling back to the legacy path.

`ResourceRef` must not be exercised or reported as adopted.

The mixed-version matrix must name exact B0 and B1 revisions/digests for each row. At minimum it contains an all-B0 control, one row for each approved single-component transition against the remaining B0 components, the all-candidate included set, and the exact rollback-to-B0 row. Each machine row records `component_assignments`, support disposition, procedure reference, timestamps, result, observed result, negative-side-effect observation, evidence status, and evidence references. Unsupported combinations are explicit failures or exclusions, not omitted cells.

## Rollback rehearsal

A rollback rehearsal is successful only when the system returns to the exact B0 record and B0 smoke passes again.

| Step | Action | Required observable result | Required negative-side-effect evidence |
|---|---|---|---|
| R-01 | Resolve every B0 revision, artifact digest, sanitized config reference, and required database restore asset before candidate activation. | Every rollback asset is readable and integrity-checked within the recorded recovery budget. | Read-only preflight; no component activation or database restore. |
| R-02 | Execute the approved all-B0 control, mixed-version rows, and all-candidate row in an isolated/approved scope. | Each row produces its declared observable result, including explicit rejection for unsupported combinations. | No `ResourceRef` claim and no unlisted stateful operation. |
| R-03 | Restore components and sanitized config to exact B0 references in the recorded dependency-aware order. | Running identities and digests match B0 again. | Never run a database down-migration unless that exact reversal has independent evidence; use the approved snapshot/restore path when required. |
| R-04 | Repeat B0-SMOKE-01 through B0-SMOKE-04 and compare pre/post state. | All B0 observations pass and recovery time is within the recorded objective. | No customer-data loss, duplicate task, orphan process, Zone/grant mutation, schema drift, secret disclosure, or unrelated persistent write. |

Failure to restore any exact artifact/config/database reference, failure of the existing customer path, or any unexplained side effect fails the rehearsal. A forward fix is not a successful rollback.

## Entry criteria

### `SUDOSTACK-ASSEMBLY`

All of the following must be true for one named profile/environment:

1. every applicable live B0 field is `Confirmed-Deployment` with a timestamp and evidence reference; an inapplicable component or field has an explicit `not_applicable` value backed by `Confirmed-Deployment` evidence. `Expected`, `Confirmed-Code`, `Inferred`, `Conflicting`, `Unknown`, and `Legacy-Declared` cannot satisfy a live B0 field;
2. B0-SMOKE-01 through B0-SMOKE-04 pass before candidate assembly;
3. the exact owner, distribution, and Moss revisions above are immutable and reachable; their dependency-ordered pull requests are approved and merged to their declared bases, or an explicit exception names the exact unmerged revisions and risk owner;
4. the built candidate package/image/binary digests are recorded and independently integrity-checked; source SHAs alone are insufficient;
5. the actual Moss server runtime satisfies the candidate package engine requirement and all other running runtime versions are recorded from execution units;
6. configuration and database compatibility for every mixed-version row is reviewed; no unproved down-migration is part of rollback;
7. the target consumer set remains exactly Moss/`ZoneId`, and the production startup path passes the selected ZoneId through validation at the real argument-construction boundary with default-CI proof; until then the confirmed production-consumer set is empty. SudoWork, sudocode, and Nexus runtime `ResourceRef` adoption require separate accepted work items;
8. `ResourceRef` and its runtime `ZonePath` use remain deferred and excluded from the demo claim;
9. active conflicts C-03 and C-04 are closed with authoritative code/manifest evidence; an inventory-local waiver cannot override the ADR freeze rule or substitute tests for a production call;
10. rollback assets, order, stop conditions, evidence storage, and change authorization are ready.

### G3 demo/release evidence

G3 may be reported only for the selected profile/environment after:

1. the exact assembly matrix is recorded with every component revision and artifact digest;
2. the existing customer legacy path passes on all-B0, approved mixed-version, all-candidate, and restored-B0 rows where it is declared supported;
3. the target Moss `ZoneId` positive and negative production boundaries pass with the required no-side-effect evidence, the selected candidate path is observable, and a forced candidate-path failure does not silently fall back;
4. the candidate restarts against the approved existing-B0-data copy/fixture and preserves the expected path and recorded migration state;
5. every mixed-version row has an observed result and unsupported rows fail closed;
6. the exact B0 rollback rehearsal completes within the recorded recovery objective and B0 smoke passes again;
7. live evidence references support any `Confirmed-Deployment` field;
8. the result names its single tested profile and does not generalize to Cloud, Private, Edge, or Local profiles that were not run;
9. `ResourceRef` remains explicitly deferred, with no production provider/consumer or deployment claim;
10. release, deployment, migration, and destructive actions have their own authorization. This inventory grants none of them.

## Record handling

- Keep Contract definitions with their semantic owners and reference exact commits/paths/digests; never copy their definitions into a completed B0 record.
- Store only sanitized evidence references and non-sensitive identifiers here. Keep raw logs, SBOMs, database reports, and customer-environment outputs in approved access-controlled storage.
- Change `record_state` from `template` to `complete` only after every applicable live field and gate result satisfies the status rules; a copied record that still says `template` is never gate evidence.
- Make the completed record immutable or content-addressed before assembly, record its `baseline_revision` and redacted evidence-bundle digest, and create a new revision rather than editing history.
- Recompute evidence counts from the completed record's atomic statuses before each gate; do not preserve a hand-maintained roll-up. This source-only seed deliberately contains no `Confirmed-Deployment` values.
