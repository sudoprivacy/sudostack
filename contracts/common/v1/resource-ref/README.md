# ResourceRef v1 distribution candidate

This directory is a derived distribution of the Nexus-owned Product `ResourceRef` definition. It is not an editable contract source.

Source closure:

- Nexus provenance revision: `759842551697efa2579a92f24b16f8ae43829e7b`
- Nexus definition revision: `5139e2019d7f46d4dde3f73ee6cd21bb094a7dc1`
- nexus-vfs primitive revision: `24f6730ec90fab8a035b2f5400ed313bda343fbe`
- assembly lock: [`../../../sources.lock.json`](../../../sources.lock.json)

Generated files carry `.gen.` or `.source.gen.` names. `schema.gen.json`, the owner manifest, and fixture files are byte-exact owner artifacts. `resource-ref.gen.js` and its declarations are derived runtime artifacts. The runtime uses Ajv Draft 2020-12 with the required nexus-vfs `sudoZonePath` vocabulary and `jsonc-parser` for duplicate-key and numeric-token checks.

The package subpath is:

```text
@sudo/contracts/common/v1/resource-ref
```

The package requires Node `>=22.21.0`; this is the first Node 22 release that supports the remote verifier's environment-proxy flag, and it also provides the synchronous ESM bridge used by the `require` export.

Local exact-source verification requires the immutable owner commits:

```bash
SUDOSTACK_REPOS_ROOT=/path/to/repos npm run source:verify
```

Offline generation, conformance, compatibility, manifest, and package gates operate on the byte-verified materialized bundle:

```bash
npm run generate:check-offline
```

Remote owner-source availability is `available`: the exact owner commits are published and byte-verified by:

```bash
npm run source:verify-remote
```

Remote source availability records access to the immutable owner bytes and their verified digests; it is not a registry release, production adoption, or deployment claim.

Lifecycle state: draft-frozen contract baseline; candidate/unpublished artifact; not deployed; no actual producers or consumers recorded.
