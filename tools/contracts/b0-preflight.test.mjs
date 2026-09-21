import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import { REPO, TEMPLATE_PATH, validateB0Record } from './b0-preflight.mjs'

const templateBytes = readFileSync(join(REPO, TEMPLATE_PATH))
const template = JSON.parse(templateBytes)
const clone = (value) => structuredClone(value)
const timestamp = '2026-09-21T00:00:00Z'
const finished = '2026-09-21T00:00:01Z'
const evidenceRef = (id) => `evidence://synthetic/${id}`
const revision = (number) => number.toString(16).padStart(40, '0')
const digest = (number) => ({ algorithm: 'sha256', value: number.toString(16).padStart(64, '0') })
const deployed = (id) => ({ evidence_status: 'Confirmed-Deployment', evidence_refs: [evidenceRef(id)] })

function collectionItem(collection, id, number, sourceRevision) {
  const common = { id: `${id}-${collection}`, ...deployed(`${id}-${collection}`) }
  if (collection === 'artifacts') return { ...common, kind: 'oci', version: '1.0.0', digest: digest(number), source_revision: sourceRevision }
  if (collection === 'runtime_versions') return { ...common, runtime: 'node', version: '22.21.0', artifact_ref: evidenceRef(`${id}-artifact`) }
  if (collection === 'configuration_records') return { ...common, config_ref: evidenceRef(`${id}-config`), redacted_digest: digest(number + 20) }
  if (collection === 'schema_records') return { ...common, schema: 'synthetic-v1', version: '1', digest: digest(number + 40) }
  if (collection === 'persistence_resources') return { ...common, engine: 'synthetic-db', version: '1', migration_identity: 'head-1', restore_ref: evidenceRef(`${id}-restore`) }
  return { ...common, purpose: 'isolated synthetic test scope' }
}

function completeComponent(id, repository, number, { additional = false } = {}) {
  const sourceRevision = revision(number)
  const value = {
    repository,
    required_by: 'ADR005-B0-01',
    observed_at: timestamp,
    applicability: { value: 'applicable', reason: null, ...deployed(`${id}-applicability`) },
    repository_revision: { value: sourceRevision, dirty: false, ...deployed(`${id}-revision`) },
  }
  for (const collection of ['artifacts', 'runtime_versions', 'configuration_records', 'schema_records', 'persistence_resources', 'zone_identifiers']) {
    value[collection] = {
      applicability: 'applicable',
      items: [collectionItem(collection, id, number, sourceRevision)],
      ...deployed(`${id}-${collection}-collection`),
    }
  }
  if (additional) return { component_id: id, repository_not_applicable_reason: null, ...value }
  return value
}

function completeObservation(definitionRef, componentIds, id) {
  return {
    definition_ref: definitionRef,
    profile: 'Cloud',
    component_ids: componentIds,
    command_or_request: 'synthetic read-only check',
    sanitized_input_ref: evidenceRef(`${id}-input`),
    started_at: timestamp,
    finished_at: finished,
    exit_or_status_code: 0,
    result: 'pass',
    actual_observation: 'synthetic expected observation recorded',
    negative_side_effect_observation: 'synthetic no unexpected side effect recorded',
    ...deployed(id),
  }
}

function completeRow(rowId, kind, assignments) {
  return {
    row_id: rowId,
    kind,
    component_assignments: assignments,
    support_disposition: 'supported',
    procedure_ref: evidenceRef(`${rowId}-procedure`),
    started_at: timestamp,
    finished_at: finished,
    result: 'pass',
    observed_result: 'synthetic expected matrix result recorded',
    negative_side_effect_observation: 'synthetic no unexpected matrix side effect recorded',
    ...deployed(rowId),
  }
}

function completeStep(definitionRef, id) {
  return {
    definition_ref: definitionRef,
    procedure_ref: evidenceRef(`${id}-procedure`),
    started_at: timestamp,
    finished_at: finished,
    result: 'pass',
    actual_observation: 'synthetic expected rollback observation recorded',
    negative_side_effect_observation: 'synthetic no unexpected rollback side effect recorded',
    ...deployed(id),
  }
}

