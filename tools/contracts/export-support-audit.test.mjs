import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { analyzeExportSupport, auditExportSupport, readExportSupportInput } from './export-support-audit.mjs'
import { sha256, stableJson } from './source.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = join(REPO, 'tools/contracts/export-support-audit.mjs')
const seed = JSON.parse(readExportSupportInput())
const raw = (value) => analyzeExportSupport(JSON.stringify(value))
const change = (mutate) => {
  const input = structuredClone(seed)
  mutate(input)
  return raw(input)
}
function unapproved(report) {
  for (const key of ['dist04_satisfied', 'release_admission', 'consumer_adoption_verified', 'deployment_verified',
    'consumer_evidence_verified', 'hosted_evidence_verified']) assert.equal(report[key], false, key)
}
function invalid(mutate) {
  const report = change(mutate)
  assert.equal(report.accounting_valid, false, JSON.stringify(report))
  assert.equal(report.status, 'invalid_input')
  assert.equal(report.local_content_record_verified, false)
  unapproved(report)
  return report
}

test('both current exports enumerate all condition targets without adoption claims', () => {
  const report = raw(seed)
  assert.equal(report.accounting_valid, true, JSON.stringify(report))
  assert.equal(report.input_provenance, 'unverified_in_memory')
  assert.equal(report.local_content_record_verified, false)
  assert.equal(report.package.packed_path_count, 43)
  assert.deepEqual(report.exports.map((entry) => entry.subpath), ['./common/v1/resource-ref', './zone-id'])
  for (const entry of report.exports) {
    assert.deepEqual(entry.conditions.map((item) => item.condition), ['default', 'import', 'require', 'types'])
    assert.equal(new Set(entry.conditions.map((item) => item.target)).size, 2)
    assert.equal(entry.preparation.scope, 'owner_and_fixture_preparation_not_production_adoption')
  }
  unapproved(report)
})

test('shipped ZonePath artifacts are dependency preparation, not public runtime adoption', () => {
  const report = raw(seed)
  assert.equal(report.exports.some((entry) => entry.family === 'zone_path'), false)
  assert.equal(report.shipped_only.zone_path.paths.length, 3)
  assert.equal(report.shipped_only.zone_path.fixture_count, 23)
  assert.equal(report.shipped_only.zone_path.runtime_adoption, 'deferred')
  assert.equal(report.shipped_only.zone_path.scope, 'owner_reference_dependency_only')
})

test('Moss support remains a scoped immutable record, never newly verified evidence', () => {
  const report = raw(seed)
  assert.equal(report.identities.content_revision, '273fd4097cbc33c1c049c39bb1fb60cef2663e2b')
  assert.equal(report.identities.operation_revision, '665f0c6b83bc3c80b4cb697dc86ac1b6aa92bf4d')
  assert.equal(report.identities.moss_feature_revision, 'e9660ed1483cf01f96fe06c45ba7e070e0223ec3')
  assert.equal(report.identities.moss_integration_revision, '18a0a069b808c295287675afc6346f411be971a5')
  assert.deepEqual(report.zone_id_record.runtime_modes, ['embedded'])
  assert.deepEqual(report.zone_id_record.excluded_runtime_modes, ['external'])
  assert.equal(report.zone_id_record.consumer_record_count, 1)
  assert.equal(report.zone_id_record.producer_record_count, 1)
  unapproved(report)
})

test('valid accounting retains the ResourceRef DIST04 conflict and zero production roles', () => {
  const report = raw(seed)
  assert.equal(report.status, 'accounting_valid_with_known_gap')
  assert.equal(report.known_gaps.length, 1)
  assert.deepEqual(report.known_gaps[0], {
    clause: 'ADR005-DIST-04', family: 'resource_ref', classification: 'Conflicting',
    reason: 'exported_without_confirmed_production_consumer', actual_consumer_count: 0, actual_producer_count: 0,
    planned_roles_are_not_production_evidence: true, fixtures_and_imports_are_not_adoption: true,
  })
  assert.equal(seed.owner.roles.planned_consumers.length > 0, true)
  unapproved(report)
})

