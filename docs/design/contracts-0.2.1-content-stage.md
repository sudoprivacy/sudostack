# `@sudo/contracts@0.2.1` content-stage candidate

Date: 2026-09-20
Scope: `SW-20260917-001-SUDOSTACK-CANDIDATE2` content stage only

This document is a staging record, not a second Contract source of truth. Canonical definitions remain with their semantic owners, and the generated SudoStack artifacts remain the distribution source of record.

## Current facts

| Fact | State | Evidence classification |
|---|---|---|
| Historical package | `@sudo/contracts@0.2.0`, 42 files, 37,901 bytes, SHA-1 `2aa7a118da0adf6b7b486f9538fe20204001dcae`, SHA-256 `6f3b1bbbcc669b0b9dadd2dbdbc2c01fc5eb473a4839ddad45e0d172343073f8` | Confirmed-Code |
| Candidate package version | `0.2.1` | Confirmed-Code |
| Runtime Contract, Schema, fixture, validator and owner-source bytes | Byte-identical to the immutable `0.2.0` baseline | Confirmed-Code |
| Candidate content revision | `null`; resolved only after content commit C exists | Unknown |
| Candidate lifecycle | `staged`, `unfrozen`, `candidate_unpublished`, `not_deployed` | Confirmed-Code |
| Candidate producer/consumer support | Empty; `pending_moss_repin` | Confirmed-Code |
| Moss support evidence already present | Applies only to the historical `0.2.0` pin and is not `0.2.1` adoption evidence | Confirmed-Code |
| C-03 | Active and assembly-blocking | Conflicting |
| Release or deployment | None | Confirmed-Code for manifest declarations; live deployment remains Unknown |

A patch version is appropriate because the candidate changes package/version metadata, compatibility and provenance metadata, and staging verification only. It makes no wire, runtime, Schema, fixture, validator, owner-source, dependency, export, or package-script change.

## Immutable `0.2.0` baseline

[`compatibility/baselines/0.2.0-package.json`](../../compatibility/baselines/0.2.0-package.json) is derived from SudoStack revision `5a2a53130e37d1c63993ebf8ba1253b15eb9eebf`. It records the complete historical tarball identity, all 42 packed paths and per-file SHA-256 values, internal generated/source files, and the historical candidate, activation, availability, support, and verifier bytes.

Current tooling verifies that baseline against Git objects at the exact revision and runs the original `0.2.0` verification logic from an isolated detached checkout. The historical records are not interpreted under `0.2.1` rules. The package-included README and source-closure manifest also remain byte-identical historical/source-closure context; their `draft-frozen` wording does not override the staged candidate manifest's explicit `unfrozen` lifecycle.

The only permitted packed-content delta from `0.2.0` is:

1. `package.json`: the package version changes from `0.2.0` to `0.2.1` and no other byte changes;
2. `compatibility/current.gen.json`: records the `0.2.0` to `0.2.1` byte-identical compatibility result and pending support state;
3. `manifests/releases/0.2.1-candidate.gen.json`: one new staged candidate manifest.

`package-lock.json` changes only its top-level and root-package version fields. The historical `0.2.0` candidate remains packed and byte-identical.

## Terminating C → M → A choreography

The dependency graph is acyclic because every stage refers only to an already-existing earlier stage:

1. **C — SudoStack content commit.** C contains the installable `0.2.1` package, immutable baseline, staged manifest, and verification tooling. Its manifest keeps `candidate_revision: null` and `activation_state: pending_future_commit`; C never records its own SHA.
2. **M — Moss evaluation/re-pin commit.** After C exists, Moss exact-pins `github:sudoprivacy/sudostack#<C full SHA>`. M must prove the installed `0.2.1` identity and unchanged embedded `NexusManager.start()` boundary in default CI. This is an unfrozen evaluation pin used to collect evidence, not support-matrix admission, release, or deployment.
3. **A — SudoStack package-external activation/support record.** After M exists, A records and verifies the already-known C and M SHAs, immutable package bytes, real caller, exact pin, rejection/no-side-effect behavior, and default CI. A does not modify the package bytes that Moss consumed at C, does not require Moss to repin A, and is the earliest stage at which C-03 may be decided.

No stage embeds a future revision. A must not record its own containing commit SHA. If A cannot verify both C and M without changing C's package bytes, it must fail closed rather than request another repin.

## Downstream Moss packet contract

`MOSS-REPIN2` receives these immutable inputs after C is committed:

- repository: `sudoprivacy/sudostack`;
- package: `@sudo/contracts@0.2.1`;
- exact dependency form: `github:sudoprivacy/sudostack#<C full SHA>`;
- candidate manifest: `manifests/releases/0.2.1-candidate.gen.json`;
- candidate manifest SHA-256: `956a19cbc6b42ebc3c4e1c9ebe93e0842e1c295d1f6465e0d42d532d45785a9b`;
- compatibility manifest SHA-256: `a27553991ab8bd57d66bc12aaca4b08f52cd8def13a1f971d698fa3f435b35ad`;
- immutable predecessor baseline SHA-256: `9ec2cffbcb19f3e728a6691176ed739bab6de52a56b60abe4217420d2ce0c17c`;
- expected package support state: empty producer/consumer arrays and `pending_moss_repin`;
- required boundary: installed ZoneId validator at the real embedded `NexusManager.start()` path, immutable binding, exactly one `--cluster-init` argument, invalid-value rejection before process creation, no side effects, and explicit external-mode exclusion;
- forbidden claims: `ResourceRef` adoption, runtime `ZonePath` adoption, release, deployment, or C-03 closure.

The content revision itself is intentionally absent here until C exists. The coordinator must substitute the full C SHA and independently verify the manifest/package digests from that commit before issuing the Moss work item.

## Later activation inputs

`SUDOSTACK-ACTIVATE2` must receive the full C and M SHAs and evidence for the exact Moss dependency/lock bytes and required CI. Its package-external record must bind those two prior revisions, preserve all C package bytes, keep release/deployment facts separate, and leave `ResourceRef`, runtime `ZonePath`, B0 live inputs, mixed-version smoke, and rollback gates unchanged. C-03 can close only if that verification passes.

## Reproducible checks

The content stage is checked by:

- local and offline regeneration;
- immutable historical activation, availability, support, tests, typecheck, and package smoke from the detached `0.2.0` checkout;
- staged candidate digest and lifecycle verification;
- runtime/schema/fixture/source/provenance and version-forgery mutation tests;
- deterministic pack, exact package delta, fresh install, TypeScript import, ESM import, and CommonJS import;
- strict ADR audit and B0 invariant tests.

These checks establish reproducible code and package evidence only. They do not publish, release, deploy, migrate, approve assembly, or prove a live environment.
