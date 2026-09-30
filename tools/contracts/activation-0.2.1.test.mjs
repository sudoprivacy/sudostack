import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { readCommitBlob } from './activation.mjs'
import {
  OPERATION_PATH,
  REPO,
  classifyActivationRelation,
  verifyActivationSupport,
  verifyActivationSupportRecords,
  verifyHostedCheckRecords,
  verifyHostedRunRecord,
  verifyMossEvidenceBytes,
} from './activation-0.2.1.mjs'
import { sha256 } from './source.mjs'

const operationBytes = readFileSync(join(REPO, OPERATION_PATH))
const operation = JSON.parse(operationBytes.toString('utf8'))
const contentRevision = operation.content_evidence.content_revision
const readCurrent = (path) => readFileSync(join(REPO, path))
const readContent = (revision, path) => readCommitBlob(REPO, revision, path)
const baseline = JSON.parse(
  readContent(contentRevision, operation.content_evidence.package.historical_baseline.path),
)
const packedPaths = [
  ...baseline.packed_files.map(({ path }) => path),
  ...baseline.successor_policy.added_packed_paths,
]
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

function verify(overrides = {}) {
  return verifyActivationSupportRecords({
    operation,
    operationBytes,
    readContentBytes: readContent,
    readCurrentBytes: readCurrent,
    packedPaths,
    packageReceipt: operation.content_evidence.package.tarball,
    isCurrentRegularFile: () => true,
    currentToolBytes: readCurrent,
    ...overrides,
  })
}

test('package-external A binds immutable C and exposes a deeply immutable scoped proof', () => {
  const proof = verify()
  assert.equal(proof.contentRevision, contentRevision)
  assert.equal(proof.mossFeatureRevision, operation.consumer_evidence.feature_revision)
  assert.equal(proof.mossIntegrationRevision, operation.consumer_evidence.integration_revision)
  assert.equal(proof.packagePathCount, 43)
  assert.equal(proof.c03Resolution, 'not_verified_in_this_mode')
  assert.equal(proof.recordedC03Resolution, 'resolved_for_included_moss_zone_id_scope')
  assert.equal(proof.verificationState, 'record_and_content_verified')
  assert.equal(proof.consumerEvidenceVerified, false)
  assert.equal(proof.hostedEvidenceVerified, false)
  assert.ok(Object.isFrozen(proof))
  assert.ok(Object.isFrozen(proof.recordedSupport))
  assert.ok(Object.isFrozen(proof.recordedSupport.actual_consumers))
  assert.ok(Object.isFrozen(proof.recordedSupport.actual_consumers[0]))
  const original = proof.recordedSupport.actual_consumers[0].family
  operation.effective_support.actual_consumers[0].family = 'forged-after-proof'
  assert.equal(proof.recordedSupport.actual_consumers[0].family, original)
  operation.effective_support.actual_consumers[0].family = original
})

test('public API cannot promote an offline result with proof-shaped objects', () => {
  const result = verifyActivationSupport({
    sourceMode: 'offline',
    proof: {},
    mossEvidence: {
      feature: operation.consumer_evidence.feature_revision,
      integration: operation.consumer_evidence.integration_revision,
    },
    contentHostedEvidence: {
      content: operation.content_evidence.content_revision,
      integration: operation.content_evidence.integration_revision,
    },
  })
  assert.equal(result.verificationState, 'record_and_content_verified')
  assert.equal(result.c03Resolution, 'not_verified_in_this_mode')
  assert.equal(result.consumerEvidenceVerified, false)
  assert.equal(result.hostedEvidenceVerified, false)
  assert.equal(result.packageSha256, operation.content_evidence.package.tarball.sha256)
})

