# Experimental Agent federation adapter baseline

Moss owns the editable JSON Schema and TypeScript definitions. This directory only assembles their exact committed bytes, with file digests in `source.lock.json`. ADR-003/004 remain Proposed; this is not acceptance of the six stable product contracts or a change to existing package exports.

The current producer is Moss's Dify gateway adapter and the task-owner run-binding API. The custom HTTP adapter has local protocol conformance only: a second real Agent platform, Custom Manifest product onboarding, formal TaskSpec/Resolution, Principal/Version/Channel, canonical Nexus persistence and production/deployment admission remain pending.

Regenerate with:

```sh
node contracts/experimental/agent-federation/generate.mjs --owner /path/to/moss
node contracts/experimental/agent-federation/generate.mjs --owner /path/to/moss --check
node --test contracts/experimental/agent-federation/generate.test.mjs
```

The generator reads Git blobs at the full owner commit, never the working tree. Keep this family separate from `external-provider` alpha4, which remains the Pilot UI protocol. HTTP manifests cannot activate unsupported capabilities; run bindings keep source snapshot evidence distinct from immutable execution proof.
