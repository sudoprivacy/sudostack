#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { readCommitBlob, verifyActivationRecords } from '../tools/contracts/activation.mjs'
import { verifyAvailabilityRecords } from '../tools/contracts/availability.mjs'
import { verifyCompatibilityBaseline } from '../tools/contracts/baseline.mjs'
import { requireSupportedNode } from '../tools/contracts/node-version.mjs'
import { renderResourceRefTypeScript } from '../tools/contracts/runtime-template.mjs'
import {
  REPO,
  SourceUnavailableError,
  loadOwnerClosure,
  loadSourceLock,
  parseJson,
  requireFullCommitSha,
  sha256,
  stableJson,
  validateOwnerClosure,
  verifyDigest,
} from '../tools/contracts/source.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = new Set(process.argv.slice(2))
const CHECK = args.delete('--check')
const OFFLINE = args.delete('--offline')
const VERIFY_SOURCES = args.delete('--verify-sources')
const VERIFY_REMOTE = args.delete('--verify-remote')
if (args.size > 0 || (VERIFY_SOURCES && VERIFY_REMOTE) || (OFFLINE && (VERIFY_SOURCES || VERIFY_REMOTE))) {
  console.error(`unsupported arguments: ${[...args].join(' ')}`)
  process.exit(2)
}

