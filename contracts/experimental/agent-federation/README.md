# Experimental Agent federation adapter baseline

Moss owns the editable JSON Schema and TypeScript definitions. This directory only assembles their exact committed bytes, with file digests in `source.lock.json`. ADR-003/004 remain Proposed; this is not acceptance of the six stable product contracts or a change to existing package exports.

Moss now provides Dify/Custom HTTP onboarding, the common adapter/run-binding API and immutable experimental SubmitTask → TaskSpec/Resolution admission. This directory also pins task.contract.gen.ts and task.schema.gen.json. ResourceRef runtime conformance uses the separately pinned owner package; Task Schema resource slots alone are structural. Work consumes exact artifacts. This source revision adds a deployed independent HTTP Provider, catalog-local Principal, immutable release/channel controls and canonical Moss Task/Session ownership. Portable Nexus identity, complete upstream cancellation, DLP and production/deployment admission remain pending. Durable transport types and schema are also generated here from agent-http/v1alpha2.

Regenerate with:

```sh
node contracts/experimental/agent-federation/generate.mjs --owner /path/to/moss
node contracts/experimental/agent-federation/generate.mjs --owner /path/to/moss --check
node --test contracts/experimental/agent-federation/generate.test.mjs
```

The generator reads Git blobs at the full owner commit, never the working tree. Keep this family separate from `external-provider` alpha5, which remains the Pilot UI protocol. HTTP manifests cannot activate unsupported capabilities; run bindings keep source snapshot evidence distinct from immutable execution proof.

The current source also declares the opt-in `sudo-task-grant/v1` external execution context. It binds an HTTP/OpenAI/MCP/A2A invocation to a short-lived Nexus task grant for Moss model/tool gateways. The credential is ephemeral and is not a TaskSpec/Registry snapshot field. Durable HTTP v1alpha2 does not accept this profile. A platform must explicitly implement the receiver; using the protocol alone is not evidence of full platform governance.