test('operation revision, pin, digest, scope, lifecycle, CI, and decision mutations fail closed', () => {
  const mutations = [
    (value) => { value.content_evidence.content_revision = '0'.repeat(40) },
    (value) => { value.content_evidence.integration_revision = '0'.repeat(40) },
    (value) => { value.consumer_evidence.feature_revision = '0'.repeat(40) },
    (value) => { value.consumer_evidence.feature_parent_revision = '0'.repeat(40) },
    (value) => { value.consumer_evidence.integration_revision = '0'.repeat(40) },
    (value) => { value.consumer_evidence.package_binding.dependency_spec = 'github:sudoprivacy/sudostack#main' },
    (value) => { value.consumer_evidence.package_binding.version = '0.2.0' },
    (value) => { value.content_evidence.package.candidate_manifest.sha256 = '0'.repeat(64) },
    (value) => { value.consumer_evidence.boundary.family = 'resource_ref' },
    (value) => { value.consumer_evidence.boundary.runtime_mode = 'external' },
    (value) => { value.consumer_evidence.hosted_checks.feature_revision[0].conclusion = 'failure' },
    (value) => { value.content_evidence.hosted_checks.content_revision.pop() },
    (value) => { value.lifecycle_constraints.artifact_publication = 'released' },
    (value) => { value.lifecycle_constraints.deployment_evidence = 'deployed' },
    (value) => { value.effective_support.c03_resolution = 'resolved_globally' },
    (value) => { value.content_evidence.package.consumer_repin_after_activation = true },
    (value) => { value.activation_revision = 'f'.repeat(40) },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(operation)
    mutate(changed)
    assert.throws(
      () => verify({ operation: changed, operationBytes: jsonBytes(changed) }),
      /operation changed outside verifier tool digests|Expected values to be strictly deep-equal/,
    )
  }

  const toolMutation = structuredClone(operation)
  toolMutation.verification_toolchain[0].sha256 = '0'.repeat(64)
  assert.throws(
    () => verify({ operation: toolMutation, operationBytes: jsonBytes(toolMutation) }),
    /tools\/contracts\/activation-0\.2\.1\.mjs/,
  )
})

test('current and C package byte, path, type, and receipt mutations fail closed', () => {
  for (const changedPath of [
    'package.json',
    'compatibility/current.gen.json',
    'manifests/releases/0.2.1-candidate.gen.json',
    'contracts/zone-id/zone-id.gen.js',
    'manifests/candidates/0.2.1-content.json',
    'manifests/operations/consumer-support.json',
  ]) {
    assert.throws(
      () => verify({
        readCurrentBytes: (path) => path === changedPath
          ? Buffer.concat([readCurrent(path), Buffer.from(' ')])
          : readCurrent(path),
      }),
      /current package byte differs from C|current protected byte differs from C/,
      changedPath,
    )
  }

  assert.throws(
    () => verify({
      readContentBytes: (revision, path) => path === operation.content_evidence.package.candidate_manifest.path
        ? Buffer.concat([readContent(revision, path), Buffer.from(' ')])
        : readContent(revision, path),
    }),
    /candidate manifest digest at C/,
  )
  assert.throws(() => verify({ packedPaths: packedPaths.slice(1) }), /packed path set differs from C/)
  assert.throws(() => verify({ packedPaths: [...packedPaths, 'unexpected.txt'] }), /packed path set differs from C/)
  assert.throws(
    () => verify({ packageReceipt: { ...operation.content_evidence.package.tarball, sha256: '0'.repeat(64) } }),
    /current package receipt differs from C/,
  )
  assert.throws(
    () => verify({ isCurrentRegularFile: (path) => path !== 'package.json' }),
    /not a regular file: package.json/,
  )
})

