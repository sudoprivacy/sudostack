#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readCommitBlob } from './activation.mjs'
import { runNpm } from './npm-runner.mjs'
import { deepFreeze } from './support.mjs'
import { requireFullCommitSha, sha256, stableJson } from './source.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')
export const OPERATION_PATH = 'manifests/operations/0.2.1-activation-support.json'
const EXPECTED_OPERATION_IDENTITY_SHA256 = 'd78336896124d40535cc7a69d394ef8722e363adf885275986db96798c26bdcd'
const EXPECTED_OPERATION_KEYS = [
  'commit_binding',
  'consumer_evidence',
  'content_evidence',
  'effective_support',
  'lifecycle_constraints',
  'operation_version',
  'publication_scope',
  'state',
  'verification_toolchain',
]

function gitOutput(repository, args) {
  return execFileSync('git', ['-C', repository, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
  return gitOutput(repository, ['diff', '--name-only', parentRevision, revision, '--'])
    .toString('utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort()
}

function normalizeRepositoryUrl(url) {
  return url.trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')
}

function countOccurrences(text, value) {
  return text.split(value).length - 1
}

function cachedBlobReader(reader) {
  const cache = new Map()
  return (revision, path) => {
    const key = `${revision}:${path}`
    if (!cache.has(key)) cache.set(key, reader(revision, path))
    return cache.get(key)
  }
}

export function normalizedOperationIdentity(operation) {
  const normalized = structuredClone(operation)
  for (const tool of normalized.verification_toolchain ?? []) tool.sha256 = '0'.repeat(64)
  return sha256(Buffer.from(stableJson(normalized)))
}

function assertOperationIdentity(operation, operationBytes) {
  assert.deepEqual(Object.keys(operation).sort(), EXPECTED_OPERATION_KEYS)
  assert.equal(
    normalizedOperationIdentity(operation),
    EXPECTED_OPERATION_IDENTITY_SHA256,
    '0.2.1 activation/support operation changed outside verifier tool digests',
  )
  assert.equal(operation.operation_version, 1)
  assert.equal(operation.state, 'zone_id_candidate_support_admitted')
  assert.equal(operation.publication_scope, 'package_external_activation_support')
  assert.equal(operation.commit_binding, 'recorded_by_containing_commit_without_self_sha')
  assert.deepEqual(operation.verification_toolchain.map(({ path }) => path), [
    'tools/contracts/activation-0.2.1.mjs',
  ])
  assert.deepEqual(JSON.parse(operationBytes.toString('utf8')), operation)
  for (const revision of [
    operation.content_evidence.content_revision,
    operation.content_evidence.content_parent_revision,
    operation.content_evidence.integration_revision,
    ...operation.content_evidence.integration_parents,
    operation.consumer_evidence.feature_revision,
    operation.consumer_evidence.feature_parent_revision,
    operation.consumer_evidence.integration_revision,
    ...operation.consumer_evidence.integration_parents,
  ]) {
    requireFullCommitSha(revision)
  }
  for (const tool of operation.verification_toolchain) {
    assert.match(tool.sha256, /^[0-9a-f]{64}$/, `${tool.path} verifier digest`)
  }
  const text = operationBytes.toString('utf8')
  for (const forbidden of ['WORKTREE', '/Volumes/', 'created_at', 'deployed_at']) {
    assert.equal(text.includes(forbidden), false, `operation contains ${forbidden}`)
  }
}

function expectedPackedPaths(baseline) {
  return [
    ...baseline.packed_files.map(({ path }) => path),
    ...baseline.successor_policy.added_packed_paths,
  ].sort()
}

function assertContentPackage({
  operation,
  readContentBytes,
  readCurrentBytes,
  packedPaths,
  packageReceipt,
  isCurrentRegularFile,
}) {
  const evidence = operation.content_evidence
  const packageEvidence = evidence.package
  const contentRevision = requireFullCommitSha(evidence.content_revision, 'content revision')
  const readContent = (path) => readContentBytes(contentRevision, path)
  const candidateBytes = readContent(packageEvidence.candidate_manifest.path)
  const compatibilityBytes = readContent(packageEvidence.compatibility_manifest.path)
  const baselineBytes = readContent(packageEvidence.historical_baseline.path)
  const stageBytes = readContent(packageEvidence.content_stage.path)
  const packageJsonBytes = readContent(packageEvidence.package_json.path)
  const packageLockBytes = readContent(packageEvidence.package_lock.path)
  const workflowBytes = readContent(evidence.workflow.path)

  for (const [bytes, entry, label] of [
    [candidateBytes, packageEvidence.candidate_manifest, 'candidate manifest'],
    [compatibilityBytes, packageEvidence.compatibility_manifest, 'compatibility manifest'],
    [baselineBytes, packageEvidence.historical_baseline, 'historical package baseline'],
    [stageBytes, packageEvidence.content_stage, 'content stage'],
    [packageJsonBytes, packageEvidence.package_json, 'package.json'],
    [packageLockBytes, packageEvidence.package_lock, 'package-lock.json'],
    [workflowBytes, evidence.workflow, 'content workflow'],
  ]) {
    assert.equal(sha256(bytes), entry.sha256, `${label} digest at C`)
  }

  const candidate = JSON.parse(candidateBytes.toString('utf8'))
  const compatibility = JSON.parse(compatibilityBytes.toString('utf8'))
  const baseline = JSON.parse(baselineBytes.toString('utf8'))
  const stage = JSON.parse(stageBytes.toString('utf8'))
  const packageJson = JSON.parse(packageJsonBytes.toString('utf8'))
  const packageLock = JSON.parse(packageLockBytes.toString('utf8'))

  assert.equal(packageJson.name, packageEvidence.name)
  assert.equal(packageJson.version, packageEvidence.version)
  assert.equal(packageLock.version, packageEvidence.version)
  assert.equal(packageLock.packages[''].version, packageEvidence.version)
  assert.equal(candidate.package.name, packageEvidence.name)
  assert.equal(candidate.package.version, packageEvidence.version)
  assert.deepEqual(candidate.package.actual_consumers, [])
  assert.deepEqual(candidate.package.actual_producers, [])
  assert.equal(candidate.package.support_state, 'pending_moss_repin')
  assert.equal(candidate.sudostack.candidate_revision, null)
  assert.equal(candidate.sudostack.activation_state, 'pending_future_commit')
  assert.equal(candidate.lifecycle.content_stage, 'staged')
  assert.equal(candidate.lifecycle.contract_baseline, 'unfrozen')
  assert.equal(candidate.lifecycle.artifact_publication, 'candidate_unpublished')
  assert.equal(candidate.lifecycle.deployment_evidence, 'not_deployed')
  assert.equal(candidate.choreography.moss_repin_M.pins, 'content_commit_C')
  assert.equal(candidate.choreography.activation_A.evidence_scope, 'package_external')
  assert.equal(candidate.choreography.activation_A.mutates_candidate_package_bytes, false)
  assert.equal(candidate.choreography.activation_A.consumer_repin_required, false)
  assert.equal(candidate.choreography.activation_A.c03_decision, 'pending')
  assert.equal(stage.content_identity.candidate_revision, null)
  assert.equal(stage.content_identity.activation_state, 'pending_future_commit')
  assert.equal(stage.choreography.activation_A.c03_decision, 'pending')
  assert.equal(compatibility.package.candidate, packageEvidence.version)
  assert.equal(compatibility.baseline.runtime_contract, 'byte_identical')
  assert.deepEqual(compatibility.support_matrix.actual_consumers, [])
  assert.deepEqual(compatibility.support_matrix.actual_producers, [])
  assert.equal(compatibility.support_matrix.state, 'pending_moss_repin')

  const expectedPaths = expectedPackedPaths(baseline)
  assert.deepEqual([...packedPaths].sort(), expectedPaths, 'current packed path set differs from C')
  for (const path of expectedPaths) {
    assert.equal(isCurrentRegularFile(path), true, `current packed path is not a regular file: ${path}`)
    assert.deepEqual(readCurrentBytes(path), readContent(path), `current package byte differs from C: ${path}`)
  }
  const protectedPaths = new Set([
    'package-lock.json',
    packageEvidence.content_stage.path,
    packageEvidence.historical_baseline.path,
    ...baseline.protected_files.map(({ path }) => path),
    ...Object.values(candidate.toolchain)
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.path === 'string')
      .map(({ path }) => path),
  ])
  for (const path of protectedPaths) {
    assert.deepEqual(readCurrentBytes(path), readContent(path), `current protected byte differs from C: ${path}`)
  }
  for (const artifact of [...candidate.generated_artifacts, ...candidate.internal_generation_artifacts]) {
    assert.equal(sha256(readContent(artifact.path)), artifact.sha256, `C artifact digest ${artifact.path}`)
  }
  for (const entry of Object.values(candidate.toolchain)) {
    if (entry && typeof entry === 'object' && typeof entry.path === 'string') {
      assert.equal(sha256(readContent(entry.path)), entry.sha256, `C tool digest ${entry.path}`)
    }
  }
  assert.deepEqual(packageReceipt, packageEvidence.tarball, 'current package receipt differs from C')
  assert.equal(packageEvidence.package_bytes, 'unchanged_from_content_revision')
  assert.equal(packageEvidence.consumer_repin_after_activation, false)
  assert.equal(packageEvidence.dependency_spec, `github:sudoprivacy/sudostack#${contentRevision}`)
  return { candidate, baseline, expectedPaths }
}

export function verifyMossEvidenceBytes({ operation, readMossBytes }) {
  const evidence = operation.consumer_evidence
  const feature = requireFullCommitSha(evidence.feature_revision, 'Moss feature revision')
  const parent = requireFullCommitSha(evidence.feature_parent_revision, 'Moss feature parent revision')
  const integration = requireFullCommitSha(evidence.integration_revision, 'Moss integration revision')

  for (const entry of evidence.changed_paths) {
    const featureBytes = readMossBytes(feature, entry.path)
    const integrationBytes = readMossBytes(integration, entry.path)
    assert.equal(sha256(featureBytes), entry.sha256, `Moss feature digest ${entry.path}`)
    assert.equal(sha256(integrationBytes), entry.sha256, `Moss integration digest ${entry.path}`)
    assert.deepEqual(integrationBytes, featureBytes, `Moss integration differs from M: ${entry.path}`)
    assert.notDeepEqual(readMossBytes(parent, entry.path), featureBytes, `M did not change ${entry.path}`)
  }
  for (const entry of evidence.preserved_boundary_paths) {
    const parentBytes = readMossBytes(parent, entry.path)
    const featureBytes = readMossBytes(feature, entry.path)
    const integrationBytes = readMossBytes(integration, entry.path)
    assert.equal(sha256(featureBytes), entry.sha256, `Moss boundary digest ${entry.path}`)
    assert.deepEqual(featureBytes, parentBytes, `M changed preserved boundary ${entry.path}`)
    assert.deepEqual(integrationBytes, featureBytes, `integration changed boundary ${entry.path}`)
  }

  const binding = evidence.package_binding
  const packageBytes = readMossBytes(feature, binding.package_json_path)
  const lockBytes = readMossBytes(feature, binding.lockfile_path)
  const packageJson = JSON.parse(packageBytes.toString('utf8'))
  const lockText = lockBytes.toString('utf8')
  assert.equal(packageJson.dependencies[binding.name], binding.dependency_spec)
  assert.equal(binding.dependency_spec, `github:sudoprivacy/sudostack#${binding.content_revision}`)
  assert.equal(binding.content_revision, operation.content_evidence.content_revision)
  assert.equal(binding.version, operation.content_evidence.package.version)
  assert.equal(
    countOccurrences(lockText, `"${binding.name}": "${binding.dependency_spec}"`),
    1,
    'Moss lockfile exact dependency declaration',
  )
  assert.equal(
    countOccurrences(lockText, `${binding.name}@github:sudoprivacy/sudostack#${binding.content_revision.slice(0, 7)}`),
    1,
    'Moss lockfile resolved content pin',
  )
  assert.equal(lockText.includes('60bd8dda6fb2d348ec8571b9b1a4eaa535e36dc5'), false)

  const source = readMossBytes(feature, evidence.boundary.source_path).toString('utf8')
  const callerTest = readMossBytes(feature, evidence.boundary.test_path).toString('utf8')
  const packageTest = readMossBytes(feature, binding.installed_package_test_path).toString('utf8')
  assert.ok(source.includes("from '@sudo/contracts/zone-id'"), 'installed ZoneId import missing')
  assert.ok(source.includes('async start(): Promise<void>'), 'NexusManager.start boundary missing')
  assert.ok(source.includes('const clusterInit = resolveEmbeddedNexusZoneId(dataDir, this.config.zoneId)'))
  assert.ok(source.includes('const args = buildNexusArgs(this.grpcPort, dataDir, this.pluginDir, clusterInit)'))
  assert.equal(countOccurrences(source, "args.push('--cluster-init', clusterInit)"), 1)
  assert.ok(source.includes('MOSS_NEXUS_ZONE_ID is only valid for Moss-managed embedded Nexus'))
  assert.ok(callerTest.includes('await harness.manager.start()'), 'real start caller is not exercised')
  assert.ok(callerTest.includes("args.filter(arg => arg === '--cluster-init')).toHaveLength(1)"))
  assert.ok(callerTest.includes("args.slice(args.indexOf('--cluster-init'))"))
  assert.ok(callerTest.includes('expect(harness.spawnCalls, JSON.stringify(zoneId)).toHaveLength(0)'))
  assert.ok(callerTest.includes('expect(existsSync(harness.dataDir), JSON.stringify(zoneId)).toBe(false)'))
  assert.ok(callerTest.includes("mode: 'external'"), 'external-mode exclusion test missing')
  assert.ok(packageTest.includes("import.meta.resolve('@sudo/contracts/zone-id')"))
  assert.ok(packageTest.includes(`const contentSha = '${binding.content_revision}'`))
  assert.ok(packageTest.includes(`const candidateVersion = '${binding.version}'`))
  assert.ok(packageTest.includes(`const candidateManifestSha256 = '${operation.content_evidence.package.candidate_manifest.sha256}'`))
  assert.ok(packageTest.includes(`const compatibilitySha256 = '${operation.content_evidence.package.compatibility_manifest.sha256}'`))
  assert.ok(packageTest.includes(`const baselineSha256 = '${operation.content_evidence.package.historical_baseline.sha256}'`))
  assert.ok(packageTest.includes(`const tarballSha256 = '${operation.content_evidence.package.tarball.sha256}'`))
  assert.ok(packageTest.includes('expect(metadata.files).toHaveLength(43)'))
  assert.ok(packageTest.includes("support_state: 'pending_moss_repin'"))
  assert.ok(packageTest.includes('actual_consumers: []'))
  assert.ok(packageTest.includes('actual_producers: []'))

  const runner = evidence.default_runner
  assert.equal(packageJson.scripts.test, runner.package_script)
  const runnerBytes = readMossBytes(feature, runner.runner_path)
  const serverWorkflowBytes = readMossBytes(feature, runner.server_workflow_path)
  const lintWorkflowBytes = readMossBytes(feature, runner.lint_workflow_path)
  assert.equal(sha256(runnerBytes), runner.runner_sha256)
  assert.equal(sha256(serverWorkflowBytes), runner.server_workflow_sha256)
  assert.equal(sha256(lintWorkflowBytes), runner.lint_workflow_sha256)
  for (const [path, bytes] of [
    [runner.runner_path, runnerBytes],
    [runner.server_workflow_path, serverWorkflowBytes],
    [runner.lint_workflow_path, lintWorkflowBytes],
  ]) {
    assert.deepEqual(readMossBytes(parent, path), bytes, `M changed preserved runner ${path}`)
    assert.deepEqual(readMossBytes(integration, path), bytes, `integration changed runner ${path}`)
  }
  const runnerText = runnerBytes.toString('utf8')
  const serverWorkflow = serverWorkflowBytes.toString('utf8')
  const lintWorkflow = lintWorkflowBytes.toString('utf8')
  assert.ok(runnerText.includes("'contractsActivation.test.ts'"))
  assert.ok(runnerText.includes("const nodeOk = run('node:test', 'npx', ['tsx', '--test'], NODE)"))
  assert.ok(runnerText.includes('Add each to BUN, BUN_ISOLATED or NODE'))
  assert.ok(serverWorkflow.includes('name: server-tests'))
  assert.ok(serverWorkflow.includes('run: bun run test'))
  assert.ok(serverWorkflow.includes('name: build-amd64'))
  assert.ok(serverWorkflow.includes('name: publish-server-release'))
  assert.ok(serverWorkflow.includes("if: startsWith(github.ref, 'refs/tags/server-v')"))
  assert.ok(lintWorkflow.includes('pull_request:'))
  assert.ok(lintWorkflow.includes('run: npx eslint src/server'))
  assert.equal(evidence.boundary.family, 'zone_id')
  assert.equal(evidence.boundary.family_major, 1)
  assert.equal(evidence.boundary.runtime_mode, 'embedded')
  assert.equal(evidence.boundary.external_mode, 'excluded')
  return { feature, integration, verifiedPathCount: evidence.changed_paths.length + evidence.preserved_boundary_paths.length }
}

function assertDecision(operation) {
  const support = operation.effective_support
  assert.equal(support.scope, 'included_moss_zone_id_embedded_only')
  assert.equal(support.c03_resolution, 'resolved_for_included_moss_zone_id_scope')
  assert.equal(support.candidate_package_metadata, 'immutable_staged_unfrozen_empty')
  assert.equal(support.publication_scope, 'package_external_activation_support')
  assert.equal(support.actual_consumers.length, 1)
  assert.equal(support.actual_producers.length, 1)
  for (const entry of [...support.actual_consumers, ...support.actual_producers]) {
    assert.equal(entry.repository, 'sudoprivacy/moss')
    assert.equal(entry.content_revision, operation.content_evidence.content_revision)
    assert.equal(entry.integration_revision, operation.consumer_evidence.integration_revision)
    assert.equal(entry.family, 'zone_id')
    assert.equal(entry.family_major, 1)
    assert.equal(entry.support_state, 'integrated_tested_exact_candidate')
  }
  assert.deepEqual(support.families.zone_id.runtime_modes, ['embedded'])
  assert.deepEqual(support.families.zone_id.excluded_runtime_modes, ['external'])
  assert.deepEqual(support.families.resource_ref.actual_consumers, [])
  assert.deepEqual(support.families.resource_ref.actual_producers, [])
  assert.deepEqual(support.families.zone_path.actual_consumers, [])
  assert.deepEqual(support.families.zone_path.actual_producers, [])
  assert.deepEqual(operation.lifecycle_constraints, {
    adr_maturity: 'proposed',
    candidate_package_baseline: 'unfrozen_staged_metadata_unchanged',
    included_scope_admission: 'verified_package_external',
    artifact_publication: 'candidate_unpublished',
    deployment_evidence: 'not_deployed',
    resource_ref_support: 'deferred',
    zone_path_runtime_support: 'deferred',
    external_mode: 'excluded',
    assembly_entry: 'pending_live_evidence',
    g3: 'pending_mixed_version_and_rollback',
  })
}

export function verifyActivationSupportRecords({
  operation,
  operationBytes,
  readContentBytes,
  readCurrentBytes,
  packedPaths,
  packageReceipt,
  isCurrentRegularFile,
  currentToolBytes,
}) {
  assertOperationIdentity(operation, operationBytes)
  const content = assertContentPackage({
    operation,
    readContentBytes,
    readCurrentBytes,
    packedPaths,
    packageReceipt,
    isCurrentRegularFile,
  })
  assertDecision(operation)
  for (const tool of operation.verification_toolchain) {
    assert.equal(sha256(currentToolBytes(tool.path)), tool.sha256, tool.path)
  }
  return deepFreeze(structuredClone({
    verificationState: 'record_and_content_verified',
    recordedState: operation.state,
    operationSha256: sha256(operationBytes),
    contentRevision: operation.content_evidence.content_revision,
    contentIntegrationRevision: operation.content_evidence.integration_revision,
    mossFeatureRevision: operation.consumer_evidence.feature_revision,
    mossIntegrationRevision: operation.consumer_evidence.integration_revision,
    packagePathCount: content.expectedPaths.length,
    packageSha256: packageReceipt.sha256,
    c03Resolution: 'not_verified_in_this_mode',
    recordedC03Resolution: operation.effective_support.c03_resolution,
    consumerEvidenceVerified: false,
    hostedEvidenceVerified: false,
    recordedSupport: operation.effective_support,
  }))
}

function attachVerifiedExternalEvidence({
  proof,
  operation,
  mossEvidence,
  contentHostedEvidence,
}) {
  assert.equal(mossEvidence.feature, operation.consumer_evidence.feature_revision)
  assert.equal(mossEvidence.integration, operation.consumer_evidence.integration_revision)
  if (contentHostedEvidence) {
    assert.equal(contentHostedEvidence.content, operation.content_evidence.content_revision)
    assert.equal(contentHostedEvidence.integration, operation.content_evidence.integration_revision)
  }
  const hostedEvidenceVerified = Boolean(contentHostedEvidence)
  return deepFreeze(structuredClone({
    ...proof,
    verificationState: hostedEvidenceVerified
      ? 'included_scope_admission_verified'
      : 'consumer_bytes_verified_hosted_evidence_pending',
    c03Resolution: hostedEvidenceVerified
      ? operation.effective_support.c03_resolution
      : 'not_verified_in_this_mode',
    consumerEvidenceVerified: true,
    hostedEvidenceVerified,
  }))
}

function packageReceipt(repository) {
  const temporary = mkdtempSync(join(tmpdir(), 'sudo-contracts-activation-'))
  try {
    const packed = JSON.parse(runNpm([
      'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
    ], { cwd: repository }))[0]
    const tarball = readFileSync(join(temporary, basename(packed.filename)))
    return {
      paths: packed.files.map(({ path }) => path),
      receipt: {
        file_count: packed.entryCount,
        size: packed.size,
        unpacked_size: packed.unpackedSize,
        sha1: packed.shasum,
        sha256: createHash('sha256').update(tarball).digest('hex'),
        integrity: packed.integrity,
      },
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export function classifyActivationRelation({
  head,
  parent,
  contentIntegrationRevision,
  operationBytes,
  allowedRevisions = [],
}) {
  requireFullCommitSha(head, 'current SudoStack HEAD')
  requireFullCommitSha(parent, 'current SudoStack parent')
  requireFullCommitSha(contentIntegrationRevision, 'content integration revision')
  const allowed = new Set([contentIntegrationRevision, ...allowedRevisions])
  if (!allowed.has(head)) {
    assert.equal(
      operationBytes.includes(Buffer.from(head)),
      false,
      'operation must not embed its containing commit SHA',
    )
  }
  return head === contentIntegrationRevision
    ? 'content_merge_head_before_activation_commit'
    : parent === contentIntegrationRevision
      ? 'immediate_parent'
      : 'required_ancestor'
}

function verifyContentRepository(operation, repository, operationBytes) {
  const evidence = operation.content_evidence
  const actualRemote = gitOutput(repository, ['remote', 'get-url', 'origin']).toString('utf8')
  assert.equal(normalizeRepositoryUrl(actualRemote), normalizeRepositoryUrl(evidence.repository_url))
  assert.deepEqual(commitParents(repository, evidence.content_revision, 'content revision'), [
    evidence.content_parent_revision,
  ])
  assert.deepEqual(
    commitParents(repository, evidence.integration_revision, 'content integration revision'),
    evidence.integration_parents,
  )
  assert.deepEqual(changedPaths(repository, evidence.content_revision, evidence.integration_revision), [])
  gitOutput(repository, ['merge-base', '--is-ancestor', evidence.content_revision, 'HEAD'])
  gitOutput(repository, ['merge-base', '--is-ancestor', evidence.integration_revision, 'HEAD'])
  const head = gitOutput(repository, ['rev-parse', 'HEAD']).toString('utf8').trim()
  const parent = gitOutput(repository, ['rev-parse', 'HEAD^']).toString('utf8').trim()
  const relation = classifyActivationRelation({
    head,
    parent,
    contentIntegrationRevision: evidence.integration_revision,
    operationBytes,
    allowedRevisions: [
      evidence.content_revision,
      operation.consumer_evidence.feature_revision,
      operation.consumer_evidence.feature_parent_revision,
      operation.consumer_evidence.integration_revision,
    ],
  })
  return { head, relation }
}

function resolveLocalMossRepository() {
  if (process.env.SUDOSTACK_MOSS_REPOSITORY) {
    return resolve(process.env.SUDOSTACK_MOSS_REPOSITORY)
  }
  const root = process.env.SUDOSTACK_REPOS_ROOT
  assert.ok(
    root,
    'local Moss verification requires SUDOSTACK_MOSS_REPOSITORY or SUDOSTACK_REPOS_ROOT',
  )
  return join(resolve(root), 'moss')
}

function verifyLocalMoss(operation, repository) {
  const evidence = operation.consumer_evidence
  const actualRemote = gitOutput(repository, ['remote', 'get-url', 'origin']).toString('utf8')
  assert.equal(normalizeRepositoryUrl(actualRemote), normalizeRepositoryUrl(evidence.repository_url))
  assert.deepEqual(commitParents(repository, evidence.feature_revision, 'Moss feature revision'), [
    evidence.feature_parent_revision,
  ])
  assert.deepEqual(
    commitParents(repository, evidence.integration_revision, 'Moss integration revision'),
    evidence.integration_parents,
  )
  assert.deepEqual(
    changedPaths(repository, evidence.feature_parent_revision, evidence.feature_revision),
    evidence.changed_paths.map(({ path }) => path).sort(),
  )
  const readMossBytes = cachedBlobReader(
    (revision, path) => readCommitBlob(repository, revision, path),
  )
  return verifyMossEvidenceBytes({ operation, readMossBytes })
}

function ghJson(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
}

function readRemoteBlob(repository, revision, path) {
  return execFileSync('gh', [
    'api', '-H', 'Accept: application/vnd.github.raw+json',
    `repos/${repository}/contents/${path}?ref=${revision}`,
  ], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function verifyHostedCheckRecords(
  expectedChecks,
  actualChecks,
  revision,
  label = 'hosted checks',
) {
  assert.equal(actualChecks.length, expectedChecks.length, `${label} count`)
  assert.equal(new Set(expectedChecks.map(({ id }) => id)).size, expectedChecks.length, `${label} duplicate ids`)
  for (const expected of expectedChecks) {
    const actual = actualChecks.find(({ id }) => id === expected.id)
    assert.ok(actual, `${label} missing ${expected.id}`)
    assert.deepEqual({
      id: actual.id,
      name: actual.name,
      status: actual.status,
      conclusion: actual.conclusion,
      url: actual.html_url,
    }, expected, `${label} ${expected.id}`)
    assert.equal(actual.head_sha, revision, `${label} ${expected.id} revision`)
    assert.equal(actual.app?.slug, 'github-actions', `${label} ${expected.id} app`)
  }
}

function verifyHostedChecks(repository, evidence, revisions) {
  for (const [revisionKey, expectedChecks] of Object.entries(evidence.hosted_checks)) {
    const revision = revisions[revisionKey]
    const actualChecks = expectedChecks.map(({ id }) =>
      ghJson(`repos/${repository}/check-runs/${id}`),
    )
    verifyHostedCheckRecords(expectedChecks, actualChecks, revision, `${repository} ${revisionKey}`)
  }
}

export function verifyHostedRunRecord(expected, actual, label = 'hosted run') {
  assert.deepEqual({
    id: actual.id,
    event: actual.event,
    head_sha: actual.head_sha,
    status: actual.status,
    conclusion: actual.conclusion,
    workflow_id: actual.workflow_id,
    path: actual.path,
    run_attempt: actual.run_attempt,
    url: actual.html_url,
  }, expected, label)
}

function verifyHostedRuns(repository, expectedRuns) {
  for (const expected of expectedRuns) {
    const actual = ghJson(
      `repos/${repository}/actions/runs/${expected.id}/attempts/${expected.run_attempt}`,
    )
    verifyHostedRunRecord(expected, actual, `${repository} run ${expected.id}`)
  }
}

function verifyRemotePull(repository, evidence, headKey, mergeKey) {
  const number = Number(evidence.pull_request.split('/').at(-1))
  const pull = ghJson(`repos/${repository}/pulls/${number}`)
  assert.equal(pull.merged, true)
  assert.equal(pull.state, 'closed')
  assert.equal(pull.head.sha, evidence[headKey])
  assert.equal(pull.merge_commit_sha, evidence[mergeKey])
  assert.equal(`refs/heads/${pull.base.ref}`, evidence.base_ref)
  assert.equal(pull.merged_at, evidence.merged_at)
  if (evidence.changed_file_count !== undefined) {
    assert.equal(pull.changed_files, evidence.changed_file_count)
  } else {
    assert.equal(pull.changed_files, evidence.changed_paths.length)
  }
}

function verifyRemoteContent(operation) {
  const evidence = operation.content_evidence
  verifyRemotePull(evidence.repository, evidence, 'content_revision', 'integration_revision')
  const content = ghJson(`repos/${evidence.repository}/git/commits/${evidence.content_revision}`)
  const integration = ghJson(`repos/${evidence.repository}/git/commits/${evidence.integration_revision}`)
  assert.deepEqual(content.parents.map(({ sha }) => sha), [evidence.content_parent_revision])
  assert.deepEqual(integration.parents.map(({ sha }) => sha), evidence.integration_parents)
  for (const entry of [
    evidence.package.package_json,
    evidence.package.package_lock,
    evidence.package.candidate_manifest,
    evidence.package.compatibility_manifest,
    evidence.package.historical_baseline,
    evidence.package.content_stage,
    evidence.workflow,
  ]) {
    assert.equal(
      sha256(readRemoteBlob(evidence.repository, evidence.content_revision, entry.path)),
      entry.sha256,
      `remote C digest ${entry.path}`,
    )
  }
  verifyHostedChecks(evidence.repository, evidence, {
    content_revision: evidence.content_revision,
    integration_revision: evidence.integration_revision,
  })
  verifyHostedRuns(evidence.repository, evidence.hosted_runs)
  return { content: evidence.content_revision, integration: evidence.integration_revision }
}

function verifyRemoteMoss(operation) {
  const evidence = operation.consumer_evidence
  verifyRemotePull(evidence.repository, evidence, 'feature_revision', 'integration_revision')
  const feature = ghJson(`repos/${evidence.repository}/git/commits/${evidence.feature_revision}`)
  const integration = ghJson(`repos/${evidence.repository}/git/commits/${evidence.integration_revision}`)
  assert.deepEqual(feature.parents.map(({ sha }) => sha), [evidence.feature_parent_revision])
  assert.deepEqual(integration.parents.map(({ sha }) => sha), evidence.integration_parents)
  const comparison = ghJson(
    `repos/${evidence.repository}/compare/${evidence.feature_parent_revision}...${evidence.feature_revision}`,
  )
  assert.deepEqual(
    comparison.files.map(({ filename }) => filename).sort(),
    evidence.changed_paths.map(({ path }) => path).sort(),
  )
  const readMossBytes = cachedBlobReader(
    (revision, path) => readRemoteBlob(evidence.repository, revision, path),
  )
  const result = verifyMossEvidenceBytes({ operation, readMossBytes })
  verifyHostedChecks(evidence.repository, evidence, {
    feature_revision: evidence.feature_revision,
    integration_revision: evidence.integration_revision,
  })
  verifyHostedRuns(evidence.repository, evidence.hosted_runs)
  return result
}

export function verifyActivationSupport({
  repository = REPO,
  operationPath = OPERATION_PATH,
  sourceMode = 'offline',
} = {}) {
  assert.ok(['offline', 'local', 'remote'].includes(sourceMode), `unsupported source mode: ${sourceMode}`)
  const operationBytes = readFileSync(join(repository, operationPath))
  const operation = JSON.parse(operationBytes.toString('utf8'))
  assertOperationIdentity(operation, operationBytes)
  const relation = verifyContentRepository(operation, repository, operationBytes)
  const packed = packageReceipt(repository)
  const baseResult = verifyActivationSupportRecords({
    operation,
    operationBytes,
    readContentBytes: (revision, path) => readCommitBlob(repository, revision, path),
    readCurrentBytes: (path) => readFileSync(join(repository, path)),
    packedPaths: packed.paths,
    packageReceipt: packed.receipt,
    isCurrentRegularFile: (path) => lstatSync(join(repository, path)).isFile(),
    currentToolBytes: (path) => readFileSync(join(repository, path)),
  })
  let mossEvidence
  let contentHostedEvidence
  if (sourceMode === 'local') {
    mossEvidence = verifyLocalMoss(operation, resolveLocalMossRepository())
  } else if (sourceMode === 'remote') {
    mossEvidence = verifyRemoteMoss(operation)
    contentHostedEvidence = verifyRemoteContent(operation)
  }
  const result = mossEvidence
    ? attachVerifiedExternalEvidence({ proof: baseResult, operation, mossEvidence, contentHostedEvidence })
    : baseResult
  return deepFreeze({ ...result, ...relation, sourceMode })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Set(process.argv.slice(2))
  const sourceMode = flags.delete('--local') ? 'local' : flags.delete('--remote') ? 'remote' : 'offline'
  if (flags.size > 0) throw new Error(`unsupported arguments: ${[...flags].join(' ')}`)
  const result = verifyActivationSupport({ sourceMode })
  console.log(
    `0.2.1 activation/support ${result.verificationState}: C ${result.contentRevision}, Moss ` +
      `${result.mossFeatureRevision}, integration ${result.mossIntegrationRevision}, ` +
      `${result.packagePathCount} package paths, ${result.sourceMode}, ${result.relation}`,
  )
}
