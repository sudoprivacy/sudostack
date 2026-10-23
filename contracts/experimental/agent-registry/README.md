# Experimental product Agent Registry

These artifacts are byte-for-byte projections of the pinned Nexus product-service owner.
They do not activate stable `agent.sudo.dev/v1` or modify the existing ResourceRef definition.
The signature fixture uses a public, deterministic test key and is never a deployment trust key.

Regenerate with `node contracts/experimental/agent-registry/generate.mjs --owner <Nexus checkout>`;
use `--check` to compare committed source bytes. The source lock includes the full owner commit
and every file digest. Consumers must also pin the Stack artifact commit and validate both hops.

Runtime ResourceRef validation reuses the existing owner adapter. Generated TypeScript uses
`Record<string, unknown>` for that external reference; this is not a replacement runtime schema.
Registration signatures attest metadata only. Deployment, authority migration, actual artifact
verification and provider execution evidence require independent validation.
