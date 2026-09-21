#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { visit } from 'jsonc-parser'

import { OPERATION_PATH, REPO, verifyActivationSupport } from './activation-0.2.1.mjs'
import { readCommitBlob } from './activation.mjs'
import { createHistoricalReader, expectedCurrentPackedPaths } from './content-candidate.mjs'
import { sha256, stableJson } from './source.mjs'

const C = '273fd4097cbc33c1c049c39bb1fb60cef2663e2b'
const A = '665f0c6b83bc3c80b4cb697dc86ac1b6aa92bf4d'
const CANDIDATE = 'manifests/releases/0.2.1-candidate.gen.json'
const OWNER = 'contracts/common/v1/resource-ref/owner-manifest.source.gen.json'
const FIXTURES = 'contracts/common/v1/resource-ref/fixture-index.gen.json'
const ZONE_ID_VECTORS = 'contracts/zone-id/vectors.source.gen.json'
const ZONE_PATH_CASES = 'contracts/zone-path/cases.source.gen.json'
const CLOSURE = 'manifests/source-closure.gen.json'
const BASELINE = 'compatibility/baselines/0.2.0-package.json'
const FAMILIES = ['resource_ref', 'zone_id', 'zone_path']
const FIXTURE_COUNTS = { resource_ref: 25, zone_id: 12, zone_path: 23 }
const EXPORTS = {
  './zone-id': { family: 'zone_id', stem: 'contracts/zone-id/zone-id.gen' },
  './common/v1/resource-ref': { family: 'resource_ref', stem: 'contracts/common/v1/resource-ref/resource-ref.gen' },
}
const PREPARATION = [
  'contracts/zone-id/schema.gen.json', ZONE_ID_VECTORS,
  'contracts/common/v1/resource-ref/schema.gen.json', OWNER, FIXTURES,
]
const ZONE_PATH = ['contracts/zone-path/schema.gen.json', 'contracts/zone-path/meta-schema.gen.json', ZONE_PATH_CASES]
const METADATA = ['README.md', 'package.json', 'compatibility/current.gen.json', CLOSURE,
  'manifests/releases/0.2.0-candidate.gen.json', CANDIDATE]
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const revision = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
const pathSafe = (value) => typeof value === 'string' && value.length <= 240 &&
  value.split('/').every((part) => /^(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/.test(part))
const same = (a, b) => stableJson(a) === stableJson(b)
const keys = (value, expected) => object(value) && same(Object.keys(value).sort(), [...expected].sort())
const empty = (value) => Array.isArray(value) && value.length === 0
class AuditInputError extends Error {}
const requireInput = (condition, rule) => { if (!condition) throw new AuditInputError(rule) }
const limits = () => ({
  accounting_valid: false,
  dist04_satisfied: false,
  release_admission: false,
  consumer_adoption_verified: false,
  deployment_verified: false,
  consumer_evidence_verified: false,
  hosted_evidence_verified: false,
  local_content_record_verified: false,
  input_provenance: 'unverified_in_memory',
})

function parseInput(text) {
  requireInput(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024, 'bounded_json_text_required')
  const stack = []
  let nodes = 0
  const enter = (value) => {
    requireInput(++nodes <= 20000 && stack.length < 32, 'input_limit')
    stack.push(value)
  }
  visit(text, {
    onObjectBegin: () => enter(new Set()),
    onObjectProperty: (name) => {
      requireInput(++nodes <= 20000 && !stack.at(-1).has(name), 'duplicate_key_or_input_limit')
      stack.at(-1).add(name)
    },
    onObjectEnd: () => stack.pop(),
    onArrayBegin: () => enter(null),
    onArrayEnd: () => stack.pop(),
    onLiteralValue: () => requireInput(++nodes <= 20000, 'input_limit'),
    onError: () => { throw new AuditInputError('invalid_json') },
  }, { disallowComments: true, allowTrailingComma: false })
  return JSON.parse(text)
}

function inventory(entries) {
  requireInput(Array.isArray(entries) && entries.length > 0 && entries.length <= 100, 'malformed_inventory')
  const result = new Map()
  for (const item of entries) {
    requireInput(keys(item, ['path', 'sha256']) && pathSafe(item.path) && digest(item.sha256), 'invalid_artifact')
    requireInput(!result.has(item.path), 'duplicate_artifact')
    result.set(item.path, item.sha256)
  }
  return result
}

function analyze(input) {
  requireInput(keys(input, ['package', 'candidate', 'owner', 'fixture_index', 'zone_id_vectors', 'zone_path_cases',
    'source_closure', 'support_record', 'identity', 'packed_artifacts']), 'unsupported_input_shape')
  const { package: pkg, candidate, owner, fixture_index: index, source_closure: closure, support_record: support, identity } = input
  requireInput(object(pkg) && pkg.name === '@sudo/contracts' && pkg.version === '0.2.1', 'unsupported_package')
  requireInput(object(candidate) && candidate.manifest_version === 2 && object(candidate.package) &&
    candidate.package.name === pkg.name && candidate.package.version === pkg.version, 'candidate_identity_mismatch')
  requireInput(keys(identity, ['content_revision', 'operation_revision', 'operation_sha256', 'package_sha256',
    'content_integration_revision', 'moss_feature_revision', 'moss_integration_revision']) && identity.content_revision === C &&
    identity.operation_revision === A && digest(identity.operation_sha256) && digest(identity.package_sha256) &&
    [identity.content_integration_revision, identity.moss_feature_revision, identity.moss_integration_revision].every(revision), 'identity_mismatch')
  requireInput(keys(pkg.exports, Object.keys(EXPORTS)), 'unsupported_export_set')
  const packed = inventory(input.packed_artifacts)
  requireInput(packed.size === 43, 'fixed_content_inventory_count_mismatch')
  const generated = inventory(candidate.generated_artifacts)
  const internal = inventory(candidate.internal_generation_artifacts)
  for (const path of internal.keys()) {
    requireInput(!packed.has(path), 'internal_artifact_shipped')
    requireInput(/^contracts\/(zone-id|zone-path|common\/v1\/resource-ref)\//.test(path), 'unsupported_internal_family')
  }
  for (const [path, hash] of generated) requireInput(packed.get(path) === hash, 'artifact_digest_mismatch')
  requireInput(packed.get('package.json') === candidate.package.package_json_sha256, 'package_digest_mismatch')
  requireInput(keys(index, ['index_version', ...FAMILIES]) && index.index_version === 1 && object(owner) &&
    owner.manifest_version === 1 && object(owner.roles) && object(owner.fixtures) &&
    object(candidate.fixtures) && keys(candidate.owners, ['nexus', 'nexus-vfs']), 'malformed_preparation')
  requireInput(empty(owner.roles.actual_consumers) && empty(owner.roles.actual_producers) &&
    empty(candidate.package.actual_consumers) && empty(candidate.package.actual_producers), 'unsupported_production_claim')
  requireInput(Array.isArray(owner.roles.planned_consumers) && Array.isArray(owner.roles.planned_producers), 'malformed_planned_roles')
  requireInput(object(closure) && closure.manifest_version === 1 && keys(closure.repositories, ['nexus', 'nexus-vfs']) &&
    object(owner.definition) && owner.definition.owner_revision === candidate.owners.nexus.definition_revision &&
    closure.repositories.nexus.revision === candidate.owners.nexus.provenance_revision &&
    closure.repositories['nexus-vfs'].revision === candidate.owners['nexus-vfs'].revision &&
    revision(owner.definition.owner_revision) && revision(candidate.owners['nexus-vfs'].revision), 'owner_identity_mismatch')
  requireInput(owner.definition.source_sha256 === packed.get('contracts/common/v1/resource-ref/schema.gen.json'), 'owner_schema_digest_mismatch')
  const fixturePaths = []
  const caseIds = new Set()
  requireInput(object(index.resource_ref) && Array.isArray(index.resource_ref.cases) &&
    Array.isArray(owner.fixtures.cases), 'malformed_fixture_index')
  requireInput(candidate.fixtures.aggregate_index_sha256 === packed.get(FIXTURES) &&
    index.resource_ref.owner_index_sha256 === owner.fixtures.index_sha256, 'fixture_index_digest_mismatch')
  for (const item of index.resource_ref.cases) {
    requireInput(object(item) && pathSafe(item.distributed_path) &&
      /^contracts\/common\/v1\/resource-ref\/fixtures\/(valid|invalid)\/[a-z0-9-]+\.gen\.json$/.test(item.distributed_path) &&
      typeof item.case_id === 'string' && !caseIds.has(item.case_id) && !fixturePaths.includes(item.distributed_path), 'invalid_or_duplicate_fixture')
    caseIds.add(item.case_id)
    fixturePaths.push(item.distributed_path)
    requireInput(item.owner_definition_revision === owner.definition.owner_revision &&
      item.owner_provenance_revision === candidate.owners.nexus.provenance_revision &&
      item.owner_sha256 === packed.get(item.distributed_path), 'fixture_identity_mismatch')
    const declaration = owner.fixtures.cases.find((entry) => entry.case_id === item.case_id)
    requireInput(declaration?.sha256 === item.owner_sha256, 'owner_fixture_mismatch')
  }
  requireInput(fixturePaths.length === FIXTURE_COUNTS.resource_ref && fixturePaths.length === index.resource_ref.count &&
    fixturePaths.length === candidate.fixtures.resource_ref && fixturePaths.length === owner.fixtures.cases.length, 'fixture_count_mismatch')
  for (const [family, bundle, path] of [['zone_id', input.zone_id_vectors, ZONE_ID_VECTORS], ['zone_path', input.zone_path_cases, ZONE_PATH_CASES]]) {
    requireInput(object(bundle) && Array.isArray(bundle.cases) && bundle.cases.length === FIXTURE_COUNTS[family] &&
      bundle.cases.length === index[family]?.count && bundle.cases.length === candidate.fixtures[family] &&
      index[family].bundle_sha256 === packed.get(path), 'primitive_fixture_mismatch')
    const valueKey = family === 'zone_id' ? 'value' : 'path'
    const identifiers = new Set()
    const outcomes = new Set()
    for (const item of bundle.cases) {
      requireInput(keys(item, ['id', 'class', 'expected', valueKey]) &&
        typeof item.id === 'string' && /^[a-z][a-z0-9-]{0,127}$/.test(item.id) && !identifiers.has(item.id) &&
        typeof item.class === 'string' && item.class.trim().length > 0 && typeof item[valueKey] === 'string' &&
        ['accept', 'reject'].includes(item.expected), 'invalid_or_duplicate_primitive_fixture')
      identifiers.add(item.id)
      outcomes.add(item.expected)
    }
    requireInput(outcomes.has('accept') && outcomes.has('reject'), 'primitive_fixture_outcomes_missing')
  }
  const publicTargets = new Set()
  const exports = Object.entries(EXPORTS).map(([subpath, expected]) => {
    requireInput(keys(pkg.exports[subpath], ['types', 'import', 'require', 'default']), 'unsupported_export_conditions')
    const conditions = Object.keys(pkg.exports[subpath]).sort().map((condition) => {
      const target = `${expected.stem}.${condition === 'types' ? 'd.ts' : 'js'}`
      requireInput(pkg.exports[subpath][condition] === `./${target}` && packed.has(target), 'unaccounted_export_target')
      publicTargets.add(target)
      return { condition, target, sha256: packed.get(target) }
    })
    return { subpath, family: expected.family, conditions, preparation: {
      owner_repository: expected.family === 'zone_id' ? 'nexi-lab/nexus-vfs' : 'nexi-lab/nexus',
      schema_path: expected.family === 'zone_id' ? 'contracts/zone-id/schema.gen.json' : 'contracts/common/v1/resource-ref/schema.gen.json',
      owner_revision: expected.family === 'zone_id' ? candidate.owners['nexus-vfs'].revision : owner.definition.owner_revision,
      fixture_count: candidate.fixtures[expected.family],
      scope: 'owner_and_fixture_preparation_not_production_adoption',
    }, support: expected.family === 'zone_id' ? 'recorded_moss_embedded_only_not_reverified' : 'exported_preparation_without_confirmed_production_consumer' }
  }).sort((a, b) => a.subpath.localeCompare(b.subpath, 'en'))
  const distribution = [...PREPARATION, ...ZONE_PATH, ...fixturePaths, ...publicTargets, 'compatibility/current.gen.json', CLOSURE]
  requireInput(same([...generated.keys()].sort(), distribution.sort()), 'unaccounted_generated_artifact')
  requireInput(same([...packed.keys()].sort(), [...new Set([...distribution, ...METADATA])].sort()), 'unaccounted_packed_artifact')
  requireInput(Array.isArray(pkg.files) && pkg.files.length > 0, 'malformed_package_files')
  const selectors = new Set()
  for (const selector of pkg.files) {
    requireInput(typeof selector === 'string' && pathSafe(selector.replace(/\/$/, '')) && !selectors.has(selector), 'invalid_package_selector')
    selectors.add(selector)
    requireInput([...packed.keys()].some((path) => path === selector || path.startsWith(`${selector.replace(/\/$/, '')}/`)), 'unaccounted_package_selector')
  }
  requireInput([...packed.keys()].filter((path) => !['README.md', 'package.json'].includes(path)).every((path) =>
    [...selectors].some((selector) => path === selector || path.startsWith(`${selector.replace(/\/$/, '')}/`))), 'unshipped_artifact')
  requireInput(keys(support, ['scope', 'c03_resolution', 'actual_consumers', 'actual_producers', 'families', 'candidate_package_metadata', 'publication_scope']) &&
    support.scope === 'included_moss_zone_id_embedded_only' && support.publication_scope === 'package_external_activation_support' &&
    support.c03_resolution === 'resolved_for_included_moss_zone_id_scope' &&
    support.candidate_package_metadata === 'immutable_staged_unfrozen_empty' &&
    keys(support.families, FAMILIES), 'unsupported_support_scope')
  for (const role of ['actual_consumers', 'actual_producers']) {
    requireInput(Array.isArray(support[role]) && support[role].length === 1, 'unsupported_support_claim')
    const entry = support[role][0]
    requireInput(keys(entry, ['id', 'repository', 'content_revision', 'integration_revision', 'family', 'family_major', 'boundary', 'role', 'support_state']) &&
      typeof entry.id === 'string' && /^[a-z0-9][a-z0-9.-]{0,127}$/.test(entry.id) &&
      entry.repository === 'sudoprivacy/moss' && entry.family === 'zone_id' && entry.family_major === 1 &&
      entry.content_revision === identity.content_revision && entry.integration_revision === identity.moss_integration_revision &&
      entry.role === (role === 'actual_consumers' ? 'installed_validator_and_argv_consumer' : 'launch_argument_producer') &&
      entry.boundary === (role === 'actual_consumers'
        ? 'src/server/nexus/nexusManager.ts::NexusManager.start()' : 'embedded nexusd --cluster-init argument') &&
      entry.support_state === 'integrated_tested_exact_candidate', 'support_identity_mismatch')
  }
  requireInput(keys(support.families.zone_id, ['support_state', 'runtime_modes', 'excluded_runtime_modes']) &&
    support.families.zone_id.support_state === 'integrated_tested_exact_candidate' &&
    same(support.families.zone_id.runtime_modes, ['embedded']) &&
    same(support.families.zone_id.excluded_runtime_modes, ['external']), 'unsupported_runtime_scope')
  for (const family of ['resource_ref', 'zone_path']) {
    requireInput(keys(support.families[family], ['support_state', 'actual_consumers', 'actual_producers']) &&
      support.families[family].support_state === (family === 'resource_ref'
        ? 'deferred_no_current_production_provider_or_consumer' : 'deferred_owner_dependency_only_for_resource_ref') &&
      empty(support.families[family].actual_consumers) && empty(support.families[family].actual_producers), 'unsupported_support_claim')
  }
  return {
    ...limits(), accounting_valid: true,
    status: 'accounting_valid_with_known_gap',
    identities: identity,
    package: { name: pkg.name, version: pkg.version, packed_path_count: packed.size },
    exports,
    shipped_only: {
      zone_path: { paths: [...ZONE_PATH].sort(), scope: 'owner_reference_dependency_only', runtime_adoption: 'deferred', fixture_count: candidate.fixtures.zone_path },
      other_preparation_path_count: PREPARATION.length + fixturePaths.length,
      metadata_paths: [...METADATA].sort(),
    },
    zone_id_record: {
      repository: 'sudoprivacy/moss', runtime_modes: ['embedded'], excluded_runtime_modes: ['external'],
      source: 'immutable_A_record_not_current_mode_consumer_or_hosted_verification',
      consumer_record_count: support.actual_consumers.length, producer_record_count: support.actual_producers.length,
      consumer_boundary: support.actual_consumers[0].boundary, consumer_role: support.actual_consumers[0].role,
      producer_boundary: support.actual_producers[0].boundary, producer_role: support.actual_producers[0].role,
    },
    known_gaps: [{ clause: 'ADR005-DIST-04', family: 'resource_ref', classification: 'Conflicting',
      reason: 'exported_without_confirmed_production_consumer', actual_consumer_count: 0, actual_producer_count: 0,
      planned_roles_are_not_production_evidence: true, fixtures_and_imports_are_not_adoption: true }],
  }
}

export function analyzeExportSupport(jsonText) {
  try { return analyze(parseInput(jsonText)) }
  catch (error) {
    return { ...limits(), status: 'invalid_input', findings: [{ rule: error instanceof AuditInputError ? error.message : 'malformed_input' }] }
  }
}

function withOfflineEnvironment(run) {
  const overrides = { GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_TERMINAL_PROMPT: '0', npm_config_offline: 'true', npm_config_update_notifier: 'false' }
  const names = new Set([...Object.keys(process.env).filter((name) => name.startsWith('GIT_')), ...Object.keys(overrides)])
  const previous = new Map([...names].map((name) => [name, process.env[name]]))
  try {
    for (const name of names) delete process.env[name]
    Object.assign(process.env, overrides)
    return run()
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

export function readExportSupportInput(repository = REPO) {
  try {
    return withOfflineEnvironment(() => {
      const read = createHistoricalReader(repository, C)
      const json = (path) => parseInput(new TextDecoder('utf-8', { fatal: true }).decode(read(path)))
      const operationBytes = readCommitBlob(repository, A, OPERATION_PATH)
      const operation = parseInput(new TextDecoder('utf-8', { fatal: true }).decode(operationBytes))
      const paths = [...expectedCurrentPackedPaths(json(BASELINE))].sort()
      return stableJson({
        package: json('package.json'), candidate: json(CANDIDATE), owner: json(OWNER), fixture_index: json(FIXTURES),
        zone_id_vectors: json(ZONE_ID_VECTORS), zone_path_cases: json(ZONE_PATH_CASES), source_closure: json(CLOSURE),
        support_record: operation.effective_support,
        identity: { content_revision: C, operation_revision: A, operation_sha256: sha256(operationBytes),
          content_integration_revision: operation.content_evidence.integration_revision,
          moss_feature_revision: operation.consumer_evidence.feature_revision,
          moss_integration_revision: operation.consumer_evidence.integration_revision,
          package_sha256: operation.content_evidence.package.tarball.sha256 },
        packed_artifacts: paths.map((path) => ({ path, sha256: sha256(read(path)) })),
      })
    })
  } catch { throw new Error('immutable_audit_input_unavailable') }
}

export function auditExportSupport({ repository = REPO } = {}) {
  try {
    const text = readExportSupportInput(repository)
    const input = parseInput(text)
    const report = analyzeExportSupport(text)
    if (!report.accounting_valid) return report
    const proof = withOfflineEnvironment(() => verifyActivationSupport({ repository, sourceMode: 'offline' }))
    const identity = input.identity
    requireInput(proof.sourceMode === 'offline' && proof.verificationState === 'record_and_content_verified' &&
      proof.consumerEvidenceVerified === false && proof.hostedEvidenceVerified === false &&
      proof.c03Resolution === 'not_verified_in_this_mode' && proof.contentRevision === identity.content_revision &&
      proof.contentIntegrationRevision === identity.content_integration_revision && proof.operationSha256 === identity.operation_sha256 &&
      proof.mossFeatureRevision === identity.moss_feature_revision && proof.mossIntegrationRevision === identity.moss_integration_revision &&
      proof.packageSha256 === identity.package_sha256 && proof.packagePathCount === report.package.packed_path_count &&
      same(proof.recordedSupport, input.support_record), 'offline_verification_binding_mismatch')
    return { ...report, local_content_record_verified: true,
      input_provenance: 'immutable_git_content_bound_to_offline_activation_record',
      upstream_verification: { source_mode: proof.sourceMode, state: proof.verificationState,
        c03_resolution: proof.c03Resolution, consumer_evidence_verified: false, hosted_evidence_verified: false } }
  } catch {
    return { ...limits(), status: 'verification_failed', findings: [{ rule: 'offline_content_record_verification_failed' }] }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = process.argv.length === 2 ? auditExportSupport() : {
    ...limits(), status: 'invalid_input', findings: [{ rule: 'usage_no_arguments_or_approval_overrides' }],
  }
  process.stdout.write(stableJson(report))
  process.exitCode = report.accounting_valid ? 0 : 1
}