const outputPath = (relativePath) => join(REPO, relativePath)
const PACKAGE_JSON = parseJson(readFileSync(join(REPO, 'package.json')), 'package.json')
requireSupportedNode(process.versions.node, PACKAGE_JSON.engines.node)
const CANDIDATE_MANIFEST_PATH = `manifests/releases/${PACKAGE_JSON.version}-candidate.gen.json`
const ACTIVATION_PATH = `manifests/activations/${PACKAGE_JSON.version}-candidate.json`
const ACTIVATION_BYTES = readFileSync(join(REPO, ACTIVATION_PATH))
const ACTIVATION = parseJson(ACTIVATION_BYTES, ACTIVATION_PATH)
const AVAILABILITY_OPERATION_PATH = 'manifests/operations/source-availability.json'
const AVAILABILITY_OPERATION_BYTES = readFileSync(join(REPO, AVAILABILITY_OPERATION_PATH))
const AVAILABILITY_OPERATION = parseJson(
  AVAILABILITY_OPERATION_BYTES,
  AVAILABILITY_OPERATION_PATH,
)
const CANDIDATE_CONTENT_REVISION = requireFullCommitSha(
  ACTIVATION.candidate_content_revision,
  'candidate content revision',
)
const ACTIVATION_REVISION = requireFullCommitSha(
  AVAILABILITY_OPERATION.activation_revision,
  'activation revision',
)
const HISTORY_REPO = process.env.SUDOSTACK_BASE_REPO ?? REPO
const PRECURSOR_MANIFEST_BYTES = readCommitBlob(
  HISTORY_REPO,
  CANDIDATE_CONTENT_REVISION,
  ACTIVATION.precursor_candidate_manifest.path,
)
if (sha256(PRECURSOR_MANIFEST_BYTES) !== ACTIVATION.precursor_candidate_manifest.sha256) {
  throw new Error('pre-activation candidate-manifest digest does not match candidate content revision')
}
const generatedFixturePath = (ownerRelativePath) => {
  if (!/^fixtures\/(?:valid|invalid)\/[a-z0-9][a-z0-9-]*\.json$/.test(ownerRelativePath)) {
    throw new Error(`unsafe or unsupported owner fixture path: ${ownerRelativePath}`)
  }
  const withoutPrefix = ownerRelativePath.replace(/^fixtures\//, '')
  return `contracts/common/v1/resource-ref/fixtures/${withoutPrefix.replace(/\.json$/, '.gen.json')}`
}
const SOURCE_OUTPUTS = {
  vfs: {
    zone_id_spec: 'contracts/zone-id/spec.source.gen.json',
    zone_id_schema: 'contracts/zone-id/schema.gen.json',
    zone_id_vectors: 'contracts/zone-id/vectors.source.gen.json',
    zone_path_spec: 'contracts/zone-path/spec.source.gen.json',
    zone_path_schema: 'contracts/zone-path/schema.gen.json',
    zone_path_meta_schema: 'contracts/zone-path/meta-schema.gen.json',
    zone_path_cases: 'contracts/zone-path/cases.source.gen.json',
    zone_path_package_lock: 'contracts/zone-path/validator-lock.source.gen.json',
  },
  nexus: {
    schema: 'contracts/common/v1/resource-ref/schema.gen.json',
    manifest: 'contracts/common/v1/resource-ref/owner-manifest.source.gen.json',
    source_lock: 'contracts/common/v1/resource-ref/owner-source-lock.source.gen.json',
  },
}

function loadOfflineClosure() {
  const lock = loadSourceLock()
  const read = (path, expected, label) => {
    const data = readFileSync(outputPath(path))
    verifyDigest(data, expected, label)
    return data
  }
  const vfsFiles = lock.repositories['nexus-vfs'].files
  const vfs = Object.fromEntries(
    Object.entries(SOURCE_OUTPUTS.vfs).map(([name, path]) => [
      name,
      read(path, vfsFiles[name].sha256, `nexus-vfs ${name}`),
    ]),
  )
  const nexusFiles = lock.repositories.nexus.files
  const nexus = Object.fromEntries(
    Object.entries(SOURCE_OUTPUTS.nexus).map(([name, path]) => [
      name,
      read(path, nexusFiles[name].sha256, `nexus ${name}`),
    ]),
  )
  nexus.schemaJson = parseJson(nexus.schema, 'offline ResourceRef schema')
  nexus.manifestJson = parseJson(nexus.manifest, 'offline ResourceRef owner manifest')
  nexus.sourceLockJson = parseJson(nexus.source_lock, 'offline ResourceRef owner source lock')
  const fixtures = new Map()
  for (const metadata of nexus.manifestJson.fixtures.cases) {
    const path = generatedFixturePath(metadata.path)
    fixtures.set(metadata.case_id, {
      metadata,
      ownerPath: `${lock.repositories.nexus.root}/${metadata.path}`,
      data: read(path, metadata.sha256, `ResourceRef fixture ${metadata.case_id}`),
    })
  }
  return validateOwnerClosure({ lock, nexus, vfs, fixtures })
}

function renderZoneIdTypeScript(spec, revision, sourcePath) {
  const { min, max } = spec.length
  return `// @generated by contracts/generate.mjs from nexus-vfs ${revision}\n` +
`// ${sourcePath} — do not edit. Run \`node contracts/generate.mjs\` instead.\n\n` +
`export const ZONE_ID_MIN_LEN = ${min}\n` +
`export const ZONE_ID_MAX_LEN = ${max}\n` +
`export const ZONE_ID_CHARSET = ${JSON.stringify(spec.charset.allowed)}\n` +
`export const ZONE_ID_NO_LEADING = ${JSON.stringify(spec.edges.no_leading)}\n` +
`export const ZONE_ID_NO_TRAILING = ${JSON.stringify(spec.edges.no_trailing)}\n\n` +
`export type ZoneIdRefusal =\n` +
`  | { kind: 'length'; got: number }\n` +
`  | { kind: 'character'; got: string; at: number }\n` +
`  | { kind: 'leading' }\n` +
`  | { kind: 'trailing' }\n\n` +
`export function validateZoneId(id: string): ZoneIdRefusal | null {\n` +
`  const len = [...id].length\n` +
`  if (len < ZONE_ID_MIN_LEN || len > ZONE_ID_MAX_LEN) return { kind: 'length', got: len }\n` +
`  if (id.startsWith(ZONE_ID_NO_LEADING)) return { kind: 'leading' }\n` +
`  if (id.endsWith(ZONE_ID_NO_TRAILING)) return { kind: 'trailing' }\n` +
`  const chars = [...id]\n` +
`  for (let at = 0; at < chars.length; at++) {\n` +
`    if (!ZONE_ID_CHARSET.includes(chars[at])) return { kind: 'character', got: chars[at], at }\n` +
`  }\n` +
`  return null\n` +
`}\n\n` +
`export function describeRefusal(r: ZoneIdRefusal): string {\n` +
`  switch (r.kind) {\n` +
`    case 'length':\n` +
`      return \`zone id must be \${ZONE_ID_MIN_LEN}–\${ZONE_ID_MAX_LEN} characters, got \${r.got}\`\n` +
`    case 'character':\n` +
`      return \`zone id contains \${JSON.stringify(r.got)} at position \${r.at}; permitted characters are \${ZONE_ID_CHARSET}\`\n` +
`    case 'leading':\n` +
`      return \`zone id must not start with \${JSON.stringify(ZONE_ID_NO_LEADING)}\`\n` +
`    case 'trailing':\n` +
`      return \`zone id must not end with \${JSON.stringify(ZONE_ID_NO_TRAILING)}\`\n` +
`  }\n` +
`}\n`
}

function compileTypeScript(source, fileName) {
  const compilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
  }
  const declarations = ts.transpileDeclaration(source, {
    compilerOptions,
    fileName,
    reportDiagnostics: true,
  })
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
    reportDiagnostics: true,
  })
  const diagnostics = [...(declarations.diagnostics ?? []), ...(javascript.diagnostics ?? [])]
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (diagnostics.length > 0) {
    throw new Error(
      `TypeScript generation failed for ${fileName}: ` +
        diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('; '),
    )
  }
  return { declarations: declarations.outputText, javascript: javascript.outputText }
}