function syntheticMossEvidence() {
  const value = structuredClone(operation)
  const evidence = value.consumer_evidence
  const parent = evidence.feature_parent_revision
  const feature = evidence.feature_revision
  const integration = evidence.integration_revision
  const content = evidence.package_binding.content_revision
  const dependency = evidence.package_binding.dependency_spec
  const packageJson = Buffer.from(JSON.stringify({
    scripts: { test: evidence.default_runner.package_script },
    dependencies: { '@sudo/contracts': dependency },
  }))
  const lock = Buffer.from(
    `"@sudo/contracts": "${dependency}"\n` +
    `@sudo/contracts@github:sudoprivacy/sudostack#${content.slice(0, 7)}\n`,
  )
  const packageTest = Buffer.from([
    "import.meta.resolve('@sudo/contracts/zone-id')",
    `const contentSha = '${content}'`,
    `const candidateVersion = '${evidence.package_binding.version}'`,
    `const candidateManifestSha256 = '${value.content_evidence.package.candidate_manifest.sha256}'`,
    `const compatibilitySha256 = '${value.content_evidence.package.compatibility_manifest.sha256}'`,
    `const baselineSha256 = '${value.content_evidence.package.historical_baseline.sha256}'`,
    `const tarballSha256 = '${value.content_evidence.package.tarball.sha256}'`,
    'expect(metadata.files).toHaveLength(43)',
    "support_state: 'pending_moss_repin'",
    'actual_consumers: []',
    'actual_producers: []',
  ].join('\n'))
  const source = Buffer.from([
    "from '@sudo/contracts/zone-id'",
    'async start(): Promise<void>',
    'const clusterInit = resolveEmbeddedNexusZoneId(dataDir, this.config.zoneId)',
    'const args = buildNexusArgs(this.grpcPort, dataDir, this.pluginDir, clusterInit)',
    "args.push('--cluster-init', clusterInit)",
    'MOSS_NEXUS_ZONE_ID is only valid for Moss-managed embedded Nexus',
  ].join('\n'))
  const caller = Buffer.from([
    'await harness.manager.start()',
    "args.filter(arg => arg === '--cluster-init')).toHaveLength(1)",
    "args.slice(args.indexOf('--cluster-init'))",
    'expect(harness.spawnCalls, JSON.stringify(zoneId)).toHaveLength(0)',
    'expect(existsSync(harness.dataDir), JSON.stringify(zoneId)).toBe(false)',
    "mode: 'external'",
  ].join('\n'))
  const runner = Buffer.from([
    "'contractsActivation.test.ts'",
    "const nodeOk = run('node:test', 'npx', ['tsx', '--test'], NODE)",
    'Add each to BUN, BUN_ISOLATED or NODE',
  ].join('\n'))
  const serverWorkflow = Buffer.from([
    'name: server-tests',
    'run: bun run test',
    'name: build-amd64',
    'name: publish-server-release',
    "if: startsWith(github.ref, 'refs/tags/server-v')",
  ].join('\n'))
  const lintWorkflow = Buffer.from('pull_request:\nrun: npx eslint src/server\n')
  const featureBytes = new Map([
    [evidence.package_binding.package_json_path, packageJson],
    [evidence.package_binding.lockfile_path, lock],
    [evidence.package_binding.installed_package_test_path, packageTest],
    [evidence.boundary.source_path, source],
    [evidence.boundary.test_path, caller],
    [evidence.default_runner.runner_path, runner],
    [evidence.default_runner.server_workflow_path, serverWorkflow],
    [evidence.default_runner.lint_workflow_path, lintWorkflow],
  ])
  for (const entry of evidence.changed_paths) entry.sha256 = sha256(featureBytes.get(entry.path))
  for (const entry of evidence.preserved_boundary_paths) entry.sha256 = sha256(featureBytes.get(entry.path))
  evidence.default_runner.runner_sha256 = sha256(runner)
  evidence.default_runner.server_workflow_sha256 = sha256(serverWorkflow)
  evidence.default_runner.lint_workflow_sha256 = sha256(lintWorkflow)
  const bytes = new Map()
  for (const [path, data] of featureBytes) {
    bytes.set(`${feature}:${path}`, data)
    bytes.set(`${integration}:${path}`, data)
    bytes.set(`${parent}:${path}`, evidence.changed_paths.some((entry) => entry.path === path)
      ? Buffer.from(`old:${path}`)
      : data)
  }
  return { operation: value, bytes, parent, feature, integration }
}