function makeCompleteRecord() {
  const record = clone(template)
  record.record_state = 'complete'
  record.baseline.baseline_id = `sha256:${'a'.repeat(64)}`
  record.baseline.baseline_revision = `sha256:${'b'.repeat(64)}`
  record.baseline.collected_at = timestamp
  record.baseline.collector_role = 'synthetic-release-operator'
  record.baseline.evidence_bundle_ref = evidenceRef('bundle')
  record.baseline.evidence_bundle_digest = digest(1)
  record.baseline.environment.environment_label = { value: 'synthetic-environment', ...deployed('environment-label') }
  record.baseline.environment.profile = {
    ...record.baseline.environment.profile,
    value: 'Cloud',
    applicability: 'applicable',
    ...deployed('profile'),
  }

  let number = 1
  for (const [id, component] of Object.entries(record.baseline.components)) {
    record.baseline.components[id] = completeComponent(id, component.repository, number++)
  }
  record.baseline.additional_components = [
    completeComponent('sudorouter', 'sudoprivacy/new-api', number++, { additional: true }),
  ]
  const components = {
    ...record.baseline.components,
    sudorouter: record.baseline.additional_components[0],
  }
  const componentIds = Object.keys(components).sort()
  const changedIds = new Set(['sudostack', 'moss'])
  const assignments = componentIds.map((componentId, index) => {
    const component = components[componentId]
    const baselineIdentity = {
      revision: component.repository_revision.value,
      artifact_digest: clone(component.artifacts.items[0].digest),
    }
    return {
      component_id: componentId,
      baseline: baselineIdentity,
      candidate: changedIds.has(componentId)
        ? { revision: revision(30 + index), artifact_digest: digest(80 + index) }
        : clone(baselineIdentity),
      changed: changedIds.has(componentId),
    }
  })
  const assignmentMap = new Map(assignments.map((item) => [item.component_id, item]))
  const matrixAssignments = (candidateIds) => componentIds.map((componentId) => {
    const assignment = assignmentMap.get(componentId)
    const selection = candidateIds.has(componentId) ? 'candidate' : 'b0'
    return { component_id: componentId, selection, ...clone(assignment[selection === 'b0' ? 'baseline' : 'candidate']) }
  })

  record.candidate_assembly = {
    assembly_id: `sha256:${'c'.repeat(64)}`,
    release_manifest_ref: '#/source_cut/staged_candidate',
    source_readiness: {
      dependency_order_ref: evidenceRef('dependency-order'),
      merged_to_declared_bases: true,
      unmerged_exception: { decision_ref: null, risk_owner_role: null },
      ...deployed('source-readiness'),
    },
    built_artifacts: {
      items: assignments.filter(({ changed }) => changed).map((assignment) => ({
        id: `candidate-${assignment.component_id}`,
        kind: 'component',
        version: '1.0.0',
        digest: clone(assignment.candidate.artifact_digest),
        source_revision: assignment.candidate.revision,
        ...deployed(`candidate-${assignment.component_id}`),
      })),
      ...deployed('candidate-artifacts'),
    },
    runtime_versions: {
      items: [{ id: 'candidate-node', runtime: 'node', version: '22.21.0', artifact_ref: evidenceRef('candidate-artifact'), ...deployed('candidate-runtime') }],
      ...deployed('candidate-runtimes'),
    },
    component_assignments: assignments,
    observed_at: timestamp,
  }

  for (const id of Object.keys(record.checks)) {
    record.checks[id] = completeObservation(record.checks[id].definition_ref, componentIds, id)
  }
  const allB0 = completeRow('all-b0-control', 'all_b0', matrixAssignments(new Set()))
  const transitions = [...changedIds].sort().map((componentId) =>
    completeRow(`transition-${componentId}`, 'single_component_transition', matrixAssignments(new Set([componentId]))),
  )
  const allCandidate = completeRow('all-candidate', 'all_candidate', matrixAssignments(changedIds))
  const rollback = completeRow('rollback-to-b0', 'rollback_to_b0', matrixAssignments(new Set()))
  record.mixed_version_matrix = {
    matrix_id: `sha256:${'d'.repeat(64)}`,
    candidate_assembly_ref: '#/candidate_assembly',
    single_component_transition_rows: transitions.map(({ row_id }) => row_id),
    rows: [allB0, ...transitions, allCandidate, rollback],
  }

  record.rollback_rehearsal = {
    target_baseline_ref: '#/baseline',
    matrix_ref: '#/mixed_version_matrix',
    change_window_ref: evidenceRef('change-window'),
    change_authorization_ref: evidenceRef('change-authorization'),
    operator_role: 'synthetic-release-operator',
    dependency_order: componentIds,
    recovery_objective_seconds: 600,
    actual_duration_seconds: 500,
    stop_conditions: ['synthetic stop condition'],
    persistence_restore_plan_refs: [evidenceRef('persistence-restore')],
    pre_restore_smoke_run_ref: evidenceRef('pre-restore-smoke'),
    post_restore_smoke_run_ref: evidenceRef('post-restore-smoke'),
    steps: Object.fromEntries(Object.entries(record.rollback_rehearsal.steps).map(([id, step]) => [
      id,
      completeStep(step.definition_ref, id),
    ])),
  }
  record.required_live_inputs = record.required_live_inputs.map((input) => ({
    ...input,
    evidence_status: 'Confirmed-Deployment',
    evidence_refs: [evidenceRef(input.id)],
    not_applicable_reason: null,
  }))
  record.signoff = {
    assembly_entry: { decision: 'pending', criteria_result_refs: [], approved_by_role: null, approved_at: null },
    g3: { decision: 'pending', criteria_result_refs: [], approved_by_role: null, approved_at: null },
  }
  return record
}