function legacyVectors(spec) {
  const { min, max } = spec.length
  const bad = spec.charset.allowed.includes('_') ? '!' : '_'
  return [
    { id: 'a'.repeat(min), valid: true, why: 'shortest permitted' },
    { id: 'a'.repeat(max), valid: true, why: 'longest permitted' },
    { id: 'cloud-user-1001', valid: true, why: 'canonical shape' },
    { id: '550e8400-e29b-41d4-a716-446655440000', valid: true, why: 'a bare UUID is usable as-is' },
    { id: 'a'.repeat(min - 1), valid: false, why: 'shorter than the minimum' },
    { id: 'a'.repeat(max + 1), valid: false, why: 'longer than the maximum' },
    { id: `${spec.edges.no_leading}leading`, valid: false, why: 'leading separator' },
    { id: `trailing${spec.edges.no_trailing}`, valid: false, why: 'trailing separator' },
    { id: 'Has-Upper', valid: false, why: 'uppercase is excluded, not folded' },
    { id: `has${bad}char`, valid: false, why: 'character outside the set' },
    { id: 'org:550e8400-e29b-41d4-a716-446655440000', valid: false, why: 'a colon is not in the set' },
  ]
}

function renderExamples(spec, vectors, revision) {
  const rows = vectors
    .map((item) => `| \`${item.id.length > 44 ? `${item.id.slice(0, 41)}…` : item.id}\` | ${item.valid ? '✅' : '❌'} | ${item.why} |`)
    .join('\n')
  return `<!-- @generated by contracts/generate.mjs from nexus-vfs ${revision} — do not edit. -->\n\n` +
    `# zone-id — what is and is not accepted\n\n` +
    `Derived from the owner spec at an exact revision.\n\n` +
    `**The rule**: ${spec.length.min}–${spec.length.max} characters, from \`${spec.charset.allowed}\`,\n` +
    `not starting with \`${spec.edges.no_leading}\` or ending with \`${spec.edges.no_trailing}\`.\n` +
    `Reserved ids are refused by the daemon.\n\n` +
    `| id | | why |\n|---|---|---|\n${rows}\n\n` +
    `**It cannot be changed after creation.** ${spec.mutability.why}\n`
}