test('Moss byte evidence proves the exact pin, real caller, default runner, and exclusions', () => {
  const fixture = syntheticMossEvidence()
  const readMossBytes = (revision, path) => fixture.bytes.get(`${revision}:${path}`)
  const proof = verifyMossEvidenceBytes({ operation: fixture.operation, readMossBytes })
  assert.equal(proof.feature, fixture.feature)
  assert.equal(proof.integration, fixture.integration)
  assert.equal(proof.verifiedPathCount, 5)

  const mutations = [
    ({ operation: value }) => { value.consumer_evidence.package_binding.dependency_spec = 'github:sudoprivacy/sudostack#main' },
    ({ operation: value }) => { value.consumer_evidence.boundary.runtime_mode = 'external' },
    (value) => {
      const path = value.operation.consumer_evidence.boundary.source_path
      const changed = Buffer.from('async start(): Promise<void>')
      value.operation.consumer_evidence.preserved_boundary_paths.find((entry) => entry.path === path).sha256 = sha256(changed)
      for (const revision of [value.parent, value.feature, value.integration]) value.bytes.set(`${revision}:${path}`, changed)
    },
    (value) => {
      const path = value.operation.consumer_evidence.default_runner.runner_path
      const changed = Buffer.from('runner without activation suite')
      value.operation.consumer_evidence.default_runner.runner_sha256 = sha256(changed)
      for (const revision of [value.parent, value.feature, value.integration]) value.bytes.set(`${revision}:${path}`, changed)
    },
    (value) => {
      const path = value.operation.consumer_evidence.package_binding.package_json_path
      value.bytes.set(`${value.integration}:${path}`, Buffer.from('different integration bytes'))
    },
  ]
  for (const mutate of mutations) {
    const changed = syntheticMossEvidence()
    mutate(changed)
    assert.throws(
      () => verifyMossEvidenceBytes({
        operation: changed.operation,
        readMossBytes: (revision, path) => changed.bytes.get(`${revision}:${path}`),
      }),
    )
  }
})

test('hosted check and workflow-run evidence rejects missing, failed, or misattributed results', () => {
  const expectedChecks = operation.consumer_evidence.hosted_checks.feature_revision
  const revision = operation.consumer_evidence.feature_revision
  const actualChecks = expectedChecks.map((entry) => ({
    id: entry.id,
    name: entry.name,
    status: entry.status,
    conclusion: entry.conclusion,
    html_url: entry.url,
    head_sha: revision,
    app: { slug: 'github-actions' },
  }))
  assert.doesNotThrow(() => verifyHostedCheckRecords(expectedChecks, actualChecks, revision))
  assert.throws(() => verifyHostedCheckRecords(expectedChecks, actualChecks.slice(1), revision))
  const failed = structuredClone(actualChecks)
  failed[0].conclusion = 'failure'
  assert.throws(() => verifyHostedCheckRecords(expectedChecks, failed, revision))
  const wrongRevision = structuredClone(actualChecks)
  wrongRevision[0].head_sha = '0'.repeat(40)
  assert.throws(() => verifyHostedCheckRecords(expectedChecks, wrongRevision, revision))
  const wrongRevisionRun = {
    ...operation.consumer_evidence.hosted_runs[0],
    head_sha: '0'.repeat(40),
    html_url: operation.consumer_evidence.hosted_runs[0].url,
  }
  assert.throws(() => verifyHostedRunRecord(operation.consumer_evidence.hosted_runs[0], wrongRevisionRun))
})

test('pre-A, containing-A, and descendant relations terminate without self-reference', () => {
  const contentMerge = operation.content_evidence.integration_revision
  const contentParent = operation.content_evidence.content_parent_revision
  assert.equal(classifyActivationRelation({
    head: contentMerge,
    parent: contentParent,
    contentIntegrationRevision: contentMerge,
    operationBytes,
  }), 'content_merge_head_before_activation_commit')

  const activation = 'a'.repeat(40)
  assert.equal(classifyActivationRelation({
    head: activation,
    parent: contentMerge,
    contentIntegrationRevision: contentMerge,
    operationBytes,
  }), 'immediate_parent')
  const descendant = 'b'.repeat(40)
  assert.equal(classifyActivationRelation({
    head: descendant,
    parent: activation,
    contentIntegrationRevision: contentMerge,
    operationBytes,
  }), 'required_ancestor')
  assert.throws(() => classifyActivationRelation({
    head: activation,
    parent: contentMerge,
    contentIntegrationRevision: contentMerge,
    operationBytes: Buffer.concat([operationBytes, Buffer.from(activation)]),
  }), /must not embed its containing commit SHA/)
})

test('unsupported verification modes fail before package or network work', () => {
  assert.throws(() => verifyActivationSupport({ sourceMode: 'fallback' }), /unsupported source mode/)
})
