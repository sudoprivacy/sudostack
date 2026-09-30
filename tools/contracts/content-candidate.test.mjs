import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  BASELINE_PATH,
  CANDIDATE_PATH,
  HISTORICAL_CANDIDATE_PATH,
  REPO,
  STAGE_PATH,
  createHistoricalReader,
  sha256,
  verifyCandidateContent,
  verifyPackageBaseline,
  verifyStageMetadata,
} from './content-candidate.mjs'

const read = (path) => readFileSync(join(REPO, path))
const historicalBytes = createHistoricalReader(REPO)
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

test('0.2.1 content stage is version-only and byte-identical to the immutable 0.2.0 runtime', () => {
  const { baseline, stage } = verifyCandidateContent({ repository: REPO, historicalBytes })
  assert.equal(baseline.package.version, '0.2.0')
  assert.equal(baseline.package.file_count, 42)
  assert.equal(baseline.package.size, 37901)
  assert.equal(baseline.package.sha1, '2aa7a118da0adf6b7b486f9538fe20204001dcae')
  assert.equal(baseline.package.sha256, '6f3b1bbbcc669b0b9dadd2dbdbc2c01fc5eb473a4839ddad45e0d172343073f8')
  assert.equal(stage.package.candidate_version, '0.2.1')
  assert.equal(stage.lifecycle.contract_baseline, 'unfrozen')
  assert.deepEqual(stage.support.actual_consumers, [])
  assert.deepEqual(stage.support.actual_producers, [])
})

test('runtime, schema, fixture, source, provenance, and historical record mutations fail closed', () => {
  const paths = [
    'contracts/zone-id/zone-id.gen.js',
    'contracts/common/v1/resource-ref/schema.gen.json',
    'contracts/common/v1/resource-ref/fixtures/valid/minimal.gen.json',
    'contracts/zone-id/spec.source.gen.json',
    'manifests/source-closure.gen.json',
    'contracts/sources.lock.json',
    'compatibility/baselines/0.1.0.json',
    'tools/contracts/runtime-template.mjs',
    'manifests/releases/0.2.0-candidate.gen.json',
    'manifests/activations/0.2.0-candidate.json',
    'manifests/operations/source-availability.json',
    'manifests/operations/consumer-support.json',
  ]
  for (const changedPath of paths) {
    assert.throws(
      () => verifyCandidateContent({
        repository: REPO,
        historicalBytes,
        currentBytes: (path) => path === changedPath ? Buffer.concat([read(path), Buffer.from(' ')]) : read(path),
      }),
      /immutable package byte changed|protected byte changed/,
      changedPath,
    )
  }
})

test('package and lockfile reject every change except the two 0.2.1 version fields', () => {
  const changedPackage = JSON.parse(read('package.json'))
  changedPackage.description = 'forged description'
  assert.throws(
    () => verifyCandidateContent({
      repository: REPO,
      historicalBytes,
      currentBytes: (path) => path === 'package.json' ? jsonBytes(changedPackage) : read(path),
    }),
    /package.json must differ from 0.2.0 only by its package version/,
  )

  const changedLock = JSON.parse(read('package-lock.json'))
  changedLock.packages[''].dependencies.ajv = 'latest'
  assert.throws(
    () => verifyCandidateContent({
      repository: REPO,
      historicalBytes,
      currentBytes: (path) => path === 'package-lock.json' ? jsonBytes(changedLock) : read(path),
    }),
    /package-lock.json must differ from 0.2.0 only by its two package version fields/,
  )
})

test('baseline version, package identity, and provenance forgery fail closed', () => {
  const original = JSON.parse(read(BASELINE_PATH))
  const mutations = [
    (value) => { value.source_revision = '0'.repeat(40) },
    (value) => { value.package.version = '0.2.1' },
    (value) => { value.package.sha256 = '0'.repeat(64) },
    (value) => { value.packed_files[0].sha256 = '0'.repeat(64) },
    (value) => { value.protected_files[0].purpose = 'forged' },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(original)
    mutate(changed)
    assert.throws(
      () => verifyPackageBaseline({ baselineBytes: jsonBytes(changed) }),
      /digest changed/,
    )
  }
})