const codes = (result) => result.findings.map(({ code }) => code)
const validate = (record, mode = 'record') => validateB0Record(record, { mode, canonicalTemplate: template })

test('--template accepts the unchanged source seed and reports claimed counts only', () => {
  const before = Buffer.from(templateBytes)
  const result = validate(template, 'template')
  assert.equal(result.valid, true)
  assert.equal(result.structural_state, 'template_valid')
  assert.equal(result.observations_authenticated, false)
  assert.equal(result.approval_granted, false)
  assert.equal(result.claimed_status_counts['Confirmed-Deployment'], 0)
  assert.equal(Buffer.compare(before, templateBytes), 0)
})

test('template mode enforces pending and authoritative seed semantics independently', () => {
  const approved = clone(template)
  approved.signoff.g3 = {
    decision: 'approved',
    criteria_result_refs: [evidenceRef('criteria')],
    approved_by_role: 'synthetic-reviewer',
    approved_at: timestamp,
  }
  const result = validateB0Record(approved, { mode: 'template', canonicalTemplate: approved })
  assert.ok(codes(result).includes('TEMPLATE_APPROVAL_PRESENT'))

  const remapped = clone(template)
  remapped.baseline.components.moss.repository = 'sudoprivacy/other'
  const remappedResult = validateB0Record(remapped, { mode: 'template', canonicalTemplate: remapped })
  assert.ok(codes(remappedResult).includes('AUTHORITATIVE_MAPPING_CHANGED'))
})

test('--record rejects the unchanged source seed as incomplete', () => {
  const result = validate(template)
  assert.equal(result.valid, false)
  assert.ok(codes(result).includes('INCOMPLETE_RECORD'))
})

test('synthetic complete record is structurally valid without authentication or approval', () => {
  const record = makeCompleteRecord()
  const before = JSON.stringify(record)
  const result = validate(record)
  assert.deepEqual(result.findings, [])
  assert.equal(result.valid, true)
  assert.equal(result.structural_state, 'record_structurally_valid')
  assert.equal(result.observations_authenticated, false)
  assert.equal(result.approval_granted, false)
  assert.deepEqual(result.recorded_signoff, { assembly_entry: 'pending', g3: 'pending' })
  assert.ok(result.claimed_status_counts['Confirmed-Deployment'] > 0)
  assert.equal(JSON.stringify(record), before)
})