test('missing, extra, unsafe and malformed export targets fail accounting', () => {
  for (const mutate of [
    (input) => { delete input.package.exports['./zone-id'] },
    (input) => { input.package.exports['./future-family'] = {} },
    (input) => { input.package.exports['./zone-path'] = input.package.exports['./zone-id'] },
    (input) => { input.package.exports['./zone-id'].import = '../credential-secret' },
    (input) => { input.package.exports['./zone-id'].default = './contracts/zone-id/missing.js' },
    (input) => { input.package.exports['./zone-id'].browser = './future.js' },
    (input) => { input.package.exports['./zone-id'] = null },
    (input) => { input.package.exports['./zone-id'].require = [] },
    (input) => { delete input.package.exports['./zone-id'].types },
    (input) => { input.package.exports = [] },
  ]) assert.equal(JSON.stringify(invalid(mutate)).includes('credential-secret'), false)
})

test('null, duplicate, missing and additional artifact inventories fail closed', () => {
  for (const mutate of [
    (input) => { input.packed_artifacts = null },
    (input) => { input.candidate.generated_artifacts = null },
    (input) => { input.candidate.internal_generation_artifacts = null },
    (input) => { input.packed_artifacts.push(input.packed_artifacts[0]) },
    (input) => { input.packed_artifacts[0] = null },
    (input) => { input.packed_artifacts.pop() },
    (input) => { input.packed_artifacts.push({ path: 'contracts/future/schema.json', sha256: 'a'.repeat(64) }) },
    (input) => { input.candidate.generated_artifacts.push(input.candidate.generated_artifacts[0]) },
    (input) => { input.candidate.generated_artifacts[0].path = '../credential-secret' },
  ]) invalid(mutate)
})

test('a target omitted from every supplied inventory is still missing', () => {
  invalid((input) => {
    const target = 'contracts/zone-id/zone-id.gen.js'
    input.packed_artifacts = input.packed_artifacts.filter((entry) => entry.path !== target)
    input.candidate.generated_artifacts = input.candidate.generated_artifacts.filter((entry) => entry.path !== target)
    input.package.files = input.package.files.filter((path) => path !== target)
  })
})

test('export, owner, fixture and content identity mismatches fail closed', () => {
  for (const mutate of [
    (input) => { input.candidate.package.version = '0.2.2' },
    (input) => { input.identity.content_revision = 'a'.repeat(40) },
    (input) => { input.identity.operation_revision = 'a'.repeat(40) },
    (input) => { input.identity.package_sha256 = 'invalid-digest' },
    (input) => { input.packed_artifacts.find((entry) => entry.path === 'contracts/zone-id/zone-id.gen.js').sha256 = '0'.repeat(64) },
    (input) => { input.candidate.package.package_json_sha256 = '0'.repeat(64) },
    (input) => { input.owner.definition.owner_revision = '0'.repeat(40) },
    (input) => { input.owner.definition.source_sha256 = '0'.repeat(64) },
    (input) => { input.source_closure.repositories.nexus.revision = '0'.repeat(40) },
    (input) => { input.fixture_index.resource_ref.cases[0].owner_sha256 = '0'.repeat(64) },
    (input) => { input.fixture_index.zone_path.bundle_sha256 = '0'.repeat(64) },
    (input) => { input.fixture_index.resource_ref.owner_index_sha256 = '0'.repeat(64) },
    (input) => { input.candidate.fixtures.aggregate_index_sha256 = '0'.repeat(64) },
  ]) invalid(mutate)
})

test('unknown families, fixture omission and duplicate cases are rejected', () => {
  for (const mutate of [
    (input) => { input.fixture_index.future = {} },
    (input) => { input.fixture_index.resource_ref.cases = [] },
    (input) => { input.fixture_index.resource_ref.cases[1] = input.fixture_index.resource_ref.cases[0] },
    (input) => { input.fixture_index.resource_ref.count++ },
    (input) => { input.owner.fixtures.cases.pop() },
    (input) => { input.zone_id_vectors.cases = [] },
    (input) => { input.zone_path_cases.cases.forEach((item) => { item.expected = 'accept' }) },
    (input) => { input.candidate.owners.future = {} },
    (input) => { input.candidate.internal_generation_artifacts.push({ path: 'contracts/future/source.json', sha256: 'a'.repeat(64) }) },
  ]) invalid(mutate)
})

