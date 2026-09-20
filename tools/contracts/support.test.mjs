import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  CANDIDATE_MANIFEST_PATH,
  COMPATIBILITY_MANIFEST_PATH,
  OPERATION_PATH,
  REPO,
  assertMossBoundarySemantics,
  verifyConsumerSupport,
  verifyConsumerSupportRecords,
} from './support.mjs'

const operationBytes = readFileSync(join(REPO, OPERATION_PATH))
const operation = JSON.parse(operationBytes.toString('utf8'))
const baselineRevision = operation.previous.baseline_revision
const readBaseline = (path, revision = baselineRevision) =>
  execFileSync('git', ['-C', REPO, 'show', `${revision}:${path}`], {
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const baselineCandidateManifestBytes = readBaseline(CANDIDATE_MANIFEST_PATH)
const baselineCompatibilityManifestBytes = readBaseline(COMPATIBILITY_MANIFEST_PATH)
const currentCandidateManifestBytes = readFileSync(join(REPO, CANDIDATE_MANIFEST_PATH))
const currentCompatibilityManifestBytes = readFileSync(join(REPO, COMPATIBILITY_MANIFEST_PATH))
const currentToolBytes = (path) => readFileSync(join(REPO, path))
const currentBytes = (path) => readFileSync(join(REPO, path))

const verify = (overrides = {}) =>
  verifyConsumerSupportRecords({
    operation,
    operationBytes,
    baselineCandidateManifestBytes,
    baselineCompatibilityManifestBytes,
    currentCandidateManifestBytes,
    currentCompatibilityManifestBytes,
    currentToolBytes,
    currentBytes,
    baselineBytes: readBaseline,
    ...overrides,
  })

function mutateOperation(change) {
  const changed = structuredClone(operation)
  change(changed)
  return changed
}

test('consumer evidence is standalone and package-included support metadata stays unchanged', () => {
  const proof = verifyConsumerSupport({ repository: REPO })
  assert.equal(proof.baselineRevision, baselineRevision)
  assert.equal(proof.candidateRevision, operation.candidate_content_revision)
  assert.equal(proof.supportEvidence.publication_scope, 'standalone_operation_only')
  assert.equal(proof.supportEvidence.families.zone_id.support_state, 'integrated_tested')
  assert.equal(proof.supportEvidence.actual_consumers.length, 1)
  assert.equal(proof.supportEvidence.actual_producers.length, 1)
  assert.deepEqual(proof.packageSupportState.actualConsumers, [])
  assert.deepEqual(proof.packageSupportState.actualProducers, [])
  assert.equal(proof.packageSupportState.embedding, 'activation_era_empty')
  assert.deepEqual(currentCandidateManifestBytes, baselineCandidateManifestBytes)
  assert.deepEqual(currentCompatibilityManifestBytes, baselineCompatibilityManifestBytes)
})

test('verified evidence is recursively immutable', () => {
  const proof = verify()
  assert.ok(Object.isFrozen(proof))
  assert.ok(Object.isFrozen(proof.supportEvidence))
  assert.ok(Object.isFrozen(proof.supportEvidence.actual_consumers))
  assert.ok(Object.isFrozen(proof.supportEvidence.actual_consumers[0]))
  assert.ok(Object.isFrozen(proof.packageSupportState))
  assert.ok(Object.isFrozen(proof.packageSupportState.actualConsumers))
  assert.throws(
    () => { proof.supportEvidence.actual_consumers[0].family = 'resource_ref' },
    TypeError,
  )
  assert.equal(proof.supportEvidence.actual_consumers[0].family, 'zone_id')
})

test('operation revision, path, digest, pin, family, boundary, CI, and lifecycle mutations fail closed', () => {
  const mutations = [
    ['symbolic revision', (value) => { value.consumer_evidence.feature_revision = 'dev' }],
    ['integration revision', (value) => { value.consumer_evidence.integration_revision = '0'.repeat(40) }],
    ['repository URL', (value) => { value.consumer_evidence.repository_url = 'git@github.com:sudoprivacy/moss.git' }],
    ['boundary path', (value) => { value.consumer_evidence.boundary.source_path = 'src/server/nexus/helper.ts' }],
    ['boundary digest', (value) => { value.consumer_evidence.changed_paths[5].sha256 = '0'.repeat(64) }],
    ['package pin', (value) => { value.consumer_evidence.package_binding.dependency_spec = 'github:sudoprivacy/sudostack#main' }],
    ['family', (value) => { value.consumer_evidence.boundary.family = 'resource_ref' }],
    ['boundary mode', (value) => { value.consumer_evidence.boundary.runtime_mode = 'external' }],
    ['CI conclusion', (value) => { value.consumer_evidence.hosted_checks.feature_revision[0].conclusion = 'failure' }],
    ['release lifecycle', (value) => { value.lifecycle_constraints.artifact_publication = 'released' }],
    ['deployment lifecycle', (value) => { value.lifecycle_constraints.deployment_evidence = 'deployed' }],
    ['ResourceRef support', (value) => { value.current.support_matrix.families.resource_ref.support_state = 'integrated_tested' }],
    ['package embedding', (value) => { value.lifecycle_constraints.candidate_package_support_metadata = 'embedded' }],
    ['arbitrary pointer', (value) => { value.unreviewed = true }],
  ]
  for (const [label, change] of mutations) {
    assert.throws(
      () => verify({ operation: mutateOperation(change) }),
      /operation changed outside verifier tool digests|Expected values to be strictly deep-equal/,
      label,
    )
  }

  const toolDigest = mutateOperation((value) => {
    value.verification_toolchain[0].sha256 = '0'.repeat(64)
  })
  assert.throws(() => verify({ operation: toolDigest }), /tools\/contracts\/support\.mjs/)
})

test('candidate, compatibility, package, runtime, and arbitrary byte mutations fail closed', () => {
  const changedCandidate = JSON.parse(currentCandidateManifestBytes.toString('utf8'))
  changedCandidate.package.actual_consumers.push('forged')
  assert.throws(
    () => verify({
      currentCandidateManifestBytes: Buffer.from(`${JSON.stringify(changedCandidate, null, 2)}\n`),
    }),
    /packaged candidate manifest changed/,
  )

  const changedCompatibility = JSON.parse(currentCompatibilityManifestBytes.toString('utf8'))
  changedCompatibility.support_matrix.actual_consumers.push('forged')
  assert.throws(
    () => verify({
      currentCompatibilityManifestBytes: Buffer.from(`${JSON.stringify(changedCompatibility, null, 2)}\n`),
    }),
    /packaged compatibility manifest changed/,
  )

  for (const changedPath of ['package.json', 'contracts/zone-id/zone-id.gen.js']) {
    assert.throws(
      () => verify({
        currentBytes: (path) =>
          path === changedPath
            ? Buffer.concat([currentBytes(path), Buffer.from(' ')])
            : currentBytes(path),
      }),
      /changed during support operation/,
      changedPath,
    )
  }
})

test('boundary semantics reject helper-only, absent caller, external-only, and missing installed package evidence', () => {
  const binding = operation.consumer_evidence.package_binding
  const boundary = operation.consumer_evidence.boundary
  const source = [
    "import { validateZoneId } from '@sudo/contracts/zone-id'",
    'async start(): Promise<void>',
    'await this.startEmbedded(dataDir)',
    'const clusterInit = resolveEmbeddedNexusZoneId(dataDir, this.config.zoneId)',
    'const args = buildNexusArgs(this.grpcPort, dataDir, this.pluginDir, clusterInit)',
    "args.push('--cluster-init', clusterInit)",
    'MOSS_NEXUS_ZONE_ID is only valid for Moss-managed embedded Nexus',
  ].join('\n')
  const callerTest = [
    'await harness.manager.start()',
    "args.filter(arg => arg === '--cluster-init')).toHaveLength(1)",
    "args.slice(args.indexOf('--cluster-init'))",
    "mode: 'external'",
  ].join('\n')
  const packageTest = [
    "import.meta.resolve('@sudo/contracts/zone-id')",
    `const activationSha = '${binding.activation_revision}'`,
    `version: '${binding.version}'`,
  ].join('\n')
  const verifySemantics = (overrides = {}) =>
    assertMossBoundarySemantics({ binding, boundary, source, callerTest, packageTest, ...overrides })

  assert.doesNotThrow(() => verifySemantics())
  assert.throws(
    () => verifySemantics({ source: source.replace('await this.startEmbedded(dataDir)', '') }),
    /embedded start caller missing/,
  )
  assert.throws(
    () => verifySemantics({
      source: source.replace(
        'const args = buildNexusArgs(this.grpcPort, dataDir, this.pluginDir, clusterInit)',
        'const args = buildNexusArgs(this.grpcPort, dataDir, this.pluginDir)',
      ),
    }),
    /does not forward the bound ZoneId/,
  )
  assert.throws(
    () => verifySemantics({ callerTest: callerTest.replace('await harness.manager.start()', '') }),
    /real start caller is not exercised/,
  )
  assert.throws(
    () => verifySemantics({ callerTest: callerTest.replace("mode: 'external'", '') }),
    /external-mode exclusion test missing/,
  )
  assert.throws(
    () => verifySemantics({ packageTest: '' }),
    /installed package resolution test missing/,
  )
})

test('B0 template keeps C-03 active, resolves C-04, and preserves live blockers', () => {
  const templatePath = join(REPO, 'manifests/inventory/b0-customer-demo-baseline.template.json')
  const template = JSON.parse(readFileSync(templatePath, 'utf8'))
  assert.equal(
    template.source_cut.consumer_support_operation.sha256,
    createHash('sha256').update(operationBytes).digest('hex'),
  )
  assert.equal(
    template.source_cut.candidate_release_manifest.observed_manifest_digest.value,
    createHash('sha256').update(currentCandidateManifestBytes).digest('hex'),
  )
  assert.deepEqual(template.known_conflicts.map((entry) => entry.id), ['C-03'])
  assert.deepEqual(
    template.resolved_conflict_history.map((entry) => entry.id),
    ['C-01', 'C-02', 'C-04'],
  )
  assert.equal(template.required_live_inputs.length, 13)
  assert.ok(template.required_live_inputs.every((entry) => entry.evidence_status === 'Unknown'))
  assert.equal(
    template.contract_scope.deferred.find((entry) => entry.contract_family === 'ResourceRef').state,
    'deferred_no_current_production_provider_or_consumer',
  )
  assert.equal(
    template.contract_scope.deferred.find((entry) => entry.contract_family === 'ZonePath').state,
    'owner_source_dependency_only_for_deferred_resource_ref',
  )
  assert.equal(template.contract_scope.confirmed_production_consumers.length, 1)
  assert.equal(
    template.contract_scope.confirmed_production_consumers[0].integration_revision,
    operation.consumer_evidence.integration_revision,
  )

  let confirmedDeploymentCount = 0
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence_status' && child === 'Confirmed-Deployment') {
        confirmedDeploymentCount += 1
      }
      visit(child)
    }
  }
  visit(template)
  assert.equal(confirmedDeploymentCount, 0)

  const verifyLocalRefs = (value) => {
    if (Array.isArray(value)) {
      value.forEach(verifyLocalRefs)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence_refs' && Array.isArray(child)) {
        for (const reference of child) {
          if (reference.startsWith('.') && !reference.includes('#/')) {
            const path = reference.split('#', 1)[0]
            assert.ok(existsSync(resolve(dirname(templatePath), path)), `missing evidence ref ${reference}`)
          }
        }
      }
      verifyLocalRefs(child)
    }
  }
  verifyLocalRefs(template)

  const documentation = readFileSync(
    join(REPO, 'docs/inventory/b0-customer-demo-baseline.md'),
    'utf8',
  )
  assert.ok(documentation.includes('C-03 remains assembly-blocking'))
  assert.ok(documentation.includes('C-04 is resolved'))
  assert.ok(documentation.includes('13 Unknown live inputs'))
  assert.ok(documentation.includes('Confirmed deployment records | **0**'))
  for (const [, reference] of documentation.matchAll(/\]\(([^)]+)\)/g)) {
    if (reference.startsWith('http') || reference.startsWith('#')) continue
    const path = reference.split('#', 1)[0]
    assert.ok(existsSync(resolve(REPO, 'docs/inventory', path)), `missing Markdown link ${reference}`)
  }
})
