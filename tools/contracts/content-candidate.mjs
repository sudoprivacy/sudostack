import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const HISTORY_REPO = process.env.SUDOSTACK_BASE_REPO ?? REPO
export const HISTORICAL_REVISION = '5a2a53130e37d1c63993ebf8ba1253b15eb9eebf'
export const HISTORICAL_VERSION = '0.2.0'
export const CANDIDATE_VERSION = '0.2.1'
export const BASELINE_PATH = 'compatibility/baselines/0.2.0-package.json'
export const BASELINE_SHA256 = '9ec2cffbcb19f3e728a6691176ed739bab6de52a56b60abe4217420d2ce0c17c'
export const STAGE_PATH = 'manifests/candidates/0.2.1-content.json'
export const CANDIDATE_PATH = 'manifests/releases/0.2.1-candidate.gen.json'
export const HISTORICAL_CANDIDATE_PATH = 'manifests/releases/0.2.0-candidate.gen.json'

const EXPECTED_PACKAGE = {
  name: '@sudo/contracts',
  version: HISTORICAL_VERSION,
  file_count: 42,
  size: 37901,
  unpacked_size: 164428,
  sha1: '2aa7a118da0adf6b7b486f9538fe20204001dcae',
  sha256: '6f3b1bbbcc669b0b9dadd2dbdbc2c01fc5eb473a4839ddad45e0d172343073f8',
  integrity: 'sha512-IkjgQShigZh5265M7HL4mVETHoy9DX4d9KTRI57QhMT5zt4pmNnnsvxdr8OVKc3Y9fpXRvKmi6dRRfm+fCL4cA==',
}

const EXPECTED_PROTECTED_PATHS = new Map([
  ['compatibility/baselines/0.1.0.json', 'historical_compatibility_baseline'],
  ['contracts/common/v1/resource-ref/owner-source-lock.source.gen.json', 'internal_generation_artifact'],
  ['contracts/common/v1/resource-ref/resource-ref.gen.ts', 'internal_generation_artifact'],
  ['contracts/sources.lock.json', 'owner_source_lock'],
  ['contracts/zone-id/EXAMPLES.gen.md', 'internal_generation_artifact'],
  ['contracts/zone-id/pin.json', 'internal_generation_artifact'],
  ['contracts/zone-id/spec.source.gen.json', 'internal_generation_artifact'],
  ['contracts/zone-id/vectors.gen.json', 'internal_generation_artifact'],
  ['contracts/zone-id/zone-id.gen.ts', 'internal_generation_artifact'],
  ['contracts/zone-path/spec.source.gen.json', 'internal_generation_artifact'],
  ['contracts/zone-path/validator-lock.source.gen.json', 'internal_generation_artifact'],
  ['manifests/activations/0.2.0-candidate.json', 'historical_activation'],
  ['manifests/operations/consumer-support.json', 'historical_support'],
  ['manifests/operations/source-availability.json', 'historical_availability'],
  ['package-lock.json', 'version_lock'],
  ['tools/contracts/activation.mjs', 'historical_activation_verifier'],
  ['tools/contracts/availability.mjs', 'historical_availability_verifier'],
  ['tools/contracts/baseline.mjs', 'compatibility_baseline_verifier'],
  ['tools/contracts/compatibility.mjs', 'compatibility_verifier'],
  ['tools/contracts/node-version.mjs', 'runtime_version_gate'],
  ['tools/contracts/runtime-template.mjs', 'runtime_validator_template'],
  ['tools/contracts/source.mjs', 'source_provenance_verifier'],
  ['tools/contracts/support.mjs', 'historical_support_verifier'],
])