function zoneIdPin(lock, previous) {
  const owner = lock.repositories['nexus-vfs']
  return {
    $comment: [
      'Generated compatibility pin; edit contracts/sources.lock.json instead.',
      'The editable ZoneId definition remains in nexus-vfs.',
      'Repository revision skew and lexical compatibility are recorded separately.',
    ],
    'nexus-vfs': {
      repository: owner.repository,
      rev: owner.revision,
      contract_id: 'urn:sudo:nexus-vfs:zone-id:v1',
      specs: {
        'zone-id': owner.files.zone_id_spec,
        schema: owner.files.zone_id_schema,
        vectors: owner.files.zone_id_vectors,
      },
      previous_package_baseline: {
        sudostack_revision: previous.package.sudostack_revision,
        owner_revision: previous.families.zone_id.owner_revision,
        owner_spec_sha256: previous.families.zone_id.owner_spec_sha256,
        generated_artifact_sha256:
          previous.artifacts['contracts/zone-id/zone-id.gen.ts'],
      },
    },
  }
}

function sourceClosureManifest(closure) {
  const { lock, nexus } = closure
  const sanitize = (entry) => ({
    repository: entry.repository,
    revision: entry.revision,
    ...(entry.definition_revision ? { definition_revision: entry.definition_revision } : {}),
    files: entry.files,
  })
  return {
    manifest_version: 1,
    lifecycle: {
      adr_maturity: 'proposed',
      contract_baseline: 'draft-frozen',
      artifact_publication: 'candidate_unpublished',
      deployment_evidence: 'not_deployed',
    },
    sudostack_g0_revision: lock.sudostack_g0_revision,
    source_availability: lock.source_availability,
    repositories: {
      nexus: sanitize(lock.repositories.nexus),
      'nexus-vfs': sanitize(lock.repositories['nexus-vfs']),
    },
    owner_manifest: {
      contract: nexus.manifestJson.contract,
      lifecycle: nexus.manifestJson.lifecycle,
      actual_producers: nexus.manifestJson.roles.actual_producers,
      actual_consumers: nexus.manifestJson.roles.actual_consumers,
      resolution_policy: nexus.manifestJson.resolution_policy,
    },
  }
}

function fixtureIndex(closure) {
  const { lock, nexus, vfs, fixtures } = closure
  const resourceCases = [...fixtures.values()].map(({ metadata, ownerPath }) => ({
    case_id: metadata.case_id,
    category: metadata.category,
    owner: 'nexus',
    owner_provenance_revision: lock.repositories.nexus.revision,
    owner_definition_revision: lock.repositories.nexus.definition_revision,
    owner_path: ownerPath,
    owner_sha256: metadata.sha256,
    distributed_path: generatedFixturePath(metadata.path),
    schema_expected: metadata.schema_expected,
    adapter_expected: metadata.adapter_expected,
    ...(metadata.expected_issue ? { expected_issue: metadata.expected_issue } : {}),
  }))
  return {
    index_version: 1,
    resource_ref: {
      count: resourceCases.length,
      owner_index_sha256: nexus.manifestJson.fixtures.index_sha256,
      cases: resourceCases,
    },
    zone_id: {
      count: nexus.manifestJson.fixtures.primitive_cases.zone_id_case_count,
      bundle_sha256: sha256(vfs.zone_id_vectors),
      cases: nexus.manifestJson.fixtures.primitive_cases.zone_id_cases,
    },
    zone_path: {
      count: nexus.manifestJson.fixtures.primitive_cases.zone_path_case_count,
      bundle_sha256: sha256(vfs.zone_path_cases),
      cases: nexus.manifestJson.fixtures.primitive_cases.zone_path_cases,
    },
  }
}