test('every primitive fixture has a valid unique identity and expected outcome', () => {
  for (const family of ['zone_id', 'zone_path']) {
    const key = family === 'zone_id' ? 'zone_id_vectors' : 'zone_path_cases'
    for (const mutate of [
      (cases) => { cases[cases.length - 1] = null },
      (cases) => { cases[1] = cases[0] },
      (cases) => { cases[cases.length - 1].expected = 'unreviewed' },
      (cases) => { cases[cases.length - 1].id = '' },
      (cases) => { cases[cases.length - 1][family === 'zone_id' ? 'value' : 'path'] = null },
    ]) invalid((input) => mutate(input[key].cases))
    invalid((input) => {
      input[key].cases.pop()
      input.fixture_index[family].count--
      input.candidate.fixtures[family]--
    })
  }
})

test('coherent fixture omission cannot redefine the fixed C inventory', () => {
  const report = invalid((input) => {
    const omitted = input.fixture_index.resource_ref.cases.pop()
    input.fixture_index.resource_ref.count--
    input.candidate.fixtures.resource_ref--
    input.owner.fixtures.cases = input.owner.fixtures.cases.filter((item) => item.case_id !== omitted.case_id)
    input.candidate.generated_artifacts = input.candidate.generated_artifacts.filter((item) => item.path !== omitted.distributed_path)
    input.packed_artifacts = input.packed_artifacts.filter((item) => item.path !== omitted.distributed_path)
  })
  assert.equal(report.findings[0].rule, 'fixed_content_inventory_count_mismatch')
})

test('package files selectors cannot omit artifacts or add unsupported paths', () => {
  for (const mutate of [
    (input) => { input.package.files = null },
    (input) => { input.package.files.push(input.package.files[0]) },
    (input) => { input.package.files.push('../credential-secret') },
    (input) => { input.package.files.push('contracts/future/') },
    (input) => { input.package.files = input.package.files.filter((path) => path !== 'contracts/zone-path/schema.gen.json') },
  ]) invalid(mutate)
})

test('nonempty actual arrays and copied planned roles are not admitted consumers', () => {
  for (const mutate of [
    (input) => { input.owner.roles.actual_consumers = [...input.owner.roles.planned_consumers] },
    (input) => { input.owner.roles.actual_producers = ['Nexus planned producer'] },
    (input) => { input.candidate.package.actual_consumers = ['import smoke'] },
    (input) => { input.support_record.families.resource_ref.actual_consumers = ['fixture runner'] },
    (input) => { input.support_record.families.zone_path.actual_producers = ['schema projection'] },
    (input) => { input.support_record.actual_consumers[0].role = 'planned_consumer' },
    (input) => { input.support_record.actual_consumers[0].boundary = 'fixture runner only' },
    (input) => { input.support_record.actual_consumers[0].id = null },
  ]) invalid(mutate)
  const morePlanned = change((input) => input.owner.roles.planned_consumers.push('Future planned caller'))
  assert.equal(morePlanned.accounting_valid, true)
  assert.equal(morePlanned.known_gaps[0].actual_consumer_count, 0)
})

test('broader support, forged proof flags and conflict suppression cannot elevate accounting', () => {
  for (const mutate of [
    (input) => { input.proof = { verificationState: 'included_scope_admission_verified' } },
    (input) => { input.dist04_satisfied = true },
    (input) => { input.known_gaps = [] },
    (input) => { input.local_content_record_verified = true },
    (input) => { input.release_admission = true },
    (input) => { input.support_record.scope = 'all_families' },
    (input) => { input.support_record.families.resource_ref.support_state = 'adopted' },
    (input) => { input.support_record.families.zone_id.hostedEvidenceVerified = true },
    (input) => { input.support_record.families.zone_id.runtime_modes.push('external') },
    (input) => { input.support_record.actual_consumers[0].integration_revision = '0'.repeat(40) },
    (input) => { input.support_record.actual_consumers.push(input.support_record.actual_consumers[0]) },
  ]) invalid(mutate)
  const forgedDigests = change((input) => {
    input.identity.operation_sha256 = '0'.repeat(64)
    input.identity.package_sha256 = '0'.repeat(64)
  })
  assert.equal(forgedDigests.local_content_record_verified, false)
  assert.equal(forgedDigests.input_provenance, 'unverified_in_memory')
  unapproved(forgedDigests)
})