export const EXPECTED_STAGE = {
  candidate_stage_version: 1,
  package: {
    name: '@sudo/contracts',
    previous_version: HISTORICAL_VERSION,
    candidate_version: CANDIDATE_VERSION,
    semver_reason: 'Patch metadata stage with byte-identical runtime contracts, schemas, fixtures, validators, and owner sources.',
  },
  lifecycle: {
    content_stage: 'staged',
    adr_maturity: 'proposed',
    contract_baseline: 'unfrozen',
    artifact_publication: 'candidate_unpublished',
    deployment_evidence: 'not_deployed',
  },
  content_identity: {
    candidate_revision: null,
    activation_state: 'pending_future_commit',
    exact_pin_target: 'content_commit_C',
    revision_source: 'containing_commit',
    historical_baseline: {
      path: BASELINE_PATH,
      sha256: BASELINE_SHA256,
      source_revision: HISTORICAL_REVISION,
    },
  },
  historical_0_2_0: {
    candidate_content_revision: '30da0ddd953268ff8a9a0f0980276300ab153003',
    activation_revision: '60bd8dda6fb2d348ec8571b9b1a4eaa535e36dc5',
    source_availability_revision: 'aec52e9dc5438946dd83d5c56c07149a4800120a',
    support_evidence_revision: HISTORICAL_REVISION,
    support_operation_path: 'manifests/operations/consumer-support.json',
    support_classification: 'historical_only_not_candidate_support',
  },
  support: {
    state: 'pending_moss_repin',
    actual_producers: [],
    actual_consumers: [],
    resource_ref: 'deferred',
    zone_path_runtime: 'deferred',
  },
  choreography: {
    sequence: ['content_C', 'moss_repin_M', 'activation_A'],
    content_C: {
      produces: 'installable_immutable_0.2.1_candidate',
      records_own_revision: false,
    },
    moss_repin_M: {
      pins: 'content_commit_C',
      dependency_spec_format: 'github:sudoprivacy/sudostack#{C}',
      required_evidence: 'installed_package_identity_and_default_ci_at_the_real_embedded_boundary',
    },
    activation_A: {
      binds: ['content_commit_C', 'moss_integration_M'],
      evidence_scope: 'package_external',
      mutates_candidate_package_bytes: false,
      consumer_repin_required: false,
      c03_decision: 'pending',
    },
  },
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const parseJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

export function readHistorical(path, repository = HISTORY_REPO, revision = HISTORICAL_REVISION) {
  return execFileSync('git', ['-C', repository, 'show', `${revision}:${path}`], {
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function createHistoricalReader(repository = HISTORY_REPO, revision = HISTORICAL_REVISION) {
  const cache = new Map()
  return (path) => {
    if (!cache.has(path)) cache.set(path, readHistorical(path, repository, revision))
    return cache.get(path)
  }
}

export function verifyStageMetadata(stageBytes) {
  const stage = parseJson(stageBytes, STAGE_PATH)
  assert.deepEqual(stage, EXPECTED_STAGE, `${STAGE_PATH} changed outside the reviewed content-stage contract`)
  const text = stageBytes.toString('utf8')
  assert.equal(/\b[0-9a-f]{40}\b/.test(text.replaceAll(HISTORICAL_REVISION, '').replaceAll(EXPECTED_STAGE.historical_0_2_0.candidate_content_revision, '').replaceAll(EXPECTED_STAGE.historical_0_2_0.activation_revision, '').replaceAll(EXPECTED_STAGE.historical_0_2_0.source_availability_revision, '')), false, 'content stage contains an unrecognized future or self revision')
  return stage
}

export function verifyPackageBaseline({ baselineBytes, historicalBytes } = {}) {
  const getHistorical = historicalBytes ?? createHistoricalReader()
  assert.equal(sha256(baselineBytes), BASELINE_SHA256, `${BASELINE_PATH} digest changed`)
  const baseline = parseJson(baselineBytes, BASELINE_PATH)
  assert.equal(baseline.baseline_version, 1)
  assert.equal(baseline.source_revision, HISTORICAL_REVISION)
  assert.deepEqual(baseline.package, EXPECTED_PACKAGE)
  assert.deepEqual(baseline.successor_policy, {
    candidate_version: CANDIDATE_VERSION,
    changed_packed_paths: ['compatibility/current.gen.json', 'package.json'],
    added_packed_paths: [CANDIDATE_PATH],
    version_only_paths: ['package.json', 'package-lock.json'],
  })

  const historicalCandidate = parseJson(
    getHistorical(HISTORICAL_CANDIDATE_PATH),
    `${HISTORICAL_REVISION}:${HISTORICAL_CANDIDATE_PATH}`,
  )
  const expectedPackedPaths = [
    'README.md',
    'package.json',
    HISTORICAL_CANDIDATE_PATH,
    ...historicalCandidate.generated_artifacts.map(({ path }) => path),
  ].sort()
  const packedPaths = baseline.packed_files.map(({ path }) => path)
  assert.equal(new Set(packedPaths).size, packedPaths.length, 'baseline contains duplicate packed paths')
  assert.deepEqual([...packedPaths].sort(), expectedPackedPaths, 'baseline packed path set changed')
  assert.equal(baseline.packed_files.length, EXPECTED_PACKAGE.file_count)
  assert.equal(
    baseline.packed_files.reduce((total, entry) => total + entry.size, 0),
    EXPECTED_PACKAGE.unpacked_size,
  )
  for (const entry of baseline.packed_files) {
    const bytes = getHistorical(entry.path)
    assert.equal(bytes.length, entry.size, `historical size mismatch: ${entry.path}`)
    assert.equal(entry.mode, 420, `historical mode mismatch: ${entry.path}`)
    assert.equal(sha256(bytes), entry.sha256, `historical package digest mismatch: ${entry.path}`)
  }

  const protectedPaths = baseline.protected_files.map(({ path }) => path)
  assert.equal(new Set(protectedPaths).size, protectedPaths.length, 'baseline contains duplicate protected paths')
  assert.deepEqual([...protectedPaths].sort(), [...EXPECTED_PROTECTED_PATHS.keys()].sort())
  for (const entry of baseline.protected_files) {
    assert.equal(entry.purpose, EXPECTED_PROTECTED_PATHS.get(entry.path), `baseline purpose mismatch: ${entry.path}`)
    assert.equal(sha256(getHistorical(entry.path)), entry.sha256, `historical protected digest mismatch: ${entry.path}`)
  }
  return baseline
}

function expectedVersionOnlyBytes(historicalBytes, fromVersion, toVersion, count, path) {
  const from = `\"version\": \"${fromVersion}\"`
  const to = `\"version\": \"${toVersion}\"`
  const text = historicalBytes.toString('utf8')
  assert.equal(text.split(from).length - 1, count, `${path} historical version field count changed`)
  return Buffer.from(text.replaceAll(from, to))
}

export function verifyCandidateContent({
  repository = REPO,
  outputs,
  currentBytes = (path) => readFileSync(join(repository, path)),
  historicalBytes,
  baseline: suppliedBaseline,
  stage: suppliedStage,
  baselineBytes = currentBytes(BASELINE_PATH),
  stageBytes = currentBytes(STAGE_PATH),
} = {}) {
  const getHistorical = historicalBytes ?? createHistoricalReader(
    process.env.SUDOSTACK_BASE_REPO ?? repository,
  )
  const stage = suppliedStage ?? verifyStageMetadata(stageBytes)
  const baseline = suppliedBaseline ?? verifyPackageBaseline({
    baselineBytes,
    historicalBytes: getHistorical,
  })
  const getCurrent = (path) => outputs?.get(path) ?? currentBytes(path)

  assert.deepEqual(
    getCurrent('package.json'),
    expectedVersionOnlyBytes(getHistorical('package.json'), HISTORICAL_VERSION, CANDIDATE_VERSION, 1, 'package.json'),
    'package.json must differ from 0.2.0 only by its package version',
  )
  assert.deepEqual(
    getCurrent('package-lock.json'),
    expectedVersionOnlyBytes(getHistorical('package-lock.json'), HISTORICAL_VERSION, CANDIDATE_VERSION, 2, 'package-lock.json'),
    'package-lock.json must differ from 0.2.0 only by its two package version fields',
  )

  const mutablePacked = new Set(baseline.successor_policy.changed_packed_paths)
  for (const entry of baseline.packed_files) {
    if (mutablePacked.has(entry.path)) continue
    assert.deepEqual(getCurrent(entry.path), getHistorical(entry.path), `0.2.0 immutable package byte changed: ${entry.path}`)
  }
  for (const entry of baseline.protected_files) {
    if (entry.path === 'package-lock.json') continue
    assert.deepEqual(getCurrent(entry.path), getHistorical(entry.path), `0.2.0 protected byte changed: ${entry.path}`)
  }

  const packageJson = parseJson(getCurrent('package.json'), 'package.json')
  const packageLock = parseJson(getCurrent('package-lock.json'), 'package-lock.json')
  assert.equal(packageJson.version, CANDIDATE_VERSION)
  assert.equal(packageLock.version, CANDIDATE_VERSION)
  assert.equal(packageLock.packages[''].version, CANDIDATE_VERSION)
  assert.equal(stage.package.candidate_version, packageJson.version)

  return { baseline, stage }
}

export function expectedCurrentPackedPaths(baseline) {
  return new Set([
    ...baseline.packed_files.map(({ path }) => path),
    ...baseline.successor_policy.added_packed_paths,
  ])
}