function compatibilityManifest(closure, prior) {
  const currentSpec = parseJson(closure.vfs.zone_id_spec, 'ZoneId owner spec')
  const oldCore = prior.families.zone_id.rule_data
  const currentCore = {
    length: { min: currentSpec.length.min, max: currentSpec.length.max },
    charset: { allowed: currentSpec.charset.allowed },
    edges: {
      no_leading: currentSpec.edges.no_leading,
      no_trailing: currentSpec.edges.no_trailing,
    },
  }
  const lexicalRuleDataEqual = stableJson(oldCore) === stableJson(currentCore)
  return {
    compatibility_version: 1,
    package: { previous: prior.package.version, candidate: PACKAGE_JSON.version },
    families: {
      zone_id: {
        state: lexicalRuleDataEqual ? 'compatible_behavior' : 'breaking_rule_change',
        previous_sudostack_revision: prior.package.sudostack_revision,
        previous_owner_revision: prior.families.zone_id.owner_revision,
        current_owner_revision: closure.lock.repositories['nexus-vfs'].revision,
        repository_revision_skew:
          prior.families.zone_id.owner_revision !== closure.lock.repositories['nexus-vfs'].revision,
        owner_spec_digest_changed: prior.families.zone_id.owner_spec_sha256 !== sha256(closure.vfs.zone_id_spec),
        lexical_rule_data_equal: lexicalRuleDataEqual,
        evidence: ['legacy generated vectors', '12 exact owner vectors'],
      },
      resource_ref: {
        state: 'initial_baseline',
        backward_compatibility_claim: false,
        owner_revision: closure.lock.repositories.nexus.definition_revision,
        provenance_revision: closure.lock.repositories.nexus.revision,
        semantic_uncertainty: 'manual_review',
      },
    },
    support_matrix: {
      actual_producers: [],
      actual_consumers: [],
      note: 'Consumer support remains empty until a production-boundary Work Item passes default CI.',
    },
  }
}

function packagedArtifactPaths(outputs) {
  const rules = PACKAGE_JSON.files
  return [...outputs.keys()].filter((path) =>
    rules.some((rule) => (rule.endsWith('/') ? path.startsWith(rule) : path === rule)),
  )
}