test('repository-less additional components use artifact digest identity', () => {
  const record = makeCompleteRecord()
  const component = record.baseline.additional_components[0]
  component.repository = null
  component.repository_not_applicable_reason = 'Synthetic infrastructure has no source repository.'
  component.repository_revision.value = null
  component.artifacts.items[0].source_revision = null
  const assignment = record.candidate_assembly.component_assignments.find(({ component_id }) => component_id === 'sudorouter')
  assignment.baseline.revision = `sha256:${component.artifacts.items[0].digest.value}`
  assignment.candidate = clone(assignment.baseline)
  for (const row of record.mixed_version_matrix.rows) {
    const item = row.component_assignments.find(({ component_id }) => component_id === 'sudorouter')
    item.revision = assignment.baseline.revision
  }
  assert.deepEqual(validate(record).findings, [])
})

test('RFC 3339 UTC timestamps accept sub-millisecond precision', () => {
  const record = makeCompleteRecord()
  record.baseline.collected_at = '2026-09-21T00:00:00.123456Z'
  assert.deepEqual(validate(record).findings, [])
})

test('fractional timestamp ordering compares UTC instants, not strings', () => {
  const forward = makeCompleteRecord()
  forward.checks['B0-SMOKE-01'].started_at = '2026-09-21T00:00:00Z'
  forward.checks['B0-SMOKE-01'].finished_at = '2026-09-21T00:00:00.1Z'
  assert.deepEqual(validate(forward).findings, [])

  const reverse = makeCompleteRecord()
  reverse.checks['B0-SMOKE-01'].started_at = '2026-09-21T00:00:00.1Z'
  reverse.checks['B0-SMOKE-01'].finished_at = '2026-09-21T00:00:00Z'
  assert.ok(codes(validate(reverse)).includes('TIMESTAMP_ORDER'))

  const equal = makeCompleteRecord()
  equal.checks['B0-SMOKE-01'].started_at = '2026-09-21T00:00:00.0Z'
  equal.checks['B0-SMOKE-01'].finished_at = '2026-09-21T00:00:00.000000Z'
  assert.deepEqual(validate(equal).findings, [])
})

test('matrix rows require a nonblank observed result', () => {
  for (const observed of [null, '   ']) {
    const record = makeCompleteRecord()
    record.mixed_version_matrix.rows[0].observed_result = observed
    const result = validate(record)
    assert.ok(result.findings.some(({ code, path }) =>
      code === 'MISSING_VALUE' && path === '/mixed_version_matrix/rows/0/observed_result',
    ))
  }
})

test('changed candidate assignments must match built artifact revision and digest pairs', () => {
  const artifactChanged = makeCompleteRecord()
  artifactChanged.candidate_assembly.built_artifacts.items[0].digest = digest(999)
  assert.ok(codes(validate(artifactChanged)).includes('CANDIDATE_ARTIFACT_MISMATCH'))

  const assignmentChanged = makeCompleteRecord()
  const assignment = assignmentChanged.candidate_assembly.component_assignments.find(({ changed }) => changed)
  assignment.candidate.artifact_digest = digest(998)
  assert.ok(codes(validate(assignmentChanged)).includes('CANDIDATE_ARTIFACT_MISMATCH'))
})

