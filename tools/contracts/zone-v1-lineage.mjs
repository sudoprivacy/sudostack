// The zone-v1 family's npm-package lineage: the export subpaths and packed
// paths this repository ships alongside the candidate mainline. Single
// source of truth for the lineage increment shared by the candidate gates
// (content-candidate, package-smoke, activation-0.2.1) and mirrored by
// compatibility/baselines/0.2.0-package.json successor_policy.added_packed_paths.
// The zone-v1 bytes themselves are guarded by the zone-v1-family-gates job
// (regenerate-and-compare, shared-fixture conformance, release
// reproducibility) — this lineage only adds their presence to the package.
export const ZONE_V1_EXPORT_KEYS = ['./auth/v1', './common/v1', './runtime/v2']

export const ZONE_V1_PACKED_PATHS = [
  'contracts/zone-v1/auth/v1/index.gen.d.ts',
  'contracts/zone-v1/auth/v1/index.gen.js',
  'contracts/zone-v1/codes.gen.js',
  'contracts/zone-v1/common/v1/index.gen.d.ts',
  'contracts/zone-v1/common/v1/index.gen.js',
  'contracts/zone-v1/fixtures/compatibility.gen.json',
  'contracts/zone-v1/fixtures/invalid.gen.json',
  'contracts/zone-v1/fixtures/path-traversal.gen.json',
  'contracts/zone-v1/fixtures/roundtrip.gen.json',
  'contracts/zone-v1/fixtures/secret-negative.gen.json',
  'contracts/zone-v1/fixtures/valid.gen.json',
  'contracts/zone-v1/projections.gen/existing-zone-id-ref.schema.gen.json',
  'contracts/zone-v1/projections.gen/remote-learned-zone-id.schema.gen.json',
  'contracts/zone-v1/projections.gen/system-zone-id.schema.gen.json',
  'contracts/zone-v1/projections.gen/tenant-zone-id-create.schema.gen.json',
  'contracts/zone-v1/projections.gen/zone-path.schema.gen.json',
  'contracts/zone-v1/provenance.gen.json',
  'contracts/zone-v1/runtime/v2/index.gen.d.ts',
  'contracts/zone-v1/runtime/v2/index.gen.js',
  'contracts/zone-v1/schema-bundle.gen.json',
  'contracts/zone-v1/validators.gen.js',
]