function candidateManifest(closure, outputs) {
  const packaged = new Set(packagedArtifactPaths(outputs))
  const artifacts = [...packaged]
    .sort()
    .map((path) => ({ path, sha256: sha256(outputs.get(path)) }))
  const internalArtifacts = [...outputs.keys()]
    .filter((path) => !packaged.has(path))
    .sort()
    .map((path) => ({ path, sha256: sha256(outputs.get(path)) }))
  const compatibility = parseJson(
    outputs.get('compatibility/current.gen.json'),
    'generated compatibility result',
  )
  const generatedFixtureIndex = parseJson(
    outputs.get('contracts/common/v1/resource-ref/fixture-index.gen.json'),
    'generated fixture index',
  )
  const manifest = {
    manifest_version: 1,
    lifecycle: {
      adr_maturity: 'proposed',
      contract_baseline: 'draft-frozen',
      artifact_publication: 'candidate_unpublished',
      deployment_evidence: 'not_deployed',
    },
    sudostack: {
      g0_revision: closure.lock.sudostack_g0_revision,
      candidate_revision: CANDIDATE_CONTENT_REVISION,
      activation_state: ACTIVATION.state,
      activation: {
        commit_binding: ACTIVATION.commit_binding,
        metadata_path: ACTIVATION_PATH,
        metadata_sha256: sha256(ACTIVATION_BYTES),
        precursor_candidate_manifest: ACTIVATION.precursor_candidate_manifest,
      },
      source_availability_override: {
        state: AVAILABILITY_OPERATION.state,
        metadata_path: AVAILABILITY_OPERATION_PATH,
        metadata_sha256: sha256(AVAILABILITY_OPERATION_BYTES),
        activation_revision: ACTIVATION_REVISION,
        previous_candidate_manifest_sha256:
          AVAILABILITY_OPERATION.previous.candidate_manifest_sha256,
        source_lock_sha256: sha256(
          readFileSync(join(REPO, 'contracts', 'sources.lock.json')),
        ),
        source_closure_sha256: sha256(outputs.get('manifests/source-closure.gen.json')),
      },
      assembly_source_lock: {
        path: 'contracts/sources.lock.json',
        sha256: sha256(readFileSync(join(REPO, 'contracts', 'sources.lock.json'))),
      },
    },
    owners: {
      nexus: {
        provenance_revision: closure.lock.repositories.nexus.revision,
        definition_revision: closure.lock.repositories.nexus.definition_revision,
        definition_revision_verification:
          'schema_source_lock_and_fixtures_byte_identical_to_provenance_revision',
        schema_path: closure.lock.repositories.nexus.files.schema.path,
        schema_sha256: closure.lock.repositories.nexus.files.schema.sha256,
        manifest_path: closure.lock.repositories.nexus.files.manifest.path,
        manifest_sha256: closure.lock.repositories.nexus.files.manifest.sha256,
        source_lock_path: closure.lock.repositories.nexus.files.source_lock.path,
        source_lock_sha256: closure.lock.repositories.nexus.files.source_lock.sha256,
      },
      'nexus-vfs': {
        revision: closure.lock.repositories['nexus-vfs'].revision,
        files: closure.lock.repositories['nexus-vfs'].files,
      },
    },
    package: {
      name: PACKAGE_JSON.name,
      version: PACKAGE_JSON.version,
      private: PACKAGE_JSON.private,
      package_json_sha256: sha256(readFileSync(join(REPO, 'package.json'))),
      package_lock_sha256: sha256(readFileSync(join(REPO, 'package-lock.json'))),
      actual_producers: [],
      actual_consumers: [],
    },
    toolchain: {
      generator: {
        id: 'contracts/generate.mjs@1',
        path: 'contracts/generate.mjs',
        sha256: sha256(readFileSync(join(REPO, 'contracts', 'generate.mjs'))),
      },
      source_loader: {
        path: 'tools/contracts/source.mjs',
        sha256: sha256(readFileSync(join(REPO, 'tools', 'contracts', 'source.mjs'))),
      },
      runtime_template: {
        path: 'tools/contracts/runtime-template.mjs',
        sha256: sha256(readFileSync(join(REPO, 'tools', 'contracts', 'runtime-template.mjs'))),
      },
      compatibility_checker: {
        path: 'tools/contracts/compatibility.mjs',
        sha256: sha256(readFileSync(join(REPO, 'tools', 'contracts', 'compatibility.mjs'))),
      },
      baseline_verifier: {
        path: 'tools/contracts/baseline.mjs',
        sha256: sha256(readFileSync(join(REPO, 'tools', 'contracts', 'baseline.mjs'))),
      },
      node_version_gate: {
        path: 'tools/contracts/node-version.mjs',
        sha256: sha256(readFileSync(join(REPO, 'tools', 'contracts', 'node-version.mjs'))),
      },
      activation_verifier: {
        path: 'tools/contracts/activation.mjs',
        sha256: sha256(readFileSync(join(REPO, 'tools', 'contracts', 'activation.mjs'))),
      },
      availability_verifier: {
        path: 'tools/contracts/availability.mjs',
        sha256: sha256(readFileSync(join(REPO, 'tools', 'contracts', 'availability.mjs'))),
      },
      node: PACKAGE_JSON.engines.node,
      runtime_validator: `ajv@${PACKAGE_JSON.dependencies.ajv}`,
      raw_json_parser: `jsonc-parser@${PACKAGE_JSON.dependencies['jsonc-parser']}`,
      typescript_checker: `typescript@${PACKAGE_JSON.devDependencies.typescript}`,
    },
    fixtures: {
      resource_ref: generatedFixtureIndex.resource_ref.count,
      zone_id: generatedFixtureIndex.zone_id.count,
      zone_path: generatedFixtureIndex.zone_path.count,
      aggregate_index_sha256: sha256(outputs.get('contracts/common/v1/resource-ref/fixture-index.gen.json')),
    },
    generated_artifacts: artifacts,
    internal_generation_artifacts: internalArtifacts,
    compatibility: {
      prior_baseline_path: 'compatibility/baselines/0.1.0.json',
      prior_baseline_sha256: sha256(
        readFileSync(join(REPO, 'compatibility', 'baselines', '0.1.0.json')),
      ),
      zone_id: compatibility.families.zone_id.state,
      resource_ref: 'initial_baseline_no_backward_compatibility_claim',
    },
    source_availability: closure.lock.source_availability,
    deferred: [
      'consumer production-boundary adoption',
      'runtime writer and canonical runtime store',
      'ResourceRef authorization and routing resolver',
      'artifact release and remote publication',
      'deployment and migration',
      'unrequested language packages',
    ],
  }
  const availability = verifyAvailabilityRecords({
    operation: AVAILABILITY_OPERATION,
    previousSourceLockBytes: readCommitBlob(
      HISTORY_REPO,
      ACTIVATION_REVISION,
      'contracts/sources.lock.json',
    ),
    previousSourceClosureBytes: readCommitBlob(
      HISTORY_REPO,
      ACTIVATION_REVISION,
      'manifests/source-closure.gen.json',
    ),
    previousCandidateManifestBytes: readCommitBlob(
      HISTORY_REPO,
      ACTIVATION_REVISION,
      CANDIDATE_MANIFEST_PATH,
    ),
    currentSourceLockBytes: readFileSync(join(REPO, 'contracts', 'sources.lock.json')),
    currentSourceClosureBytes: outputs.get('manifests/source-closure.gen.json'),
    currentCandidateManifest: manifest,
    operationBytes: AVAILABILITY_OPERATION_BYTES,
    currentToolBytes: readFileSync(join(REPO, 'tools', 'contracts', 'availability.mjs')),
  })
  verifyActivationRecords({
    activation: ACTIVATION,
    activationBytes: ACTIVATION_BYTES,
    activationPath: ACTIVATION_PATH,
    currentManifest: manifest,
    precursorManifestBytes: PRECURSOR_MANIFEST_BYTES,
    currentBytes: (path) => outputs.get(path) ?? readFileSync(join(REPO, path)),
    candidateBytes: (path) => readCommitBlob(HISTORY_REPO, CANDIDATE_CONTENT_REVISION, path),
    operationalOverride: {
      sourceAvailability: AVAILABILITY_OPERATION.current.source_availability,
      sourceLockPath: 'contracts/sources.lock.json',
      sourceLockSha256: availability.sourceLockSha256,
      sourceClosurePath: 'manifests/source-closure.gen.json',
      sourceClosureSha256: availability.sourceClosureSha256,
    },
    availabilityProof: availability,
  })
  return manifest
}