test('required identities, policy and status contradictions fail closed', () => {
  const mutations = [
    ['REQUIRED_COMPONENT_MISMATCH', (value) => { delete value.baseline.components.moss }],
    ['DUPLICATE_ID', (value) => { value.required_live_inputs.push(clone(value.required_live_inputs[0])) }],
    ['REQUIRED_CHECK_MISMATCH', (value) => { delete value.checks['B1-SMOKE-05'] }],
    ['AUTHORITATIVE_MAPPING_CHANGED', (value) => { value.completion_rules.required_b0_component_ids = ['moss'] }],
    ['INVALID_STATUS', (value) => { value.baseline.components.moss.artifacts.evidence_status = 'Verified' }],
    ['UNKNOWN_WITH_OBSERVATION', (value) => { value.baseline.environment.environment_label.evidence_status = 'Unknown'; value.baseline.environment.environment_label.evidence_refs = [] }],
    ['EVIDENCE_REF_REQUIRED', (value) => { value.baseline.components.moss.repository_revision.evidence_refs = [] }],
    ['SOURCE_ONLY_EVIDENCE', (value) => { value.baseline.components.moss.repository_revision.evidence_refs = ['file:///checkout/package.json'] }],
    ['INVALID_TIMESTAMP', (value) => { value.baseline.components.moss.observed_at = null }],
    ['INVALID_APPLICABILITY', (value) => { value.baseline.components.moss.applicability.value = 'maybe' }],
    ['NOT_APPLICABLE_REASON_REQUIRED', (value) => { value.baseline.components.moss.applicability.value = 'not_applicable'; value.baseline.components.moss.applicability.reason = null }],
    ['INVALID_REVISION', (value) => { value.baseline.components.moss.repository_revision.value = 'main' }],
    ['INVALID_DIGEST', (value) => { value.baseline.components.moss.artifacts.items[0].digest.value = 'latest' }],
    ['INVALID_SHAPE', (value) => { delete value.baseline.additional_components[0].runtime_versions }],
    ['ASSIGNMENT_MISMATCH', (value) => { const item = value.candidate_assembly.component_assignments.find(({ component_id }) => component_id === 'moss'); item.candidate = clone(item.baseline) }],
    ['TRANSITION_COVERAGE_MISSING', (value) => { value.mixed_version_matrix.rows = value.mixed_version_matrix.rows.filter((row) => row.row_id !== 'transition-moss'); value.mixed_version_matrix.single_component_transition_rows = value.mixed_version_matrix.single_component_transition_rows.filter((id) => id !== 'transition-moss') }],
    ['REQUIRED_ROLLBACK_STEP_MISMATCH', (value) => { delete value.rollback_rehearsal.steps['R-04'] }],
    ['RESULT_CONTRADICTION', (value) => { value.mixed_version_matrix.rows[0].support_disposition = 'unsupported' }],
    ['INVALID_TYPE', (value) => { value.signoff.g3.criteria_result_refs = {} }],
    ['APPROVAL_CONTRADICTION', (value) => { value.checks['B0-SMOKE-01'].result = 'fail'; value.signoff.assembly_entry = { decision: 'approved', criteria_result_refs: [evidenceRef('criteria')], approved_by_role: 'reviewer', approved_at: finished } }],
  ]
  for (const [expected, mutate] of mutations) {
    const record = makeCompleteRecord()
    mutate(record)
    assert.ok(codes(validate(record)).includes(expected), expected)
  }
})

test('malformed nested assignment and artifact shapes return findings instead of throwing', () => {
  const assignmentNull = makeCompleteRecord()
  assignmentNull.candidate_assembly.component_assignments[0].baseline = null
  let assignmentResult
  assert.doesNotThrow(() => { assignmentResult = validate(assignmentNull) })
  assert.ok(assignmentResult.findings.some(({ code, path }) =>
    code === 'INVALID_TYPE' && path === '/candidate_assembly/component_assignments/0/baseline',
  ))

  const builtArtifactNull = makeCompleteRecord()
  builtArtifactNull.candidate_assembly.built_artifacts.items[0] = null
  let builtArtifactResult
  assert.doesNotThrow(() => { builtArtifactResult = validate(builtArtifactNull) })
  assert.ok(builtArtifactResult.findings.some(({ code, path }) =>
    code === 'INVALID_TYPE' && path === '/candidate_assembly/built_artifacts/items/0',
  ))

  const componentItemsNull = makeCompleteRecord()
  componentItemsNull.baseline.components.moss.artifacts.items = null
  let componentItemsResult
  assert.doesNotThrow(() => { componentItemsResult = validate(componentItemsNull) })
  assert.ok(componentItemsResult.findings.some(({ code, path }) =>
    code === 'INVALID_TYPE' && path === '/baseline/components/moss/artifacts/items',
  ))
})