test('premature support, freeze, activation, and self/future revision claims fail closed', () => {
  const original = JSON.parse(read(STAGE_PATH))
  const mutations = [
    (value) => { value.lifecycle.contract_baseline = 'draft-frozen' },
    (value) => { value.lifecycle.artifact_publication = 'released' },
    (value) => { value.lifecycle.deployment_evidence = 'deployed' },
    (value) => { value.content_identity.candidate_revision = '0'.repeat(40) },
    (value) => { value.content_identity.activation_state = 'activated' },
    (value) => { value.support.actual_consumers.push('moss') },
    (value) => { value.support.actual_producers.push('moss') },
    (value) => { value.historical_0_2_0.support_classification = 'candidate_support' },
    (value) => { value.choreography.activation_A.mutates_candidate_package_bytes = true },
    (value) => { value.choreography.activation_A.consumer_repin_required = true },
    (value) => { value.choreography.activation_A.c03_decision = 'resolved' },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(original)
    mutate(changed)
    assert.throws(
      () => verifyStageMetadata(jsonBytes(changed)),
      /changed outside the reviewed content-stage contract/,
    )
  }
})

test('generated candidate encodes the terminating C to M to A contract without claiming adoption', () => {
  const manifest = JSON.parse(read(CANDIDATE_PATH))
  assert.equal(manifest.sudostack.candidate_revision, null)
  assert.equal(manifest.sudostack.activation_state, 'pending_future_commit')
  assert.deepEqual(manifest.choreography.sequence, ['content_C', 'moss_repin_M', 'activation_A'])
  assert.equal(manifest.choreography.content_C.records_own_revision, false)
  assert.equal(manifest.choreography.moss_repin_M.pins, 'content_commit_C')
  assert.equal(manifest.choreography.activation_A.evidence_scope, 'package_external')
  assert.equal(manifest.choreography.activation_A.mutates_candidate_package_bytes, false)
  assert.equal(manifest.choreography.activation_A.consumer_repin_required, false)
  assert.equal(manifest.choreography.activation_A.c03_decision, 'pending')
  assert.deepEqual(manifest.package.actual_consumers, [])
  assert.deepEqual(manifest.package.actual_producers, [])
  assert.equal(manifest.support_evidence.prior_classification, 'historical_only_not_candidate_support')
})