function buildOutputs(closure) {
  const { lock, nexus, vfs, fixtures } = closure
  const outputs = new Map()
  const put = (path, data) => outputs.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data))
  const priorBaseline = verifyCompatibilityBaseline({ sourceLock: lock })

  put('contracts/zone-id/pin.json', stableJson(zoneIdPin(lock, priorBaseline)))
  for (const [name, path] of Object.entries(SOURCE_OUTPUTS.vfs)) put(path, vfs[name])
  for (const [name, path] of Object.entries(SOURCE_OUTPUTS.nexus)) put(path, nexus[name])
  for (const { metadata, data } of fixtures.values()) put(generatedFixturePath(metadata.path), data)

  const zoneSpec = parseJson(vfs.zone_id_spec, 'ZoneId spec')
  const vectors = legacyVectors(zoneSpec)
  const zoneTypeScript = renderZoneIdTypeScript(
    zoneSpec,
    lock.repositories['nexus-vfs'].revision,
    lock.repositories['nexus-vfs'].files.zone_id_spec.path,
  )
  const compiledZoneId = compileTypeScript(zoneTypeScript, 'zone-id.gen.ts')
  put('contracts/zone-id/zone-id.gen.ts', zoneTypeScript)
  put('contracts/zone-id/zone-id.gen.js', compiledZoneId.javascript)
  put('contracts/zone-id/zone-id.gen.d.ts', compiledZoneId.declarations)
  put('contracts/zone-id/vectors.gen.json', `${JSON.stringify(vectors, null, 2)}\n`)
  put('contracts/zone-id/EXAMPLES.gen.md', renderExamples(zoneSpec, vectors, lock.repositories['nexus-vfs'].revision))
  const resourceRefTypeScript = renderResourceRefTypeScript({
    nexusRevision: lock.repositories.nexus.revision,
    definitionRevision: lock.repositories.nexus.definition_revision,
    nexusVfsRevision: lock.repositories['nexus-vfs'].revision,
    apiVersion: nexus.schemaJson.properties.api_version.const,
    kind: nexus.schemaJson.properties.kind.const,
  })
  const compiledResourceRef = compileTypeScript(resourceRefTypeScript, 'resource-ref.gen.ts')
  put('contracts/common/v1/resource-ref/resource-ref.gen.ts', resourceRefTypeScript)
  put('contracts/common/v1/resource-ref/resource-ref.gen.js', compiledResourceRef.javascript)
  put('contracts/common/v1/resource-ref/resource-ref.gen.d.ts', compiledResourceRef.declarations)
  put('contracts/common/v1/resource-ref/fixture-index.gen.json', stableJson(fixtureIndex(closure)))
  put('compatibility/current.gen.json', stableJson(compatibilityManifest(closure, priorBaseline)))
  put('manifests/source-closure.gen.json', stableJson(sourceClosureManifest(closure)))
  put(CANDIDATE_MANIFEST_PATH, stableJson(candidateManifest(closure, outputs)))
  return outputs
}

