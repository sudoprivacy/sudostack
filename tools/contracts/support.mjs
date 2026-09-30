import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { requireFullCommitSha, sha256, stableJson } from './source.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')
export const OPERATION_PATH = 'manifests/operations/consumer-support.json'
export const CANDIDATE_MANIFEST_PATH = 'manifests/releases/0.2.0-candidate.gen.json'
export const COMPATIBILITY_MANIFEST_PATH = 'compatibility/current.gen.json'

const EXPECTED_OPERATION_IDENTITY_SHA256 = '7256979b05e5d474ea4b8a3ef39aeb88160f682173c64e096a5f5aa2611ddb12'
const EXPECTED_OPERATION_KEYS = [
  'activation_revision',
  'candidate_content_revision',
  'consumer_evidence',
  'current',
  'freeze_evidence',
  'lifecycle_constraints',
  'operation_version',
  'previous',
  'source_availability_revision',
  'state',
  'verification_toolchain',
]
const IMMUTABLE_CURRENT_PATHS = [
  'README.md',
  'contracts/sources.lock.json',
  'manifests/activations/0.2.0-candidate.json',
  'manifests/operations/source-availability.json',
  'manifests/source-closure.gen.json',
  'package-lock.json',
  'package.json',
]

function gitOutput(repository, args) {
  return execFileSync('git', ['-C', repository, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function readCommitBlob(repository, revision, path, label = 'revision') {
  requireFullCommitSha(revision, label)
  try {
    gitOutput(repository, ['cat-file', '-e', `${revision}^{commit}`])
    return gitOutput(repository, ['show', `${revision}:${path}`])
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim() || error.message
    throw new Error(`cannot read ${label} ${revision}:${path}: ${detail}`)
  }
}

function commitParents(repository, revision, label) {
  requireFullCommitSha(revision, label)
  return gitOutput(repository, ['cat-file', '-p', revision])
    .toString('utf8')
    .split('\n')
    .filter((line) => line.startsWith('parent '))
    .map((line) => line.slice('parent '.length))
}

function changedPaths(repository, parentRevision, revision) {
  return gitOutput(repository, [
    'diff',
    '--name-only',
    parentRevision,
    revision,
    '--',
  ])
    .toString('utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort()
}

function countOccurrences(text, value) {
  return text.split(value).length - 1
}

function normalizedOperationIdentity(operation) {
  const normalized = structuredClone(operation)
  for (const tool of normalized.verification_toolchain ?? []) {
    tool.sha256 = '0'.repeat(64)
  }
  return sha256(Buffer.from(stableJson(normalized)))
}

function assertOperationIdentity(operation) {
  assert.deepEqual(Object.keys(operation).sort(), EXPECTED_OPERATION_KEYS)
  assert.equal(
    normalizedOperationIdentity(operation),
    EXPECTED_OPERATION_IDENTITY_SHA256,
    'consumer-support operation changed outside verifier tool digests',
  )
  assert.equal(operation.operation_version, 1)
  assert.equal(operation.state, 'zone_id_consumer_integration_verified')
  requireFullCommitSha(operation.candidate_content_revision, 'candidate content revision')
  requireFullCommitSha(operation.activation_revision, 'activation revision')
  requireFullCommitSha(operation.source_availability_revision, 'source availability revision')
  requireFullCommitSha(operation.previous.baseline_revision, 'support baseline revision')
  assert.deepEqual(operation.verification_toolchain.map((tool) => tool.path), [
    'tools/contracts/support.mjs',
  ])
  for (const tool of operation.verification_toolchain) {
    assert.match(tool.sha256, /^[0-9a-f]{64}$/, `${tool.path} verifier digest`)
  }
}

function assertLifecycle(operation, candidateManifest, compatibilityManifest) {
  const expected = operation.lifecycle_constraints
  for (const key of [
    'adr_maturity',
    'contract_baseline',
    'artifact_publication',
    'deployment_evidence',
  ]) {
    assert.equal(candidateManifest.lifecycle[key], expected[key], key)
  }
  assert.equal(expected.candidate_package_support_metadata, 'activation_era_empty')
  assert.equal(expected.resource_ref_support, 'deferred')
  assert.equal(expected.zone_path_runtime_support, 'deferred')
  assert.deepEqual(candidateManifest.package.actual_consumers, [])
  assert.deepEqual(candidateManifest.package.actual_producers, [])
  assert.deepEqual(compatibilityManifest.support_matrix.actual_consumers, [])
  assert.deepEqual(compatibilityManifest.support_matrix.actual_producers, [])

  const support = operation.current.support_matrix
  assert.equal(support.publication_scope, 'standalone_operation_only')
  assert.equal(support.families.zone_id.support_state, 'integrated_tested')
  assert.deepEqual(support.families.zone_id.runtime_modes, ['embedded'])
  assert.deepEqual(support.families.zone_id.excluded_runtime_modes, ['external'])
  assert.deepEqual(support.families.resource_ref.actual_consumers, [])
  assert.deepEqual(support.families.resource_ref.actual_producers, [])
  assert.deepEqual(support.families.zone_path.actual_consumers, [])
  assert.deepEqual(support.families.zone_path.actual_producers, [])
  for (const entry of [...support.actual_consumers, ...support.actual_producers]) {
    assert.equal(entry.family, 'zone_id')
    assert.equal(entry.family_major, 1)
    assert.equal(entry.support_state, 'integrated_tested')
    assert.equal(entry.artifact_publication, 'candidate_unpublished')
    assert.equal(entry.deployment_evidence, 'not_deployed')
  }
}

function assertFreezeEvidence(operation, candidateManifest) {
  const freeze = operation.freeze_evidence
  assert.equal(freeze.family, 'zone_id')
  assert.equal(freeze.owner_revision, candidateManifest.owners['nexus-vfs'].revision)
  assert.equal(
    freeze.owner_spec_path,
    candidateManifest.owners['nexus-vfs'].files.zone_id_spec.path,
  )
  assert.equal(
    freeze.owner_spec_sha256,
    candidateManifest.owners['nexus-vfs'].files.zone_id_spec.sha256,
  )
  assert.equal(freeze.fixture_count, candidateManifest.fixtures.zone_id)
  assert.ok(freeze.fixture_count > 0, 'ZoneId fixtures must be non-empty')
  assert.equal(freeze.fixture_index_sha256, candidateManifest.fixtures.aggregate_index_sha256)
  assert.equal(freeze.reference_closure, 'closed')
  assert.equal(freeze.compatibility_result, candidateManifest.compatibility.zone_id)
  assert.equal(freeze.consumer_boundary, 'production')
  assert.equal(freeze.consumer_default_ci, 'passed')
  assert.equal(freeze.candidate_support_embedding, 'absent_activation_era_empty')
  assert.equal(freeze.artifact_publication, candidateManifest.lifecycle.artifact_publication)
  assert.equal(freeze.deployment_evidence, candidateManifest.lifecycle.deployment_evidence)
}

export function assertMossBoundarySemantics({ binding, boundary, source, callerTest, packageTest }) {
  assert.ok(source.includes("from '@sudo/contracts/zone-id'"), 'installed ZoneId import missing')
  assert.ok(source.includes('async start(): Promise<void>'), 'NexusManager.start boundary missing')
  assert.ok(source.includes('await this.startEmbedded(dataDir)'), 'embedded start caller missing')
  assert.ok(
    source.includes('const clusterInit = resolveEmbeddedNexusZoneId(dataDir, this.config.zoneId)'),
    'immutable ZoneId binding missing from real start caller',
  )
  assert.ok(
    source.includes('const args = buildNexusArgs(this.grpcPort, dataDir, this.pluginDir, clusterInit)'),
    'real start caller does not forward the bound ZoneId',
  )
  assert.equal(
    countOccurrences(source, "args.push('--cluster-init', clusterInit)"),
    1,
    'embedded argv must append exactly one cluster-init pair',
  )
  assert.ok(
    source.includes('MOSS_NEXUS_ZONE_ID is only valid for Moss-managed embedded Nexus'),
    'external topology exclusion missing',
  )
  assert.ok(callerTest.includes('await harness.manager.start()'), 'real start caller is not exercised')
  assert.ok(
    callerTest.includes("args.filter(arg => arg === '--cluster-init')).toHaveLength(1)"),
    'cluster-init cardinality assertion missing',
  )
  assert.ok(
    callerTest.includes("args.slice(args.indexOf('--cluster-init'))"),
    'cluster-init value assertion missing',
  )
  assert.ok(callerTest.includes("mode: 'external'"), 'external-mode exclusion test missing')
  assert.ok(
    packageTest.includes("import.meta.resolve('@sudo/contracts/zone-id')"),
    'installed package resolution test missing',
  )
  assert.ok(
    packageTest.includes(`const activationSha = '${binding.activation_revision}'`),
    'activation pin test missing',
  )
  assert.ok(
    packageTest.includes(`version: '${binding.version}'`),
    'installed package version test missing',
  )
  assert.equal(boundary.family, 'zone_id')
  assert.equal(boundary.runtime_mode, 'embedded')
  assert.equal(boundary.external_mode, 'excluded')
}

export function verifyMossBoundaryBytes({ operation, readMossBytes }) {
  const evidence = operation.consumer_evidence
  const featureRevision = requireFullCommitSha(evidence.feature_revision, 'Moss feature revision')
  const integrationRevision = requireFullCommitSha(
    evidence.integration_revision,
    'Moss integration revision',
  )
  for (const file of evidence.changed_paths) {
    const featureBytes = readMossBytes(featureRevision, file.path)
    const integrationBytes = readMossBytes(integrationRevision, file.path)
    assert.equal(sha256(featureBytes), file.sha256, `Moss feature digest ${file.path}`)
    assert.equal(sha256(integrationBytes), file.sha256, `Moss integration digest ${file.path}`)
    assert.deepEqual(integrationBytes, featureBytes, `Moss merged bytes differ for ${file.path}`)
  }

  const binding = evidence.package_binding
  const consumerPackageBytes = readMossBytes(integrationRevision, binding.package_json.path)
  const consumerLockBytes = readMossBytes(integrationRevision, binding.lockfile.path)
  assert.equal(sha256(consumerPackageBytes), binding.package_json.sha256, 'Moss package.json digest')
  assert.equal(sha256(consumerLockBytes), binding.lockfile.sha256, 'Moss lockfile digest')
  const consumerPackage = JSON.parse(consumerPackageBytes.toString('utf8'))
  assert.equal(consumerPackage.dependencies[binding.name], binding.dependency_spec)
  const lockText = consumerLockBytes.toString('utf8')
  assert.ok(
    lockText.includes(`"${binding.name}": "${binding.dependency_spec}"`),
    'exact dependency pin missing from lockfile',
  )
  assert.ok(
    lockText.includes(
      `${binding.name}@github:sudoprivacy/sudostack#${binding.activation_revision.slice(0, 7)}`,
    ),
    'resolved activation pin missing from lockfile',
  )

  const boundary = evidence.boundary
  assertMossBoundarySemantics({
    binding,
    boundary,
    source: readMossBytes(integrationRevision, boundary.source_path).toString('utf8'),
    callerTest: readMossBytes(integrationRevision, boundary.test_path).toString('utf8'),
    packageTest: readMossBytes(
      integrationRevision,
      boundary.installed_package_test_path,
    ).toString('utf8'),
  })
  return { featureRevision, integrationRevision, verifiedPathCount: evidence.changed_paths.length }
}

function verifyMossRepository(operation, repository) {
  const evidence = operation.consumer_evidence
  const featureRevision = requireFullCommitSha(evidence.feature_revision, 'Moss feature revision')
  const integrationRevision = requireFullCommitSha(
    evidence.integration_revision,
    'Moss integration revision',
  )
  assert.deepEqual(commitParents(repository, featureRevision, 'Moss feature revision'), [
    evidence.feature_parent_revision,
  ])
  assert.deepEqual(
    commitParents(repository, integrationRevision, 'Moss integration revision'),
    evidence.integration_parents,
  )
  assert.deepEqual(
    changedPaths(repository, evidence.feature_parent_revision, featureRevision),
    evidence.changed_paths.map((entry) => entry.path).sort(),
    'Moss feature revision changed paths',
  )
  return verifyMossBoundaryBytes({
    operation,
    readMossBytes: (revision, path) => readCommitBlob(repository, revision, path, 'Moss revision'),
  })
}

function verifyHostedEvidence(operation) {
  const evidence = operation.consumer_evidence
  const pull = JSON.parse(
    execFileSync('gh', ['api', 'repos/sudoprivacy/moss/pulls/276'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  assert.equal(pull.merged, true, 'Moss PR must be merged')
  assert.equal(pull.state, 'closed', 'Moss PR state')
  assert.equal(pull.head.sha, evidence.feature_revision, 'Moss PR feature revision')
  assert.equal(pull.merge_commit_sha, evidence.integration_revision, 'Moss PR integration revision')
  assert.equal(`refs/heads/${pull.base.ref}`, evidence.base_ref, 'Moss PR base ref')
  assert.equal(pull.merged_at, evidence.merged_at, 'Moss PR merge timestamp')
  assert.equal(pull.changed_files, evidence.changed_paths.length, 'Moss PR changed-file count')

  for (const [revisionKey, expectedChecks] of Object.entries(evidence.hosted_checks)) {
    const revision = evidence[revisionKey]
    const response = JSON.parse(
      execFileSync(
        'gh',
        ['api', `repos/sudoprivacy/moss/commits/${revision}/check-runs`],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    )
    assert.equal(response.total_count, expectedChecks.length, `${revisionKey} hosted-check count`)
    assert.deepEqual(
      response.check_runs.map((check) => check.id).sort((a, b) => a - b),
      expectedChecks.map((check) => check.id).sort((a, b) => a - b),
      `${revisionKey} hosted-check identities`,
    )
    for (const expected of expectedChecks) {
      const actual = response.check_runs.find((check) => check.id === expected.id)
      assert.ok(actual, `missing hosted check ${expected.id}`)
      assert.deepEqual(
        {
          id: actual.id,
          name: actual.name,
          status: actual.status,
          conclusion: actual.conclusion,
          url: actual.html_url,
        },
        expected,
        `hosted check ${expected.id}`,
      )
    }
  }
}

function mapArtifacts(manifest) {
  return new Map(
    [...manifest.generated_artifacts, ...manifest.internal_generation_artifacts]
      .map((artifact) => [artifact.path, artifact.sha256]),
  )
}

function assertImmutableCandidateBytes({ candidateManifest, currentBytes, baselineBytes }) {
  const paths = new Set([
    ...IMMUTABLE_CURRENT_PATHS,
    ...mapArtifacts(candidateManifest).keys(),
  ])
  for (const path of paths) {
    assert.deepEqual(currentBytes(path), baselineBytes(path), `${path} changed during support operation`)
  }
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen)
  return Object.freeze(value)
}

export function verifyConsumerSupportRecords({
  operation,
  operationBytes,
  baselineCandidateManifestBytes,
  baselineCompatibilityManifestBytes,
  currentCandidateManifestBytes,
  currentCompatibilityManifestBytes,
  currentToolBytes,
  currentBytes,
  baselineBytes,
  mossEvidence,
}) {
  assertOperationIdentity(operation)
  const candidateRevision = requireFullCommitSha(
    operation.candidate_content_revision,
    'candidate content revision',
  )
  const activationRevision = requireFullCommitSha(operation.activation_revision, 'activation revision')
  const sourceAvailabilityRevision = requireFullCommitSha(
    operation.source_availability_revision,
    'source availability revision',
  )
  const baselineRevision = requireFullCommitSha(
    operation.previous.baseline_revision,
    'support baseline revision',
  )
  assert.equal(
    sha256(baselineCandidateManifestBytes),
    operation.previous.candidate_manifest.sha256,
    'baseline candidate-manifest digest',
  )
  assert.equal(
    sha256(baselineCompatibilityManifestBytes),
    operation.previous.compatibility_manifest.sha256,
    'baseline compatibility-manifest digest',
  )
  assert.deepEqual(
    currentCandidateManifestBytes,
    baselineCandidateManifestBytes,
    'packaged candidate manifest changed during standalone support operation',
  )
  assert.deepEqual(
    currentCompatibilityManifestBytes,
    baselineCompatibilityManifestBytes,
    'packaged compatibility manifest changed during standalone support operation',
  )

  const candidateManifest = JSON.parse(currentCandidateManifestBytes.toString('utf8'))
  const compatibilityManifest = JSON.parse(currentCompatibilityManifestBytes.toString('utf8'))
  assert.equal(candidateManifest.sudostack.candidate_revision, candidateRevision)
  assert.equal(
    candidateManifest.sudostack.source_availability_override.activation_revision,
    activationRevision,
  )
  assert.equal(operation.previous.candidate_manifest.path, CANDIDATE_MANIFEST_PATH)
  assert.equal(operation.previous.compatibility_manifest.path, COMPATIBILITY_MANIFEST_PATH)
  assertLifecycle(operation, candidateManifest, compatibilityManifest)
  assertFreezeEvidence(operation, candidateManifest)
  assertImmutableCandidateBytes({ candidateManifest, currentBytes, baselineBytes })

  for (const tool of operation.verification_toolchain) {
    assert.equal(sha256(currentToolBytes(tool.path)), tool.sha256, tool.path)
  }
  const packageAtActivation = JSON.parse(
    baselineBytes('package.json', activationRevision).toString('utf8'),
  )
  assert.equal(packageAtActivation.name, operation.consumer_evidence.package_binding.name)
  assert.equal(packageAtActivation.version, operation.consumer_evidence.package_binding.version)
  assert.equal(
    sha256(baselineBytes('package.json', activationRevision)),
    candidateManifest.package.package_json_sha256,
  )
  assert.equal(
    candidateManifest.package.version,
    operation.consumer_evidence.package_binding.version,
  )
  if (mossEvidence) {
    assert.equal(mossEvidence.featureRevision, operation.consumer_evidence.feature_revision)
    assert.equal(mossEvidence.integrationRevision, operation.consumer_evidence.integration_revision)
    assert.equal(mossEvidence.verifiedPathCount, operation.consumer_evidence.changed_paths.length)
  }

  return deepFreeze({
    activationRevision,
    baselineRevision,
    candidateRevision,
    sourceAvailabilityRevision,
    operationSha256: sha256(operationBytes),
    supportEvidence: structuredClone(operation.current.support_matrix),
    packageSupportState: {
      actualConsumers: structuredClone(candidateManifest.package.actual_consumers),
      actualProducers: structuredClone(candidateManifest.package.actual_producers),
      embedding: operation.lifecycle_constraints.candidate_package_support_metadata,
    },
  })
}

function relationToHead(repository, baselineRevision) {
  const head = gitOutput(repository, ['rev-parse', 'HEAD']).toString('utf8').trim()
  if (head === baselineRevision) return { head, relation: 'baseline_head_before_support_commit' }
  gitOutput(repository, ['merge-base', '--is-ancestor', baselineRevision, head])
  const parent = gitOutput(repository, ['rev-parse', 'HEAD^']).toString('utf8').trim()
  return { head, relation: parent === baselineRevision ? 'immediate_parent' : 'required_ancestor' }
}

function resolveLocalMossRepository() {
  const reposRoot = process.env.SUDOSTACK_REPOS_ROOT
  assert.ok(reposRoot, 'local Moss verification requires SUDOSTACK_REPOS_ROOT')
  return join(reposRoot, 'moss')
}

function ghJson(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
}

function readRemoteMossBlob(repository, revision, path) {
  return execFileSync(
    'gh',
    [
      'api',
      '-H',
      'Accept: application/vnd.github.raw+json',
      `repos/${repository}/contents/${path}?ref=${revision}`,
    ],
    { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

function verifyRemoteMoss(operation) {
  const evidence = operation.consumer_evidence
  assert.equal(
    evidence.repository_url,
    `https://github.com/${evidence.repository}.git`,
    'portable Moss repository URL',
  )
  const feature = ghJson(`repos/${evidence.repository}/git/commits/${evidence.feature_revision}`)
  const integration = ghJson(
    `repos/${evidence.repository}/git/commits/${evidence.integration_revision}`,
  )
  assert.deepEqual(
    feature.parents.map((parent) => parent.sha),
    [evidence.feature_parent_revision],
    'remote Moss feature parents',
  )
  assert.deepEqual(
    integration.parents.map((parent) => parent.sha),
    evidence.integration_parents,
    'remote Moss integration parents',
  )
  const comparison = ghJson(
    `repos/${evidence.repository}/compare/${evidence.feature_parent_revision}...${evidence.feature_revision}`,
  )
  assert.deepEqual(
    comparison.files.map((file) => file.filename).sort(),
    evidence.changed_paths.map((entry) => entry.path).sort(),
    'remote Moss feature changed paths',
  )
  const result = verifyMossBoundaryBytes({
    operation,
    readMossBytes: (revision, path) =>
      readRemoteMossBlob(evidence.repository, revision, path),
  })
  verifyHostedEvidence(operation)
  return result
}

export function verifyConsumerSupport({
  repository = REPO,
  operationPath = OPERATION_PATH,
  sourceMode = 'offline',
} = {}) {
  assert.ok(['offline', 'local', 'remote'].includes(sourceMode), `unsupported source mode: ${sourceMode}`)
  const operationBytes = readFileSync(join(repository, operationPath))
  const operation = JSON.parse(operationBytes.toString('utf8'))
  const baselineRevision = requireFullCommitSha(
    operation.previous.baseline_revision,
    'support baseline revision',
  )
  const readBaseline = (path, revision = baselineRevision) =>
    readCommitBlob(repository, revision, path, 'SudoStack baseline revision')
  for (const [ancestor, descendant] of [
    [operation.candidate_content_revision, operation.activation_revision],
    [operation.activation_revision, operation.source_availability_revision],
    [operation.source_availability_revision, baselineRevision],
  ]) {
    gitOutput(repository, ['merge-base', '--is-ancestor', ancestor, descendant])
  }
  assert.deepEqual(
    readBaseline(
      'manifests/operations/source-availability.json',
      operation.source_availability_revision,
    ),
    readBaseline('manifests/operations/source-availability.json'),
    'source-availability operation changed after its recorded revision',
  )
  let mossEvidence
  if (sourceMode === 'local') {
    mossEvidence = verifyMossRepository(operation, resolveLocalMossRepository())
  } else if (sourceMode === 'remote') {
    mossEvidence = verifyRemoteMoss(operation)
  }
  const result = verifyConsumerSupportRecords({
    operation,
    operationBytes,
    baselineCandidateManifestBytes: readBaseline(CANDIDATE_MANIFEST_PATH),
    baselineCompatibilityManifestBytes: readBaseline(COMPATIBILITY_MANIFEST_PATH),
    currentCandidateManifestBytes: readFileSync(join(repository, CANDIDATE_MANIFEST_PATH)),
    currentCompatibilityManifestBytes: readFileSync(join(repository, COMPATIBILITY_MANIFEST_PATH)),
    currentToolBytes: (path) => readFileSync(join(repository, path)),
    currentBytes: (path) => readFileSync(join(repository, path)),
    baselineBytes: readBaseline,
    mossEvidence,
  })
  const relation = relationToHead(repository, baselineRevision)
  if (relation.head !== baselineRevision) {
    assert.equal(
      operationBytes.includes(Buffer.from(relation.head)),
      false,
      'support metadata must not embed its containing commit SHA',
    )
  }
  return deepFreeze({ ...result, ...relation, sourceMode })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Set(process.argv.slice(2))
  const sourceMode = flags.delete('--local') ? 'local' : flags.delete('--remote') ? 'remote' : 'offline'
  if (flags.size > 0) throw new Error(`unsupported arguments: ${[...flags].join(' ')}`)
  const result = verifyConsumerSupport({ sourceMode })
  console.log(
    `consumer integration verified: ${result.candidateRevision}, Moss ` +
      `${result.supportEvidence.actual_consumers[0].integration_revision}, ${result.sourceMode}, ${result.relation}`,
  )
}
