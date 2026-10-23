# Experimental Catalog governance contract

Moss owns the Source, Candidate, validation, synchronization, run metadata and audit semantics. This directory distributes exactly pinned types and schema; it does not activate Registry authority or alter the stable contract package.

Generate with `node contracts/experimental/agent-catalog/generate.mjs --owner <Moss checkout>` and verify with `--check`. Both operations read committed blobs and check origin, full revision and per-file digest. Run `node --test contracts/experimental/agent-catalog/generate.test.mjs` for identity, drift and schema fixture checks.

The external-provider evidence extension is opt-in with `profile=catalog-v1`. Existing clients receive the original strict evidence shape. Historical provenance is optional and must never be inferred from current source configuration. Publication, channel promotion and invocation are separate; remote metadata snapshots never assert immutable execution.