function applyOutputs(outputs) {
  let changed = 0
  for (const [path, data] of outputs) {
    const absolute = outputPath(path)
    const existing = existsSync(absolute) ? readFileSync(absolute) : null
    if (existing?.equals(data)) continue
    changed += 1
    if (CHECK) {
      console.error(`stale: ${path}`)
      continue
    }
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, data)
    console.log(`wrote  ${path}`)
  }
  if (CHECK && changed > 0) throw new Error(`${changed} generated artifact(s) are stale`)
  console.log(changed === 0 ? 'up to date' : `${changed} generated artifact(s) updated`)
}

async function main() {
  if (VERIFY_REMOTE) {
    await loadOwnerClosure({ mode: 'remote' })
    console.log('remote owner sources verified')
    return
  }
  if (VERIFY_SOURCES) {
    const closure = await loadOwnerClosure({ mode: 'local' })
    console.log(
      `verified owner sources: Nexus ${closure.lock.repositories.nexus.revision}, ` +
        `nexus-vfs ${closure.lock.repositories['nexus-vfs'].revision}, ` +
        `${closure.fixtures.size} ResourceRef fixtures`,
    )
    return
  }
  const closure = OFFLINE ? loadOfflineClosure() : await loadOwnerClosure({ mode: 'local' })
  applyOutputs(buildOutputs(closure))
}

try {
  await main()
} catch (error) {
  if (error instanceof SourceUnavailableError) {
    console.error(`SOURCE AVAILABILITY BLOCKED: ${error.message}`)
  } else {
    console.error(error.stack ?? error.message)
  }
  process.exit(1)
}
