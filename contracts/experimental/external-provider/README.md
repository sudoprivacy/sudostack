# External provider pilot contract

This is an experimental distribution of the Moss-owned external-provider.sudo.dev/v1alpha4 contract. It does not declare ADR-003/004/005 Accepted, change the stable @sudo/contracts exports, or claim production Task/Attempt compatibility.

The only editable semantic definition is the pinned Moss source in source.lock.json. Generate or verify using:

```sh
node contracts/experimental/external-provider/generate.mjs --owner /path/to/moss [--check]
```

SudoWork vendors contract.gen.ts with the same source lock and checks its digest; update through the generator when the semantic owner changes. This avoids independently editable task DTOs while the official task contract is still Proposed.

The first API profile covers reviewed synthetic Chatflow inputs, ordered cursor event reads, server-owned sessions, one durable attempt per task, and explicit unknown outcomes. Cancellation, provider version pinning and execution resume are unsupported. Provider source_digest is review evidence, not a remote immutable-version guarantee.

The same profile includes administration wire types for organization pilot policy, role capabilities, connection inspection, definition upload and onboarding, member grants, revision-aware review/update, credential replacement and archive. Plaintext keys are write-only admin inputs; agent inventory responses expose neither keys nor Secret references. The network allowlist is writable only by platform administrators.


## alpha3 compatibility

Task, Event and EventsPage carry the runtime API version; Event/Page also carry their own kind. Consumers must reject unknown/missing envelope versions before applying deltas. A new consumer rejects alpha2 wire pages. Upgrade Moss and SudoWork together; pre-alpha3 clients do not implement the new envelope gate and must be restarted/upgraded before resuming sessions.

`delta` patches display answer; `raw_delta` patches raw answer independently, or `{ from_answer: true }` copies the answer after applying its delta. All offsets count JavaScript UTF-16 code units. Both outputs are checkpointed, and raw-only changes count toward the checkpoint threshold. Version/kind mismatch in stored events forces a full snapshot. Historic alpha2 data whose original raw stream was not persisted is returned with `raw_answer_freshness: legacy_checkpoint`; it cannot be reconstructed retroactively. New tasks use `current`.

Keep exact source/artifact pins even when changing only additive fields. An incompatible event meaning requires a new API version. Unknown wire versions are rejected, never repaired by resubmitting task creation. Cursor gaps are recovered by an explicit snapshot request (cursor 0).


## alpha4 compatibility

Reference registration now requires a durable `request_id` and complete `source_definition` matching `source_digest`. Full query-only definition profile v1 rejects unknown execution fields, tools, knowledge sources, attachments and graph-only snapshots. Old bindings need definition re-upload and review; history and identity are retained.

Coordinate the Moss and SudoWork upgrade. Event delta semantics from alpha3 remain unchanged; old stored events resync via a snapshot. Alpha3 complete raw answers stay `current`, while alpha2 incomplete raw history remains `legacy_checkpoint`. The source digest attests only submitted review evidence, never a remotely pinned Dify execution revision.