test('internal evidence references reject dangling and circular-only chains', () => {
  const dangling = makeCompleteRecord()
  dangling.baseline.environment.environment_label.evidence_refs = ['#/missing/evidence']
  assert.ok(codes(validate(dangling)).includes('DANGLING_INTERNAL_REF'))

  const circular = makeCompleteRecord()
  circular.baseline.environment.environment_label.evidence_refs = ['#/baseline/environment/profile']
  circular.baseline.environment.profile.evidence_refs = ['#/baseline/environment/environment_label']
  assert.ok(codes(validate(circular)).includes('CIRCULAR_EVIDENCE_REF'))
})

test('live evidence accepts valid internal chains and opaque HTTPS but rejects source-only terminals', () => {
  const internal = makeCompleteRecord()
  internal.baseline.environment.environment_label.evidence_refs = ['#/baseline/environment/profile']
  assert.deepEqual(validate(internal).findings, [])

  const https = makeCompleteRecord()
  https.baseline.environment.environment_label.evidence_refs = ['https://evidence.example/internal/run/1']
  assert.deepEqual(validate(https).findings, [])

  const sourceInternal = makeCompleteRecord()
  sourceInternal.baseline.environment.environment_label.evidence_refs = ['#/source_cut/package_external_activation']
  assert.ok(codes(validate(sourceInternal)).includes('SOURCE_ONLY_EVIDENCE'))

  const sourcePath = makeCompleteRecord()
  sourcePath.baseline.environment.environment_label.evidence_refs = ['docs/source-only.json']
  assert.ok(codes(validate(sourcePath)).includes('SOURCE_ONLY_EVIDENCE'))
})

test('recorded unmerged exception is structurally compatible with assembly approval', () => {
  const record = makeCompleteRecord()
  record.candidate_assembly.source_readiness.merged_to_declared_bases = false
  record.candidate_assembly.source_readiness.unmerged_exception = {
    decision_ref: evidenceRef('unmerged-decision'),
    risk_owner_role: 'synthetic-risk-owner',
  }
  record.signoff.assembly_entry = {
    decision: 'approved',
    criteria_result_refs: [evidenceRef('assembly-criteria')],
    approved_by_role: 'synthetic-reviewer',
    approved_at: finished,
  }
  assert.deepEqual(validate(record).findings, [])
  assert.equal(validate(record).approval_granted, false)
})

test('mandatory rollback controls cannot be unsupported for approved G3', () => {
  const pending = makeCompleteRecord()
  const pendingRollback = pending.mixed_version_matrix.rows.find(({ row_id }) => row_id === 'rollback-to-b0')
  pendingRollback.support_disposition = 'unsupported'
  pendingRollback.result = 'fail'
  assert.deepEqual(validate(pending).findings, [])

  const approved = clone(pending)
  approved.signoff.assembly_entry = {
    decision: 'approved',
    criteria_result_refs: [evidenceRef('assembly-criteria')],
    approved_by_role: 'synthetic-reviewer',
    approved_at: finished,
  }
  approved.signoff.g3 = {
    decision: 'approved',
    criteria_result_refs: [evidenceRef('g3-criteria')],
    approved_by_role: 'synthetic-reviewer',
    approved_at: finished,
  }
  assert.ok(codes(validate(approved)).includes('APPROVAL_CONTRADICTION'))
})