test('B0 records scoped C-03 resolution while preserving live and rollback blockers', () => {
  const templatePath = join(REPO, 'manifests/inventory/b0-customer-demo-baseline.template.json')
  const template = JSON.parse(readFileSync(templatePath, 'utf8'))
  const supportOperationBytes = read('manifests/operations/consumer-support.json')
  const activationOperationBytes = read('manifests/operations/0.2.1-activation-support.json')
  const activationOperation = JSON.parse(activationOperationBytes)
  assert.equal(
    template.source_cut.consumer_support_operation.sha256,
    sha256(supportOperationBytes),
  )
  assert.equal(
    template.source_cut.candidate_release_manifest.observed_manifest_digest.value,
    sha256(read(HISTORICAL_CANDIDATE_PATH)),
  )
  assert.equal(
    template.source_cut.package_external_activation.operation_sha256,
    sha256(activationOperationBytes),
  )
  assert.equal(template.contract_scope.confirmed_production_consumers.length, 1)
  assert.equal(
    template.contract_scope.confirmed_production_consumers[0].content_revision,
    activationOperation.content_evidence.content_revision,
  )
  assert.equal(
    template.contract_scope.confirmed_production_consumers[0].integration_revision,
    activationOperation.consumer_evidence.integration_revision,
  )
  assert.deepEqual(template.known_conflicts, [])
  assert.deepEqual(
    template.resolved_conflict_history.map(({ id }) => id),
    ['C-01', 'C-02', 'C-04', 'C-03'],
  )
  const c03 = template.resolved_conflict_history.find(({ id }) => id === 'C-03')
  assert.equal(c03.resolution_scope, 'included_moss_zone_id_embedded_only')
  assert.equal(c03.resolved_against_content_revision, activationOperation.content_evidence.content_revision)
  assert.equal(c03.resolved_by_consumer_revision, activationOperation.consumer_evidence.feature_revision)
  assert.equal(c03.resolved_by_integration_revision, activationOperation.consumer_evidence.integration_revision)
  assert.equal(template.required_live_inputs.length, 13)
  assert.ok(template.required_live_inputs.every(({ evidence_status }) => evidence_status === 'Unknown'))
  assert.equal(template.source_cut.staged_candidate.content_revision, null)
  assert.equal(template.source_cut.staged_candidate.contract_baseline, 'unfrozen')
  assert.equal(template.source_cut.staged_candidate.support_state, 'pending_moss_repin')
  assert.deepEqual(template.source_cut.staged_candidate.actual_consumers, [])
  assert.deepEqual(template.source_cut.staged_candidate.actual_producers, [])
  assert.equal(
    template.source_cut.package_external_activation.content_revision,
    activationOperation.content_evidence.content_revision,
  )
  assert.equal(
    template.source_cut.package_external_activation.moss_feature_revision,
    activationOperation.consumer_evidence.feature_revision,
  )
  assert.equal(
    template.source_cut.package_external_activation.moss_integration_revision,
    activationOperation.consumer_evidence.integration_revision,
  )
  assert.equal(
    template.source_cut.package_external_activation.c03_resolution,
    'resolved_for_included_moss_zone_id_scope',
  )
  assert.equal(template.source_cut.package_external_activation.consumer_repin_after_activation, false)
  assert.equal(template.source_cut.package_external_activation.deployment_evidence, 'not_deployed')
  assert.equal(template.candidate_assembly.source_readiness.evidence_status, 'Unknown')
  assert.equal(template.candidate_assembly.built_artifacts.evidence_status, 'Unknown')
  assert.equal(template.rollback_rehearsal.change_authorization_ref, null)
  assert.equal(template.rollback_rehearsal.persistence_restore_plan_refs.length, 0)
  assert.ok(
    Object.values(template.rollback_rehearsal.steps)
      .every(({ evidence_status }) => evidence_status === 'Unknown'),
  )
  assert.equal(template.signoff.assembly_entry.decision, 'pending')
  assert.equal(template.signoff.g3.decision, 'pending')
  assert.equal(
    template.source_cut.staged_candidate.release_manifest_sha256,
    sha256(read(CANDIDATE_PATH)),
  )
  assert.equal(
    template.contract_scope.deferred.find(({ contract_family }) => contract_family === 'ResourceRef').state,
    'deferred_no_current_production_provider_or_consumer',
  )
  assert.equal(
    template.contract_scope.deferred.find(({ contract_family }) => contract_family === 'ZonePath').state,
    'owner_source_dependency_only_for_deferred_resource_ref',
  )

  let confirmedDeploymentCount = 0
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence_status' && child === 'Confirmed-Deployment') confirmedDeploymentCount += 1
      visit(child)
    }
  }
  visit(template)
  assert.equal(confirmedDeploymentCount, 0)

  const verifyLocalRefs = (value) => {
    if (Array.isArray(value)) return value.forEach(verifyLocalRefs)
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

  const stagingDocumentation = read('docs/design/contracts-0.2.1-content-stage.md').toString('utf8')
  for (const path of [CANDIDATE_PATH, 'compatibility/current.gen.json', BASELINE_PATH]) {
    assert.ok(
      stagingDocumentation.includes(sha256(read(path))),
      `staging document is missing current digest for ${path}`,
    )
  }
  for (const path of [
    'manifests/operations/0.2.1-activation-support.json',
    'tools/contracts/activation-0.2.1.mjs',
  ]) {
    assert.ok(
      stagingDocumentation.includes(sha256(read(path))),
      `activation outcome is missing current digest for ${path}`,
    )
  }

  const documentation = read('docs/inventory/b0-customer-demo-baseline.md').toString('utf8')
  assert.ok(documentation.includes('C-03 is resolved only for the included Moss/`ZoneId` embedded boundary'))
  assert.ok(documentation.includes('Assembly and G3 remain blocked'))
  assert.ok(documentation.includes('C-04 remains resolved'))
  assert.ok(documentation.includes('13 Unknown live inputs'))
  assert.ok(documentation.includes('Confirmed deployment records | **0**'))
  assert.ok(documentation.includes('ResourceRef'))
  assert.ok(documentation.includes('ZonePath'))
  for (const [, reference] of documentation.matchAll(/\]\(([^)]+)\)/g)) {
    if (reference.startsWith('http') || reference.startsWith('#')) continue
    const path = reference.split('#', 1)[0]
    assert.ok(
      existsSync(resolve(REPO, 'docs/inventory', path)),
      `missing Markdown link ${reference}`,
    )
  }
})
