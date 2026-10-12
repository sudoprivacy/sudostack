# External provider pilot contract

This is an experimental distribution of the Moss-owned external-provider.sudo.dev/v1alpha1 contract. It does not declare ADR-003/004/005 Accepted, change the stable @sudo/contracts exports, or claim production Task/Attempt compatibility.

The only editable semantic definition is the pinned Moss source in source.lock.json. Generate or verify using:

```sh
node contracts/experimental/external-provider/generate.mjs --owner /path/to/moss [--check]
```

SudoWork vendors contract.gen.ts with the same source lock and checks its digest; update through the generator when the semantic owner changes. This avoids independently editable task DTOs while the official task contract is still Proposed.

The first API profile covers reviewed synthetic Chatflow inputs, ordered cursor event reads, server-owned sessions, one durable attempt per task, and explicit unknown outcomes. Cancellation, provider version pinning and execution resume are unsupported. Provider source_digest is review evidence, not a remote immutable-version guarantee.

The same profile includes administration wire types for organization pilot policy, role capabilities, connection inspection, definition upload and onboarding, member grants, revision-aware review/update, credential replacement and archive. Plaintext keys are write-only admin inputs; agent inventory responses expose neither keys nor Secret references. The network allowlist is writable only by platform administrators.