test('CLI is read-only, does not execute evidence, and never reflects secret-bearing input', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'b0-preflight-test-'))
  try {
    const cli = join(REPO, 'tools/contracts/b0-preflight.mjs')
    const complete = makeCompleteRecord()
    const sentinel = join(temporary, 'must-not-exist')
    complete.checks['B0-SMOKE-01'].command_or_request = `touch ${sentinel}`
    complete.checks['B0-SMOKE-01'].evidence_refs = ['evidence://127.0.0.1:9/never-fetch']
    const recordPath = join(temporary, 'complete.json')
    writeFileSync(recordPath, `${JSON.stringify(complete, null, 2)}\n`)
    const before = readFileSync(recordPath)

    const templateResult = spawnSync(process.execPath, [cli, '--template'], { encoding: 'utf8' })
    assert.equal(templateResult.status, 0, templateResult.stderr)
    assert.match(templateResult.stdout, /observations_authenticated=false approval_granted=false/)

    const incomplete = spawnSync(process.execPath, [cli, '--record', join(REPO, TEMPLATE_PATH)], { encoding: 'utf8' })
    assert.notEqual(incomplete.status, 0)
    assert.match(incomplete.stderr, /INCOMPLETE_RECORD \/record_state/)

    const completeResult = spawnSync(process.execPath, [cli, '--record', recordPath], { encoding: 'utf8' })
    assert.equal(completeResult.status, 0, completeResult.stderr)
    assert.match(completeResult.stdout, /record_structurally_valid/)
    assert.match(completeResult.stdout, /observations_authenticated=false approval_granted=false/)
    assert.equal(existsSync(sentinel), false)
    assert.deepEqual(readFileSync(recordPath), before)

    const sentinelValue = 'super-secret-sentinel'
    const malformedPath = join(temporary, `${sentinelValue}.json`)
    writeFileSync(malformedPath, `{"sensitive":"${sentinelValue}"`)
    const malformed = spawnSync(process.execPath, [cli, '--record', malformedPath], { encoding: 'utf8' })
    assert.notEqual(malformed.status, 0)
    assert.equal(`${malformed.stdout}${malformed.stderr}`.includes(sentinelValue), false)
    assert.match(malformed.stderr, /INVALID_JSON_OR_INPUT \/$/m)

    const unsafe = makeCompleteRecord()
    unsafe.baseline.components.moss[sentinelValue] = sentinelValue
    const unsafePath = join(temporary, 'unsafe.json')
    writeFileSync(unsafePath, `${JSON.stringify(unsafe)}\n`)
    const unsafeResult = spawnSync(process.execPath, [cli, '--record', unsafePath], { encoding: 'utf8' })
    assert.notEqual(unsafeResult.status, 0)
    assert.equal(`${unsafeResult.stdout}${unsafeResult.stderr}`.includes(sentinelValue), false)
    assert.match(unsafeResult.stderr, /INVALID_SHAPE \/baseline\/components\/moss\/<unknown>/)

    const malformedShape = makeCompleteRecord()
    malformedShape.candidate_assembly.component_assignments[0].candidate = 'wrong-type'
    const malformedShapePath = join(temporary, 'malformed-shape.json')
    writeFileSync(malformedShapePath, `${JSON.stringify(malformedShape)}\n`)
    const malformedShapeResult = spawnSync(
      process.execPath,
      [cli, '--record', malformedShapePath],
      { encoding: 'utf8' },
    )
    assert.notEqual(malformedShapeResult.status, 0)
    assert.equal(`${malformedShapeResult.stdout}${malformedShapeResult.stderr}`.includes('TypeError'), false)
    assert.match(
      malformedShapeResult.stderr,
      /INVALID_TYPE \/candidate_assembly\/component_assignments\/0\/candidate/,
    )

    const malformedItem = makeCompleteRecord()
    malformedItem.candidate_assembly.built_artifacts.items[0] = null
    const malformedItemPath = join(temporary, 'malformed-item.json')
    writeFileSync(malformedItemPath, `${JSON.stringify(malformedItem)}\n`)
    const malformedItemResult = spawnSync(
      process.execPath,
      [cli, '--record', malformedItemPath],
      { encoding: 'utf8' },
    )
    assert.notEqual(malformedItemResult.status, 0)
    assert.equal(`${malformedItemResult.stdout}${malformedItemResult.stderr}`.includes('TypeError'), false)
    assert.match(
      malformedItemResult.stderr,
      /INVALID_TYPE \/candidate_assembly\/built_artifacts\/items\/0/,
    )

    const badMode = spawnSync(process.execPath, [cli, '--record'], { encoding: 'utf8' })
    assert.equal(badMode.status, 2)
    assert.equal(`${badMode.stdout}${badMode.stderr}`.includes(sentinelValue), false)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