test('raw analysis is deterministic, pure and insensitive to inventory ordering', () => {
  const original = JSON.stringify(seed)
  const changedOrder = change((input) => {
    input.packed_artifacts.reverse()
    input.candidate.generated_artifacts.reverse()
    input.fixture_index.resource_ref.cases.reverse()
  })
  assert.equal(stableJson(changedOrder), stableJson(raw(seed)))
  assert.equal(JSON.stringify(seed), original)
})

test('malformed and duplicate-key JSON is bounded without executing or reflecting data', () => {
  let calls = 0
  const getter = Object.defineProperty({}, 'toJSON', { get() { calls++; throw new Error('credential-secret') } })
  const proxy = new Proxy({}, { get() { calls++; return 'credential-secret' } })
  const encoded = JSON.stringify(seed)
  for (const input of [null, getter, proxy, '{credential-secret', '{"x":1,"x":2}',
    encoded.replace('"exports":{', '"exports":{"./zone-id":{},'),
    ' '.repeat(1024 * 1024 + 1), '['.repeat(40) + '0' + ']'.repeat(40)]) {
    const report = analyzeExportSupport(input)
    assert.equal(report.accounting_valid, false)
    assert.equal(JSON.stringify(report).includes('credential-secret'), false)
    unapproved(report)
  }
  assert.equal(calls, 0)
})

test('immutable CLI binds the public offline verifier and retains the known gap', () => {
  const protectedPaths = ['package.json', 'package-lock.json', 'manifests/operations/0.2.1-activation-support.json',
    'contracts/common/v1/resource-ref/owner-manifest.source.gen.json']
  const before = protectedPaths.map((path) => sha256(readFileSync(join(REPO, path))))
  const result = spawnSync(process.execPath, [CLI], { cwd: tmpdir(), encoding: 'utf8', timeout: 60000 })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.accounting_valid, true)
  assert.equal(report.local_content_record_verified, true)
  assert.equal(report.upstream_verification.source_mode, 'offline')
  assert.equal(report.upstream_verification.state, 'record_and_content_verified')
  assert.equal(report.upstream_verification.c03_resolution, 'not_verified_in_this_mode')
  assert.equal(report.known_gaps[0].classification, 'Conflicting')
  assert.deepEqual(protectedPaths.map((path) => sha256(readFileSync(join(REPO, path)))), before)
  unapproved(report)
})

test('repeated public offline audits are deterministic and restore subprocess environment', () => {
  const oldGitDir = process.env.GIT_DIR
  const oldOffline = process.env.npm_config_offline
  try {
    process.env.GIT_DIR = '/missing/credential-secret'
    process.env.npm_config_offline = 'false'
    const first = auditExportSupport()
    const second = auditExportSupport()
    assert.equal(first.accounting_valid, true)
    assert.equal(stableJson(first), stableJson(second))
    assert.equal(process.env.GIT_DIR, '/missing/credential-secret')
    assert.equal(process.env.npm_config_offline, 'false')
    assert.equal(first.hosted_evidence_verified, false)
  } finally {
    if (oldGitDir === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = oldGitDir
    if (oldOffline === undefined) delete process.env.npm_config_offline
    else process.env.npm_config_offline = oldOffline
  }
})

test('CLI misuse and unavailable Git evidence fail without reflecting caller paths or stderr', () => {
  for (const args of [['--approve'], ['--force'], ['--remote'], ['--input', '/credential-secret']]) {
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(result.stdout.includes('credential-secret'), false)
    assert.equal(result.stderr, '')
    unapproved(JSON.parse(result.stdout))
  }
  const temporary = mkdtempSync(join(tmpdir(), 'export-audit-credential-secret-'))
  try {
    const report = auditExportSupport({ repository: temporary })
    assert.equal(report.accounting_valid, false)
    assert.equal(report.status, 'verification_failed')
    assert.equal(JSON.stringify(report).includes('credential-secret'), false)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})
