#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')
export const TEMPLATE_PATH = 'manifests/inventory/b0-customer-demo-baseline.template.json'

const FORMAT = 'sudostack.b0-customer-demo-baseline-inventory/v1'
const STATUSES = [
  'Expected',
  'Confirmed-Code',
  'Confirmed-Deployment',
  'Inferred',
  'Conflicting',
  'Unknown',
  'Legacy-Declared',
]
const APPLICABILITY = ['applicable', 'not_applicable', 'unknown']
const PROFILES = ['Cloud', 'Private', 'Edge', 'Local']
const RESULTS = ['pass', 'fail', 'blocked']
const SUPPORT = ['supported', 'unsupported', 'excluded']
const SIGNOFF = ['pending', 'approved', 'rejected']
const REQUIRED_COMPONENTS = {
  sudostack: 'sudoprivacy/sudostack',
  moss: 'sudoprivacy/moss',
  sudowork: 'sudoprivacy/sudowork',
  'sudowork-server': 'sudoprivacy/sudowork-server',
  nexus: 'nexi-lab/nexus',
  sudocode: 'sudoprivacy/sudocode',
  'nexus-vfs': 'nexi-lab/nexus-vfs',
}
const COLLECTIONS = [
  'artifacts',
  'runtime_versions',
  'configuration_records',
  'schema_records',
  'persistence_resources',
  'zone_identifiers',
]
const CHECK_IDS = [
  'B0-SMOKE-01',
  'B0-SMOKE-02',
  'B0-SMOKE-03',
  'B0-SMOKE-04',
  'B1-SMOKE-01',
  'B1-SMOKE-02',
  'B1-SMOKE-03',
  'B1-SMOKE-04',
  'B1-SMOKE-05',
]
const ROLLBACK_IDS = ['R-01', 'R-02', 'R-03', 'R-04']
const REQUIRED_INPUTS = {
  'U-01': ['#/baseline/environment'],
  'U-02': ['#/baseline/components/*/repository_revision'],
  'U-03': ['#/baseline/components/*/artifacts'],
  'U-04': ['#/baseline/components/*/runtime_versions'],
  'U-05': ['#/baseline/components/*/configuration_records'],
  'U-06': ['#/baseline/components/*/schema_records'],
  'U-07': ['#/baseline/components/*/persistence_resources', '#/rollback_rehearsal/persistence_restore_plan_refs'],
  'U-08': ['#/baseline/components/*/zone_identifiers'],
  'U-09': ['#/checks/B0-SMOKE-03'],
  'U-10': ['#/checks/B0-SMOKE-01', '#/checks/B0-SMOKE-02', '#/checks/B0-SMOKE-03', '#/checks/B0-SMOKE-04'],
  'U-11': ['#/rollback_rehearsal'],
  'U-12': ['#/baseline/components/sudowork-server/applicability', '#/checks/B0-SMOKE-03'],
  'U-13': [
    '#/rollback_rehearsal/change_window_ref',
    '#/rollback_rehearsal/change_authorization_ref',
    '#/rollback_rehearsal/operator_role',
    '#/rollback_rehearsal/stop_conditions',
    '#/baseline/evidence_bundle_ref',
  ],
}
const REQUIRED_MATRIX_ROWS = {
  'all-b0-control': 'all_b0',
  'all-candidate': 'all_candidate',
  'rollback-to-b0': 'rollback_to_b0',
}
const ROOT_KEYS = [
  'record_format',
  'record_state',
  'inventory_spec_ref',
  'template_notice',
  'allowed_evidence_statuses',
  'completion_rules',
  'source_cut',
  'contract_scope',
  'resolved_conflict_history',
  'known_conflicts',
  'baseline',
  'candidate_assembly',
  'checks',
  'mixed_version_matrix',
  'rollback_rehearsal',
  'required_live_inputs',
  'signoff',
]
const COMPONENT_KEYS = [
  'repository',
  'required_by',
  'observed_at',
  'applicability',
  'repository_revision',
  ...COLLECTIONS,
]
const CHECK_KEYS = [
  'definition_ref',
  'profile',
  'component_ids',
  'command_or_request',
  'sanitized_input_ref',
  'started_at',
  'finished_at',
  'exit_or_status_code',
  'result',
  'actual_observation',
  'negative_side_effect_observation',
  'evidence_status',
  'evidence_refs',
]
const MATRIX_ROW_KEYS = [
  'row_id',
  'kind',
  'component_assignments',
  'support_disposition',
  'procedure_ref',
  'started_at',
  'finished_at',
  'result',
  'observed_result',
  'negative_side_effect_observation',
  'evidence_status',
  'evidence_refs',
]
const ROLLBACK_STEP_KEYS = [
  'definition_ref',
  'procedure_ref',
  'started_at',
  'finished_at',
  'result',
  'actual_observation',
  'negative_side_effect_observation',
  'evidence_status',
  'evidence_refs',
]
const ITEM_KEYS = {
  artifacts: ['id', 'kind', 'version', 'digest', 'source_revision', 'evidence_status', 'evidence_refs'],
  runtime_versions: ['id', 'runtime', 'version', 'artifact_ref', 'evidence_status', 'evidence_refs'],
  configuration_records: ['id', 'config_ref', 'redacted_digest', 'evidence_status', 'evidence_refs'],
  schema_records: ['id', 'schema', 'version', 'digest', 'evidence_status', 'evidence_refs'],
  persistence_resources: ['id', 'engine', 'version', 'migration_identity', 'restore_ref', 'evidence_status', 'evidence_refs'],
  zone_identifiers: ['id', 'purpose', 'evidence_status', 'evidence_refs'],
}
const STATIC_KEYS = [
  'inventory_spec_ref',
  'template_notice',
  'allowed_evidence_statuses',
  'completion_rules',
  'source_cut',
  'contract_scope',
  'resolved_conflict_history',
  'known_conflicts',
]

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const empty = (value) => value === null || value === '' || (Array.isArray(value) && value.length === 0)
const stringValue = (value) => typeof value === 'string' && value.trim().length > 0
const fullRevision = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
const immutableIdentity = (value) => fullRevision(value) || (typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value))
const sha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const externalRef = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith('#/')
const sourceOnlyExternalRef = (value) =>
  externalRef(value) && (
    !/^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /^(?:file|data|git(?:\+[^:]+)?|ssh):/i.test(value)
  )
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function add(findings, code, path) {
  findings.push({ code, path })
}

function exactKeys(value, expected, path, findings) {
  if (!plainObject(value)) {
    add(findings, 'INVALID_TYPE', path)
    return false
  }
  const actual = Object.keys(value).sort()
  if (!same(actual, [...expected].sort())) add(findings, 'INVALID_SHAPE', `${path}/<unknown>`)
  return true
}

function timestampParts(value) {
  const match = typeof value === 'string' && value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/,
  )
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ''] = match
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText,
  ].map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) return null
  return { seconds: Math.floor(parsed.getTime() / 1000), fraction }
}

function validTimestamp(value) {
  return timestampParts(value) !== null
}

function compareTimestamps(left, right) {
  const a = timestampParts(left)
  const b = timestampParts(right)
  if (!a || !b) return null
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1
  const width = Math.max(a.fraction.length, b.fraction.length)
  const aFraction = a.fraction.padEnd(width, '0')
  const bFraction = b.fraction.padEnd(width, '0')
  return aFraction === bFraction ? 0 : aFraction < bFraction ? -1 : 1
}

function validateRefs(refs, path, findings, { required = false } = {}) {
  if (!Array.isArray(refs)) {
    add(findings, 'INVALID_TYPE', path)
    return
  }
  if (required && refs.length === 0) add(findings, 'EVIDENCE_REF_REQUIRED', path)
  if (new Set(refs).size !== refs.length) add(findings, 'DUPLICATE_ID', path)
  refs.forEach((ref, index) => {
    if (!stringValue(ref)) add(findings, 'INVALID_REFERENCE', `${path}/${index}`)
  })
}

function validateStatus(status, refs, path, findings, { requireDeployment = false } = {}) {
  if (!STATUSES.includes(status)) add(findings, 'INVALID_STATUS', `${path}/evidence_status`)
  const refsRequired = ['Confirmed-Code', 'Confirmed-Deployment', 'Inferred', 'Conflicting', 'Legacy-Declared'].includes(status)
  validateRefs(refs, `${path}/evidence_refs`, findings, { required: refsRequired })
  if (requireDeployment && status !== 'Confirmed-Deployment') add(findings, 'LIVE_STATUS_REQUIRED', `${path}/evidence_status`)
}

function rejectUnknownObservation(status, values, path, findings) {
  if (status === 'Unknown' && values.some((value) => !empty(value))) {
    add(findings, 'UNKNOWN_WITH_OBSERVATION', path)
  }
}

function validateDigest(value, path, findings) {
  if (!exactKeys(value, ['algorithm', 'value'], path, findings)) return
  if (value.algorithm !== 'sha256' || !sha256(value.value)) add(findings, 'INVALID_DIGEST', path)
}

function validateItem(item, collection, path, findings, { repositoryRequired }) {
  if (!exactKeys(item, ITEM_KEYS[collection], path, findings)) return
  if (!stringValue(item.id)) add(findings, 'MISSING_VALUE', `${path}/id`)
  validateStatus(item.evidence_status, item.evidence_refs, path, findings, { requireDeployment: true })
  if (collection === 'artifacts') {
    if (!stringValue(item.kind) || !stringValue(item.version)) add(findings, 'MISSING_VALUE', path)
    validateDigest(item.digest, `${path}/digest`, findings)
    if (repositoryRequired && !fullRevision(item.source_revision)) add(findings, 'INVALID_REVISION', `${path}/source_revision`)
    if (!repositoryRequired && item.source_revision !== null && !fullRevision(item.source_revision)) add(findings, 'INVALID_REVISION', `${path}/source_revision`)
  } else if (collection === 'runtime_versions') {
    if (!stringValue(item.runtime) || !stringValue(item.version) || !stringValue(item.artifact_ref)) add(findings, 'MISSING_VALUE', path)
  } else if (collection === 'configuration_records') {
    if (!stringValue(item.config_ref)) add(findings, 'MISSING_VALUE', `${path}/config_ref`)
    validateDigest(item.redacted_digest, `${path}/redacted_digest`, findings)
  } else if (collection === 'schema_records') {
    if (!stringValue(item.schema) || !stringValue(item.version)) add(findings, 'MISSING_VALUE', path)
    validateDigest(item.digest, `${path}/digest`, findings)
  } else if (collection === 'persistence_resources') {
    for (const key of ['engine', 'version', 'migration_identity', 'restore_ref']) {
      if (!stringValue(item[key])) add(findings, 'MISSING_VALUE', `${path}/${key}`)
    }
  } else if (collection === 'zone_identifiers') {
    if (!stringValue(item.purpose)) add(findings, 'MISSING_VALUE', `${path}/purpose`)
  }
}

function validateCollection(value, collection, path, findings, repositoryRequired) {
  if (!exactKeys(value, ['applicability', 'items', 'evidence_status', 'evidence_refs'], path, findings)) return
  if (!APPLICABILITY.includes(value.applicability) || value.applicability === 'unknown') add(findings, 'INVALID_APPLICABILITY', `${path}/applicability`)
  validateStatus(value.evidence_status, value.evidence_refs, path, findings, { requireDeployment: true })
  rejectUnknownObservation(value.evidence_status, [value.items], path, findings)
  if (!Array.isArray(value.items)) {
    add(findings, 'INVALID_TYPE', `${path}/items`)
    return
  }
  if (value.applicability === 'applicable' && value.items.length === 0) add(findings, 'MISSING_VALUE', `${path}/items`)
  if (value.applicability === 'not_applicable' && value.items.length !== 0) add(findings, 'CONTRADICTORY_VALUE', `${path}/items`)
  const ids = new Set()
  value.items.forEach((item, index) => {
    validateItem(item, collection, `${path}/items/${index}`, findings, { repositoryRequired })
    if (plainObject(item) && stringValue(item.id)) {
      if (ids.has(item.id)) add(findings, 'DUPLICATE_ID', `${path}/items/${index}/id`)
      ids.add(item.id)
    }
  })
}

function validateComponent(value, path, findings, { expectedRepository, additional = false }) {
  const keys = additional
    ? [...COMPONENT_KEYS, 'component_id', 'repository_not_applicable_reason']
    : COMPONENT_KEYS
  if (!exactKeys(value, keys, path, findings)) return { applicable: false }
  if (additional && !stringValue(value.component_id)) add(findings, 'MISSING_VALUE', `${path}/component_id`)
  if (expectedRepository !== undefined && value.repository !== expectedRepository) add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', `${path}/repository`)
  const repositoryRequired = stringValue(value.repository)
  if (!repositoryRequired && !(additional && stringValue(value.repository_not_applicable_reason))) {
    add(findings, 'MISSING_VALUE', `${path}/repository`)
  }
  if (!validTimestamp(value.observed_at)) add(findings, 'INVALID_TIMESTAMP', `${path}/observed_at`)
  if (!exactKeys(value.applicability, ['value', 'reason', 'evidence_status', 'evidence_refs'], `${path}/applicability`, findings)) return { applicable: false }
  if (!APPLICABILITY.includes(value.applicability.value) || value.applicability.value === 'unknown') {
    add(findings, 'INVALID_APPLICABILITY', `${path}/applicability/value`)
  }
  validateStatus(value.applicability.evidence_status, value.applicability.evidence_refs, `${path}/applicability`, findings, { requireDeployment: true })
  const applicable = value.applicability.value === 'applicable'
  if (value.applicability.value === 'not_applicable' && !stringValue(value.applicability.reason)) {
    add(findings, 'NOT_APPLICABLE_REASON_REQUIRED', `${path}/applicability/reason`)
  }
  if (!exactKeys(value.repository_revision, ['value', 'dirty', 'evidence_status', 'evidence_refs'], `${path}/repository_revision`, findings)) return { applicable }
  if (applicable) {
    if (repositoryRequired && !fullRevision(value.repository_revision.value)) add(findings, 'INVALID_REVISION', `${path}/repository_revision/value`)
    if (!repositoryRequired && value.repository_revision.value !== null) add(findings, 'CONTRADICTORY_VALUE', `${path}/repository_revision/value`)
    if (value.repository_revision.dirty !== false) add(findings, 'MUTABLE_REVISION', `${path}/repository_revision/dirty`)
    validateStatus(value.repository_revision.evidence_status, value.repository_revision.evidence_refs, `${path}/repository_revision`, findings, { requireDeployment: true })
  } else {
    if (!empty(value.repository_revision?.value) || !empty(value.repository_revision?.dirty) || value.repository_revision?.evidence_status !== 'Unknown') {
      add(findings, 'CONTRADICTORY_VALUE', `${path}/repository_revision`)
    }
  }
  for (const collection of COLLECTIONS) {
    validateCollection(value[collection], collection, `${path}/${collection}`, findings, repositoryRequired)
    if (!applicable && value[collection]?.applicability !== 'not_applicable') {
      add(findings, 'CONTRADICTORY_VALUE', `${path}/${collection}/applicability`)
    }
  }
  return { applicable, repositoryRequired }
}

function validateObservation(value, expectedKeys, path, findings, profile, componentIds) {
  if (!exactKeys(value, expectedKeys, path, findings)) return
  if (value.profile !== undefined && value.profile !== profile) add(findings, 'PROFILE_MISMATCH', `${path}/profile`)
  if (value.component_ids !== undefined) {
    if (!Array.isArray(value.component_ids) || value.component_ids.length === 0) add(findings, 'MISSING_VALUE', `${path}/component_ids`)
    else {
      if (new Set(value.component_ids).size !== value.component_ids.length) add(findings, 'DUPLICATE_ID', `${path}/component_ids`)
      value.component_ids.forEach((id, index) => {
        if (!componentIds.has(id)) add(findings, 'UNKNOWN_COMPONENT', `${path}/component_ids/${index}`)
      })
    }
  }
  for (const key of ['command_or_request', 'sanitized_input_ref', 'actual_observation', 'observed_result', 'negative_side_effect_observation']) {
    if (Object.hasOwn(value, key) && !stringValue(value[key])) add(findings, 'MISSING_VALUE', `${path}/${key}`)
  }
  if (Object.hasOwn(value, 'procedure_ref') && !stringValue(value.procedure_ref)) add(findings, 'MISSING_VALUE', `${path}/procedure_ref`)
  if (!validTimestamp(value.started_at)) add(findings, 'INVALID_TIMESTAMP', `${path}/started_at`)
  if (!validTimestamp(value.finished_at)) add(findings, 'INVALID_TIMESTAMP', `${path}/finished_at`)
  if (compareTimestamps(value.started_at, value.finished_at) === 1) add(findings, 'TIMESTAMP_ORDER', `${path}/finished_at`)
  if (!RESULTS.includes(value.result)) add(findings, 'INVALID_RESULT', `${path}/result`)
  if (Object.hasOwn(value, 'exit_or_status_code') && !['string', 'number'].includes(typeof value.exit_or_status_code)) add(findings, 'INVALID_TYPE', `${path}/exit_or_status_code`)
  validateStatus(value.evidence_status, value.evidence_refs, path, findings, { requireDeployment: true })
  rejectUnknownObservation(
    value.evidence_status,
    [value.started_at, value.finished_at, value.result, value.actual_observation, value.observed_result],
    path,
    findings,
  )
}

function validateAssignmentIdentity(value, path, findings) {
  if (!exactKeys(value, ['revision', 'artifact_digest'], path, findings)) return false
  if (!immutableIdentity(value.revision)) add(findings, 'INVALID_REVISION', `${path}/revision`)
  validateDigest(value.artifact_digest, `${path}/artifact_digest`, findings)
  return immutableIdentity(value.revision) &&
    plainObject(value.artifact_digest) &&
    value.artifact_digest.algorithm === 'sha256' &&
    sha256(value.artifact_digest.value)
}

function validateTemplateSeed(record, findings) {
  const baseline = record.baseline
  if (!exactKeys(baseline, ['baseline_id', 'baseline_revision', 'collected_at', 'collector_role', 'evidence_bundle_ref', 'evidence_bundle_digest', 'environment', 'components', 'additional_components'], '/baseline', findings)) return
  for (const key of ['baseline_id', 'baseline_revision', 'collected_at', 'collector_role', 'evidence_bundle_ref']) {
    if (baseline[key] !== null) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/baseline/${key}`)
  }
  if (!same(baseline.evidence_bundle_digest, { algorithm: 'sha256', value: null })) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', '/baseline/evidence_bundle_digest')
  if (!same(baseline.environment.environment_label, { value: null, evidence_status: 'Unknown', evidence_refs: [] })) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', '/baseline/environment/environment_label')
  const profile = baseline.environment.profile
  if (profile.value !== null || profile.applicability !== 'unknown' || profile.evidence_status !== 'Unknown' || !same(profile.evidence_refs, [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', '/baseline/environment/profile')
  if (!same(profile.allowed_values, PROFILES) || !same(profile.allowed_applicability_values, APPLICABILITY)) add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', '/baseline/environment/profile')
  if (!same(Object.keys(baseline.components ?? {}).sort(), Object.keys(REQUIRED_COMPONENTS).sort())) add(findings, 'REQUIRED_COMPONENT_MISMATCH', '/baseline/components')
  for (const [id, repository] of Object.entries(REQUIRED_COMPONENTS)) {
    const component = baseline.components?.[id]
    const path = `/baseline/components/${id}`
    if (!exactKeys(component, COMPONENT_KEYS, path, findings)) continue
    if (component.repository !== repository || component.required_by !== 'ADR005-B0-01') add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', path)
    if (component.observed_at !== null) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `${path}/observed_at`)
    if (!same(component.applicability, { value: 'unknown', reason: null, evidence_status: 'Unknown', evidence_refs: [] })) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `${path}/applicability`)
    if (!same(component.repository_revision, { value: null, dirty: null, evidence_status: 'Unknown', evidence_refs: [] })) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `${path}/repository_revision`)
    for (const collection of COLLECTIONS) {
      if (!same(component[collection], { applicability: 'unknown', items: [], evidence_status: 'Unknown', evidence_refs: [] })) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `${path}/${collection}`)
    }
  }
  if (!same(baseline.additional_components, [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', '/baseline/additional_components')

  const assembly = record.candidate_assembly
  if (assembly.assembly_id !== null || assembly.observed_at !== null || !same(assembly.component_assignments, [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', '/candidate_assembly')
  if (assembly.release_manifest_ref !== '#/source_cut/staged_candidate') add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', '/candidate_assembly/release_manifest_ref')
  if (!same(assembly.source_readiness, {
    dependency_order_ref: null,
    merged_to_declared_bases: null,
    unmerged_exception: { decision_ref: null, risk_owner_role: null },
    evidence_status: 'Unknown',
    evidence_refs: [],
  })) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', '/candidate_assembly/source_readiness')
  for (const collection of ['built_artifacts', 'runtime_versions']) {
    if (!same(assembly[collection], { items: [], evidence_status: 'Unknown', evidence_refs: [] })) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/candidate_assembly/${collection}`)
  }

  for (const id of CHECK_IDS) {
    const check = record.checks?.[id]
    if (!exactKeys(check, CHECK_KEYS, `/checks/${id}`, findings)) continue
    for (const key of CHECK_KEYS.filter((key) => !['definition_ref', 'component_ids', 'evidence_status', 'evidence_refs'].includes(key))) {
      if (check[key] !== null) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/checks/${id}/${key}`)
    }
    if (!same(check.component_ids, []) || check.evidence_status !== 'Unknown' || !same(check.evidence_refs, [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/checks/${id}`)
  }

  const matrix = record.mixed_version_matrix
  if (matrix.matrix_id !== null || matrix.candidate_assembly_ref !== '#/candidate_assembly' || !same(matrix.single_component_transition_rows, [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', '/mixed_version_matrix')
  if (!Array.isArray(matrix.rows) || matrix.rows.length !== 3) add(findings, 'REQUIRED_MATRIX_ROW_MISSING', '/mixed_version_matrix/rows')
  for (const [index, row] of (matrix.rows ?? []).entries()) {
    if (!exactKeys(row, MATRIX_ROW_KEYS, `/mixed_version_matrix/rows/${index}`, findings)) continue
    if (REQUIRED_MATRIX_ROWS[row.row_id] !== row.kind) add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', `/mixed_version_matrix/rows/${index}`)
    for (const key of MATRIX_ROW_KEYS.filter((key) => !['row_id', 'kind', 'component_assignments', 'evidence_status', 'evidence_refs'].includes(key))) {
      if (row[key] !== null) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/mixed_version_matrix/rows/${index}/${key}`)
    }
    if (!same(row.component_assignments, []) || row.evidence_status !== 'Unknown' || !same(row.evidence_refs, [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/mixed_version_matrix/rows/${index}`)
  }

  const rollback = record.rollback_rehearsal
  if (rollback.target_baseline_ref !== '#/baseline' || rollback.matrix_ref !== '#/mixed_version_matrix') add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', '/rollback_rehearsal')
  for (const key of ['change_window_ref', 'change_authorization_ref', 'operator_role', 'recovery_objective_seconds', 'actual_duration_seconds', 'pre_restore_smoke_run_ref', 'post_restore_smoke_run_ref']) {
    if (rollback[key] !== null) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/rollback_rehearsal/${key}`)
  }
  for (const key of ['dependency_order', 'stop_conditions', 'persistence_restore_plan_refs']) {
    if (!same(rollback[key], [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/rollback_rehearsal/${key}`)
  }
  for (const id of ROLLBACK_IDS) {
    const step = rollback.steps?.[id]
    if (!exactKeys(step, ROLLBACK_STEP_KEYS, `/rollback_rehearsal/steps/${id}`, findings)) continue
    for (const key of ROLLBACK_STEP_KEYS.filter((key) => !['definition_ref', 'evidence_status', 'evidence_refs'].includes(key))) {
      if (step[key] !== null) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/rollback_rehearsal/steps/${id}/${key}`)
    }
    if (step.evidence_status !== 'Unknown' || !same(step.evidence_refs, [])) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/rollback_rehearsal/steps/${id}`)
  }
  for (const [id, refs] of Object.entries(REQUIRED_INPUTS)) {
    const input = record.required_live_inputs?.find((entry) => entry.id === id)
    if (!input || !same(input.field_refs, refs) || input.evidence_status !== 'Unknown' || !same(input.evidence_refs, []) || input.not_applicable_reason !== null) add(findings, 'TEMPLATE_OBSERVATION_PRESENT', `/required_live_inputs/${id}`)
  }
  if (!same(record.signoff, {
    assembly_entry: { decision: 'pending', criteria_result_refs: [], approved_by_role: null, approved_at: null },
    g3: { decision: 'pending', criteria_result_refs: [], approved_by_role: null, approved_at: null },
  })) add(findings, 'TEMPLATE_APPROVAL_PRESENT', '/signoff')
}

function validateComplete(record, findings) {
  const baseline = record.baseline
  if (!exactKeys(baseline, ['baseline_id', 'baseline_revision', 'collected_at', 'collector_role', 'evidence_bundle_ref', 'evidence_bundle_digest', 'environment', 'components', 'additional_components'], '/baseline', findings)) return
  if (!immutableIdentity(baseline.baseline_id)) add(findings, 'INVALID_IDENTITY', '/baseline/baseline_id')
  if (!immutableIdentity(baseline.baseline_revision)) add(findings, 'INVALID_IDENTITY', '/baseline/baseline_revision')
  if (!validTimestamp(baseline.collected_at)) add(findings, 'INVALID_TIMESTAMP', '/baseline/collected_at')
  if (!stringValue(baseline.collector_role)) add(findings, 'MISSING_VALUE', '/baseline/collector_role')
  if (!externalRef(baseline.evidence_bundle_ref)) add(findings, 'INVALID_REFERENCE', '/baseline/evidence_bundle_ref')
  validateDigest(baseline.evidence_bundle_digest, '/baseline/evidence_bundle_digest', findings)
  if (!exactKeys(baseline.environment, ['environment_label', 'profile'], '/baseline/environment', findings)) return
  if (!exactKeys(baseline.environment.environment_label, ['value', 'evidence_status', 'evidence_refs'], '/baseline/environment/environment_label', findings)) return
  if (!stringValue(baseline.environment.environment_label.value)) add(findings, 'MISSING_VALUE', '/baseline/environment/environment_label/value')
  validateStatus(baseline.environment.environment_label.evidence_status, baseline.environment.environment_label.evidence_refs, '/baseline/environment/environment_label', findings, { requireDeployment: true })
  rejectUnknownObservation(
    baseline.environment.environment_label.evidence_status,
    [baseline.environment.environment_label.value],
    '/baseline/environment/environment_label',
    findings,
  )
  if (!exactKeys(baseline.environment.profile, ['value', 'allowed_values', 'applicability', 'allowed_applicability_values', 'evidence_status', 'evidence_refs', 'architecture_model_ref'], '/baseline/environment/profile', findings)) return
  if (!PROFILES.includes(baseline.environment.profile.value)) add(findings, 'INVALID_PROFILE', '/baseline/environment/profile/value')
  if (baseline.environment.profile.applicability !== 'applicable') add(findings, 'INVALID_APPLICABILITY', '/baseline/environment/profile/applicability')
  validateStatus(baseline.environment.profile.evidence_status, baseline.environment.profile.evidence_refs, '/baseline/environment/profile', findings, { requireDeployment: true })
  rejectUnknownObservation(
    baseline.environment.profile.evidence_status,
    [baseline.environment.profile.value],
    '/baseline/environment/profile',
    findings,
  )

  if (!plainObject(baseline.components)) add(findings, 'INVALID_TYPE', '/baseline/components')
  const requiredIds = Object.keys(REQUIRED_COMPONENTS)
  if (!same(Object.keys(baseline.components ?? {}).sort(), requiredIds.sort())) add(findings, 'REQUIRED_COMPONENT_MISMATCH', '/baseline/components')
  const components = new Map()
  for (const [id, repository] of Object.entries(REQUIRED_COMPONENTS)) {
    const result = validateComponent(baseline.components?.[id], `/baseline/components/${id}`, findings, { expectedRepository: repository })
    if (baseline.components?.[id]) components.set(id, { value: baseline.components[id], ...result })
  }
  const additionalComponents = Array.isArray(baseline.additional_components)
    ? baseline.additional_components
    : []
  if (!Array.isArray(baseline.additional_components)) add(findings, 'INVALID_TYPE', '/baseline/additional_components')
  const additionalIds = new Set()
  for (const [index, component] of additionalComponents.entries()) {
    const result = validateComponent(component, `/baseline/additional_components/${index}`, findings, { additional: true })
    if (stringValue(component?.component_id)) {
      if (requiredIds.includes(component.component_id) || additionalIds.has(component.component_id)) add(findings, 'DUPLICATE_ID', `/baseline/additional_components/${index}/component_id`)
      additionalIds.add(component.component_id)
      components.set(component.component_id, { value: component, ...result })
    }
  }
  const applicableIds = [...components].filter(([, item]) => item.applicable).map(([id]) => id).sort()
  const profile = baseline.environment.profile.value

  const assembly = record.candidate_assembly
  if (!exactKeys(assembly, ['assembly_id', 'release_manifest_ref', 'source_readiness', 'built_artifacts', 'runtime_versions', 'component_assignments', 'observed_at'], '/candidate_assembly', findings)) return
  if (!immutableIdentity(assembly.assembly_id)) add(findings, 'INVALID_IDENTITY', '/candidate_assembly/assembly_id')
  if (assembly.release_manifest_ref !== '#/source_cut/staged_candidate') add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', '/candidate_assembly/release_manifest_ref')
  if (!validTimestamp(assembly.observed_at)) add(findings, 'INVALID_TIMESTAMP', '/candidate_assembly/observed_at')
  if (!exactKeys(assembly.source_readiness, ['dependency_order_ref', 'merged_to_declared_bases', 'unmerged_exception', 'evidence_status', 'evidence_refs'], '/candidate_assembly/source_readiness', findings)) return
  if (!stringValue(assembly.source_readiness.dependency_order_ref)) add(findings, 'MISSING_VALUE', '/candidate_assembly/source_readiness/dependency_order_ref')
  if (typeof assembly.source_readiness.merged_to_declared_bases !== 'boolean') add(findings, 'INVALID_TYPE', '/candidate_assembly/source_readiness/merged_to_declared_bases')
  if (!exactKeys(assembly.source_readiness.unmerged_exception, ['decision_ref', 'risk_owner_role'], '/candidate_assembly/source_readiness/unmerged_exception', findings)) return
  if (assembly.source_readiness.merged_to_declared_bases) {
    if (!empty(assembly.source_readiness.unmerged_exception.decision_ref) || !empty(assembly.source_readiness.unmerged_exception.risk_owner_role)) add(findings, 'CONTRADICTORY_VALUE', '/candidate_assembly/source_readiness/unmerged_exception')
  } else if (!stringValue(assembly.source_readiness.unmerged_exception.decision_ref) || !stringValue(assembly.source_readiness.unmerged_exception.risk_owner_role)) {
    add(findings, 'MISSING_VALUE', '/candidate_assembly/source_readiness/unmerged_exception')
  }
  validateStatus(assembly.source_readiness.evidence_status, assembly.source_readiness.evidence_refs, '/candidate_assembly/source_readiness', findings, { requireDeployment: true })
  for (const collection of ['built_artifacts', 'runtime_versions']) {
    if (!exactKeys(assembly[collection], ['items', 'evidence_status', 'evidence_refs'], `/candidate_assembly/${collection}`, findings)) continue
    const items = Array.isArray(assembly[collection].items) ? assembly[collection].items : []
    if (!Array.isArray(assembly[collection].items) || items.length === 0) add(findings, 'MISSING_VALUE', `/candidate_assembly/${collection}/items`)
    validateStatus(assembly[collection].evidence_status, assembly[collection].evidence_refs, `/candidate_assembly/${collection}`, findings, { requireDeployment: true })
    const itemKind = collection === 'built_artifacts' ? 'artifacts' : 'runtime_versions'
    for (const [index, item] of items.entries()) {
      validateItem(item, itemKind, `/candidate_assembly/${collection}/items/${index}`, findings, { repositoryRequired: true })
    }
  }
  const componentAssignments = Array.isArray(assembly.component_assignments)
    ? assembly.component_assignments
    : []
  if (!Array.isArray(assembly.component_assignments)) add(findings, 'INVALID_TYPE', '/candidate_assembly/component_assignments')
  const assignmentMap = new Map()
  for (const [index, assignment] of componentAssignments.entries()) {
    const path = `/candidate_assembly/component_assignments/${index}`
    if (!exactKeys(assignment, ['component_id', 'baseline', 'candidate', 'changed'], path, findings)) continue
    if (!components.has(assignment.component_id)) add(findings, 'UNKNOWN_COMPONENT', `${path}/component_id`)
    if (assignmentMap.has(assignment.component_id)) add(findings, 'DUPLICATE_ID', `${path}/component_id`)
    assignmentMap.set(assignment.component_id, assignment)
    const baselineValid = validateAssignmentIdentity(assignment.baseline, `${path}/baseline`, findings)
    const candidateValid = validateAssignmentIdentity(assignment.candidate, `${path}/candidate`, findings)
    if (typeof assignment.changed !== 'boolean') add(findings, 'INVALID_TYPE', `${path}/changed`)
    const componentRecord = components.get(assignment.component_id)
    const component = componentRecord?.value
    if (component && componentRecord.applicable && baselineValid) {
      const componentArtifacts = Array.isArray(component.artifacts?.items)
        ? component.artifacts.items
        : []
      const matchingArtifact = componentArtifacts.find((item) =>
        plainObject(item) && same(item.digest, assignment.baseline.artifact_digest),
      )
      if (!matchingArtifact) add(findings, 'ASSIGNMENT_MISMATCH', `${path}/baseline/artifact_digest`)
      const expectedRevision = componentRecord.repositoryRequired
        ? component.repository_revision.value
        : matchingArtifact?.source_revision ??
          (matchingArtifact?.digest?.value ? `sha256:${matchingArtifact.digest.value}` : undefined)
      if (expectedRevision !== assignment.baseline.revision) add(findings, 'ASSIGNMENT_MISMATCH', `${path}/baseline/revision`)
    }
    if (baselineValid && candidateValid && !assignment.changed && !same(assignment.baseline, assignment.candidate)) add(findings, 'ASSIGNMENT_MISMATCH', `${path}/candidate`)
    if (baselineValid && candidateValid && assignment.changed && same(assignment.baseline, assignment.candidate)) add(findings, 'ASSIGNMENT_MISMATCH', `${path}/changed`)
  }
  if (!same([...assignmentMap.keys()].sort(), applicableIds)) add(findings, 'ASSIGNMENT_MISMATCH', '/candidate_assembly/component_assignments')
  const changedIds = [...assignmentMap].filter(([, value]) => value.changed).map(([id]) => id).sort()
  if (changedIds.length === 0) add(findings, 'MISSING_CHANGED_COMPONENT', '/candidate_assembly/component_assignments')
  const builtArtifacts = Array.isArray(assembly.built_artifacts?.items)
    ? assembly.built_artifacts.items
    : []
  for (const componentId of changedIds) {
    const candidate = assignmentMap.get(componentId)?.candidate
    if (!plainObject(candidate)) continue
    const matched = builtArtifacts.some((artifact) => {
      if (!plainObject(artifact)) return false
      const artifactRevision = artifact.source_revision ??
        (artifact.digest?.value ? `sha256:${artifact.digest.value}` : undefined)
      return artifactRevision === candidate.revision && same(artifact.digest, candidate.artifact_digest)
    })
    if (!matched) add(findings, 'CANDIDATE_ARTIFACT_MISMATCH', '/candidate_assembly/built_artifacts/items')
  }

  if (!plainObject(record.checks) || !same(Object.keys(record.checks ?? {}).sort(), [...CHECK_IDS].sort())) add(findings, 'REQUIRED_CHECK_MISMATCH', '/checks')
  for (const id of CHECK_IDS) validateObservation(record.checks?.[id], CHECK_KEYS, `/checks/${id}`, findings, profile, new Set(applicableIds))

  const matrix = record.mixed_version_matrix
  if (!exactKeys(matrix, ['matrix_id', 'candidate_assembly_ref', 'single_component_transition_rows', 'rows'], '/mixed_version_matrix', findings)) return
  if (!immutableIdentity(matrix.matrix_id)) add(findings, 'INVALID_IDENTITY', '/mixed_version_matrix/matrix_id')
  if (matrix.candidate_assembly_ref !== '#/candidate_assembly') add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', '/mixed_version_matrix/candidate_assembly_ref')
  const matrixRows = Array.isArray(matrix.rows) ? matrix.rows : []
  const transitionIndex = Array.isArray(matrix.single_component_transition_rows)
    ? matrix.single_component_transition_rows
    : []
  if (!Array.isArray(matrix.rows) || !Array.isArray(matrix.single_component_transition_rows)) add(findings, 'INVALID_TYPE', '/mixed_version_matrix')
  const rows = new Map()
  for (const [index, row] of matrixRows.entries()) {
    const path = `/mixed_version_matrix/rows/${index}`
    if (!exactKeys(row, MATRIX_ROW_KEYS, path, findings)) continue
    if (!stringValue(row.row_id)) add(findings, 'MISSING_VALUE', `${path}/row_id`)
    if (rows.has(row.row_id)) add(findings, 'DUPLICATE_ID', `${path}/row_id`)
    rows.set(row.row_id, row)
    if (![...Object.values(REQUIRED_MATRIX_ROWS), 'single_component_transition'].includes(row.kind)) add(findings, 'INVALID_MATRIX_KIND', `${path}/kind`)
    if (!SUPPORT.includes(row.support_disposition)) add(findings, 'INVALID_SUPPORT_DISPOSITION', `${path}/support_disposition`)
    validateObservation(row, MATRIX_ROW_KEYS, path, findings, profile, new Set(applicableIds))
    const rowAssignments = new Map()
    const assignments = Array.isArray(row.component_assignments) ? row.component_assignments : []
    if (!Array.isArray(row.component_assignments)) add(findings, 'INVALID_TYPE', `${path}/component_assignments`)
    for (const [assignmentIndex, item] of assignments.entries()) {
      const assignmentPath = `${path}/component_assignments/${assignmentIndex}`
      if (!exactKeys(item, ['component_id', 'selection', 'revision', 'artifact_digest'], assignmentPath, findings)) continue
      if (!applicableIds.includes(item.component_id)) add(findings, 'UNKNOWN_COMPONENT', `${assignmentPath}/component_id`)
      if (rowAssignments.has(item.component_id)) add(findings, 'DUPLICATE_ID', `${assignmentPath}/component_id`)
      rowAssignments.set(item.component_id, item)
      if (!['b0', 'candidate'].includes(item.selection)) add(findings, 'INVALID_SELECTION', `${assignmentPath}/selection`)
      validateAssignmentIdentity(
        { revision: item.revision, artifact_digest: item.artifact_digest },
        assignmentPath,
        findings,
      )
      const expected = assignmentMap.get(item.component_id)?.[item.selection === 'b0' ? 'baseline' : 'candidate']
      if (expected && (item.revision !== expected.revision || !same(item.artifact_digest, expected.artifact_digest))) add(findings, 'ASSIGNMENT_MISMATCH', assignmentPath)
    }
    if (!same([...rowAssignments.keys()].sort(), applicableIds)) add(findings, 'ASSIGNMENT_MISMATCH', `${path}/component_assignments`)
    const candidateSelections = [...rowAssignments.values()].filter(({ selection }) => selection === 'candidate').map(({ component_id }) => component_id).sort()
    if (row.kind === 'all_b0' || row.kind === 'rollback_to_b0') {
      if (candidateSelections.length > 0) add(findings, 'MATRIX_CONTRADICTION', `${path}/component_assignments`)
    } else if (row.kind === 'all_candidate') {
      if (!same(candidateSelections, changedIds)) add(findings, 'MATRIX_CONTRADICTION', `${path}/component_assignments`)
    } else if (row.kind === 'single_component_transition') {
      if (candidateSelections.length !== 1 || !changedIds.includes(candidateSelections[0])) add(findings, 'MATRIX_CONTRADICTION', `${path}/component_assignments`)
    }
    if (row.support_disposition === 'unsupported' && row.result === 'pass') add(findings, 'RESULT_CONTRADICTION', `${path}/result`)
    if (row.support_disposition === 'excluded' && row.result !== 'blocked') add(findings, 'RESULT_CONTRADICTION', `${path}/result`)
  }
  for (const [rowId, kind] of Object.entries(REQUIRED_MATRIX_ROWS)) {
    if (rows.get(rowId)?.kind !== kind) add(findings, 'REQUIRED_MATRIX_ROW_MISSING', '/mixed_version_matrix/rows')
  }
  if (new Set(transitionIndex).size !== transitionIndex.length) {
    add(findings, 'DUPLICATE_ID', '/mixed_version_matrix/single_component_transition_rows')
  }
  const transitionIds = [...rows.values()].filter(({ kind }) => kind === 'single_component_transition').map(({ row_id }) => row_id).sort()
  if (!same([...new Set(transitionIndex)].sort(), transitionIds)) add(findings, 'TRANSITION_INDEX_MISMATCH', '/mixed_version_matrix/single_component_transition_rows')
  const transitionedComponents = transitionIds.map((id) => {
    const row = rows.get(id)
    return row?.component_assignments?.find(({ selection }) => selection === 'candidate')?.component_id
  }).filter(Boolean).sort()
  if (!same(transitionedComponents, changedIds)) add(findings, 'TRANSITION_COVERAGE_MISSING', '/mixed_version_matrix/rows')

  const rollback = record.rollback_rehearsal
  if (!exactKeys(rollback, ['target_baseline_ref', 'matrix_ref', 'change_window_ref', 'change_authorization_ref', 'operator_role', 'dependency_order', 'recovery_objective_seconds', 'actual_duration_seconds', 'stop_conditions', 'persistence_restore_plan_refs', 'pre_restore_smoke_run_ref', 'post_restore_smoke_run_ref', 'steps'], '/rollback_rehearsal', findings)) return
  if (rollback.target_baseline_ref !== '#/baseline' || rollback.matrix_ref !== '#/mixed_version_matrix') add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', '/rollback_rehearsal')
  for (const key of ['change_window_ref', 'change_authorization_ref', 'operator_role', 'pre_restore_smoke_run_ref', 'post_restore_smoke_run_ref']) if (!stringValue(rollback[key])) add(findings, 'MISSING_VALUE', `/rollback_rehearsal/${key}`)
  if (rollback.pre_restore_smoke_run_ref === rollback.post_restore_smoke_run_ref) add(findings, 'ROLLBACK_CONTRADICTION', '/rollback_rehearsal/post_restore_smoke_run_ref')
  if (!Array.isArray(rollback.dependency_order) || !same([...new Set(rollback.dependency_order)].sort(), applicableIds)) add(findings, 'ROLLBACK_COMPONENT_MISMATCH', '/rollback_rehearsal/dependency_order')
  if (!Number.isFinite(rollback.recovery_objective_seconds) || rollback.recovery_objective_seconds <= 0) add(findings, 'INVALID_DURATION', '/rollback_rehearsal/recovery_objective_seconds')
  if (!Number.isFinite(rollback.actual_duration_seconds) || rollback.actual_duration_seconds < 0) add(findings, 'INVALID_DURATION', '/rollback_rehearsal/actual_duration_seconds')
  if (!Array.isArray(rollback.stop_conditions) || rollback.stop_conditions.length === 0 || !rollback.stop_conditions.every(stringValue)) add(findings, 'MISSING_VALUE', '/rollback_rehearsal/stop_conditions')
  if (!Array.isArray(rollback.persistence_restore_plan_refs) || rollback.persistence_restore_plan_refs.length === 0) add(findings, 'MISSING_VALUE', '/rollback_rehearsal/persistence_restore_plan_refs')
  else validateRefs(rollback.persistence_restore_plan_refs, '/rollback_rehearsal/persistence_restore_plan_refs', findings, { required: true })
  if (!plainObject(rollback.steps) || !same(Object.keys(rollback.steps ?? {}).sort(), [...ROLLBACK_IDS].sort())) add(findings, 'REQUIRED_ROLLBACK_STEP_MISMATCH', '/rollback_rehearsal/steps')
  for (const id of ROLLBACK_IDS) validateObservation(rollback.steps?.[id], ROLLBACK_STEP_KEYS, `/rollback_rehearsal/steps/${id}`, findings, profile, new Set(applicableIds))
  if (ROLLBACK_IDS.every((id) => rollback.steps?.[id]?.result === 'pass') && rollback.actual_duration_seconds > rollback.recovery_objective_seconds) add(findings, 'RECOVERY_OBJECTIVE_EXCEEDED', '/rollback_rehearsal/actual_duration_seconds')

  const b0ChecksPass = CHECK_IDS
    .filter((id) => id.startsWith('B0-'))
    .every((id) => record.checks?.[id]?.result === 'pass' && record.checks?.[id]?.evidence_status === 'Confirmed-Deployment')
  const allChecksPass = CHECK_IDS.every((id) =>
    record.checks?.[id]?.result === 'pass' &&
    record.checks?.[id]?.evidence_status === 'Confirmed-Deployment',
  )
  const supportedRowsPass = [...rows.values()].every((row) =>
    row.support_disposition === 'supported' ? row.result === 'pass' : row.support_disposition === 'unsupported' ? ['fail', 'blocked'].includes(row.result) : row.result === 'blocked',
  )
  const mandatoryControlsPass = Object.keys(REQUIRED_MATRIX_ROWS).every((rowId) => {
    const row = rows.get(rowId)
    return row?.support_disposition === 'supported' &&
      row.result === 'pass' &&
      row.evidence_status === 'Confirmed-Deployment'
  })
  const rollbackPass = ROLLBACK_IDS.every((id) => rollback.steps?.[id]?.result === 'pass') && rollback.actual_duration_seconds <= rollback.recovery_objective_seconds
  const sourceReady = assembly.source_readiness.merged_to_declared_bases === true || (
    assembly.source_readiness.merged_to_declared_bases === false &&
    stringValue(assembly.source_readiness.unmerged_exception.decision_ref) &&
    stringValue(assembly.source_readiness.unmerged_exception.risk_owner_role)
  )
  exactKeys(record.signoff, ['assembly_entry', 'g3'], '/signoff', findings)
  for (const key of ['assembly_entry', 'g3']) {
    const signoff = record.signoff?.[key]
    const path = `/signoff/${key}`
    if (!exactKeys(signoff, ['decision', 'criteria_result_refs', 'approved_by_role', 'approved_at'], path, findings)) continue
    if (!SIGNOFF.includes(signoff.decision)) add(findings, 'INVALID_SIGNOFF', `${path}/decision`)
    validateRefs(signoff.criteria_result_refs, `${path}/criteria_result_refs`, findings, {
      required: signoff.decision !== 'pending',
    })
    if (signoff.decision === 'pending') {
      if ((signoff.criteria_result_refs ?? []).length > 0 || !empty(signoff.approved_by_role) || !empty(signoff.approved_at)) add(findings, 'SIGNOFF_CONTRADICTION', path)
    } else {
      if (!stringValue(signoff.approved_by_role) || !validTimestamp(signoff.approved_at)) add(findings, 'SIGNOFF_METADATA_REQUIRED', path)
    }
    if (signoff.decision === 'approved') {
      const prerequisitesPass = key === 'assembly_entry'
        ? b0ChecksPass && sourceReady
        : record.signoff?.assembly_entry?.decision === 'approved' &&
          allChecksPass &&
          supportedRowsPass &&
          mandatoryControlsPass &&
          rollbackPass
      if (!prerequisitesPass) add(findings, 'APPROVAL_CONTRADICTION', path)
    }
  }
}

function pointerSegments(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('#/')) return null
  return pointer.slice(2).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function resolvePointer(root, pointer, { allowWildcard = false } = {}) {
  const segments = pointerSegments(pointer)
  if (!segments) return []
  let values = [root]
  for (const segment of segments) {
    const next = []
    for (const value of values) {
      if (segment === '*') {
        if (!allowWildcard || !plainObject(value)) return []
        next.push(...Object.values(value))
      } else if (Array.isArray(value) && /^(0|[1-9]\d*)$/.test(segment)) {
        if (Number(segment) >= value.length) return []
        next.push(value[Number(segment)])
      } else if (plainObject(value) && Object.hasOwn(value, segment)) next.push(value[segment])
      else return []
    }
    values = next
  }
  return values
}

const SAFE_PATH_SEGMENTS = new Set([
  ...ROOT_KEYS,
  ...COMPONENT_KEYS,
  ...CHECK_KEYS,
  ...MATRIX_ROW_KEYS,
  ...ROLLBACK_STEP_KEYS,
  ...Object.values(ITEM_KEYS).flat(),
  ...Object.keys(REQUIRED_COMPONENTS),
  ...CHECK_IDS,
  ...ROLLBACK_IDS,
  ...Object.keys(REQUIRED_INPUTS),
  'environment', 'environment_label', 'profile', 'value', 'reason', 'dirty', 'items',
  'algorithm', 'component_id', 'repository_not_applicable_reason', 'baseline', 'candidate',
  'changed', 'revision', 'artifact_digest', 'source_readiness', 'unmerged_exception',
  'decision_ref', 'risk_owner_role', 'built_artifacts', 'component_assignments', 'selection',
  'matrix_id', 'candidate_assembly_ref', 'single_component_transition_rows', 'rows',
  'target_baseline_ref', 'matrix_ref', 'change_window_ref', 'change_authorization_ref',
  'operator_role', 'dependency_order', 'recovery_objective_seconds', 'actual_duration_seconds',
  'stop_conditions', 'persistence_restore_plan_refs', 'pre_restore_smoke_run_ref',
  'post_restore_smoke_run_ref', 'steps', 'field_refs', 'not_applicable_reason',
  'assembly_entry', 'g3', 'decision', 'criteria_result_refs', 'approved_by_role', 'approved_at',
])

function safeSegment(key) {
  return SAFE_PATH_SEGMENTS.has(key) ? key : '<key>'
}

function deploymentEvidenceReference(root, ref, seen = new Set()) {
  if (externalRef(ref)) return !sourceOnlyExternalRef(ref)
  if (typeof ref !== 'string' || !ref.startsWith('#/') || seen.has(ref)) return false
  seen.add(ref)
  const targets = resolvePointer(root, ref)
  if (targets.length !== 1 || !plainObject(targets[0])) return false
  const target = targets[0]
  if (target.evidence_status !== 'Confirmed-Deployment' || !Array.isArray(target.evidence_refs)) {
    return false
  }
  return target.evidence_refs.some((nested) => deploymentEvidenceReference(root, nested, seen))
}

function terminalEvidence(root, pointer, seen) {
  if (seen.has(pointer)) return false
  seen.add(pointer)
  const targets = resolvePointer(root, pointer)
  if (targets.length !== 1) return false
  const target = targets[0]
  if (!plainObject(target) || !Array.isArray(target.evidence_refs)) return false
  return target.evidence_refs.some((ref) =>
    externalRef(ref) || (typeof ref === 'string' && ref.startsWith('#/') && terminalEvidence(root, ref, seen)),
  )
}

function validateInternalReferences(record, findings) {
  const visit = (value, path) => {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}/${index}`))
    if (!plainObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${safeSegment(key)}`
      if (key === 'field_refs' && Array.isArray(child)) {
        child.forEach((ref, index) => {
          if (resolvePointer(record, ref, { allowWildcard: true }).length === 0) add(findings, 'DANGLING_INTERNAL_REF', `${childPath}/${index}`)
        })
      } else if (key === 'evidence_refs' && Array.isArray(child)) {
        child.forEach((ref, index) => {
          if (typeof ref === 'string' && ref.startsWith('#/')) {
            if (resolvePointer(record, ref).length !== 1) add(findings, 'DANGLING_INTERNAL_REF', `${childPath}/${index}`)
            else if (!terminalEvidence(record, ref, new Set())) add(findings, 'CIRCULAR_EVIDENCE_REF', `${childPath}/${index}`)
          }
        })
        if (
          value.evidence_status === 'Confirmed-Deployment' &&
          !child.some((ref) => deploymentEvidenceReference(record, ref))
        ) {
          add(findings, 'SOURCE_ONLY_EVIDENCE', childPath)
        }
      } else if (key.endsWith('_ref') && typeof child === 'string' && child.startsWith('#/')) {
        if (resolvePointer(record, child).length !== 1) add(findings, 'DANGLING_INTERNAL_REF', childPath)
      } else if (key.endsWith('_refs') && Array.isArray(child) && key !== 'evidence_refs' && key !== 'field_refs') {
        child.forEach((ref, index) => {
          if (typeof ref === 'string' && ref.startsWith('#/') && resolvePointer(record, ref).length !== 1) add(findings, 'DANGLING_INTERNAL_REF', `${childPath}/${index}`)
        })
      }
      visit(child, childPath)
    }
  }
  visit(record, '')
}

function claimedStatusCounts(record) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]))
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!plainObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence_status' && Object.hasOwn(counts, child)) counts[child]++
      visit(child)
    }
  }
  visit(record)
  return counts
}

function validateCanonical(record, canonical, findings) {
  if (!exactKeys(record, ROOT_KEYS, '', findings)) return
  if (record.record_format !== FORMAT) add(findings, 'INVALID_FORMAT', '/record_format')
  if (!same(record.allowed_evidence_statuses, STATUSES)) add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', '/allowed_evidence_statuses')
  for (const key of STATIC_KEYS) {
    if (!same(record[key], canonical[key])) add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', `/${key}`)
  }
  if (!plainObject(record.checks) || !same(Object.keys(record.checks ?? {}).sort(), [...CHECK_IDS].sort())) add(findings, 'REQUIRED_CHECK_MISMATCH', '/checks')
  if (!plainObject(record.rollback_rehearsal?.steps) || !same(Object.keys(record.rollback_rehearsal.steps).sort(), [...ROLLBACK_IDS].sort())) add(findings, 'REQUIRED_ROLLBACK_STEP_MISMATCH', '/rollback_rehearsal/steps')
  const inputs = Array.isArray(record.required_live_inputs) ? record.required_live_inputs : []
  const inputMap = new Map()
  for (const [index, input] of inputs.entries()) {
    if (!plainObject(input) || !stringValue(input.id)) {
      add(findings, 'INVALID_TYPE', `/required_live_inputs/${index}`)
      continue
    }
    exactKeys(
      input,
      ['id', 'field_refs', 'evidence_status', 'evidence_refs', 'not_applicable_reason'],
      `/required_live_inputs/${index}`,
      findings,
    )
    if (inputMap.has(input.id)) add(findings, 'DUPLICATE_ID', `/required_live_inputs/${index}/id`)
    inputMap.set(input.id, input)
  }
  if (!same([...inputMap.keys()].sort(), Object.keys(REQUIRED_INPUTS).sort())) add(findings, 'REQUIRED_INPUT_MISMATCH', '/required_live_inputs')
  for (const [id, refs] of Object.entries(REQUIRED_INPUTS)) {
    if (!same(inputMap.get(id)?.field_refs, refs)) add(findings, 'AUTHORITATIVE_MAPPING_CHANGED', `/required_live_inputs/${id}/field_refs`)
  }
}

export function validateB0Record(record, { mode, canonicalTemplate }) {
  const findings = []
  if (!['template', 'record'].includes(mode)) {
    add(findings, 'INVALID_MODE', '/')
    return { valid: false, mode: 'invalid', structural_state: 'invalid', observations_authenticated: false, approval_granted: false, claimed_status_counts: {}, findings }
  }
  if (!plainObject(record) || !plainObject(canonicalTemplate)) {
    add(findings, 'INVALID_TYPE', '/')
    return { valid: false, mode, structural_state: 'invalid', observations_authenticated: false, approval_granted: false, claimed_status_counts: {}, findings }
  }
  validateCanonical(record, canonicalTemplate, findings)
  validateInternalReferences(record, findings)
  if (mode === 'template') {
    if (record.record_state !== 'template') add(findings, 'INVALID_RECORD_STATE', '/record_state')
    if (!same(record, canonicalTemplate)) add(findings, 'TEMPLATE_DRIFT', '/')
    validateTemplateSeed(record, findings)
  } else {
    if (record.record_state !== 'complete') add(findings, 'INCOMPLETE_RECORD', '/record_state')
    validateComplete(record, findings)
    const liveInputs = Array.isArray(record.required_live_inputs) ? record.required_live_inputs : []
    const inputMap = new Map(liveInputs.filter(plainObject).map((input) => [input.id, input]))
    for (const id of Object.keys(REQUIRED_INPUTS)) {
      const input = inputMap.get(id)
      if (!input) continue
      validateStatus(input.evidence_status, input.evidence_refs, `/required_live_inputs/${id}`, findings, { requireDeployment: true })
      if (input.evidence_status === 'Unknown' && (!empty(input.not_applicable_reason) || (input.evidence_refs ?? []).length > 0)) add(findings, 'UNKNOWN_WITH_OBSERVATION', `/required_live_inputs/${id}`)
      if (input.evidence_status === 'Confirmed-Deployment' && input.not_applicable_reason !== null && !stringValue(input.not_applicable_reason)) add(findings, 'NOT_APPLICABLE_REASON_REQUIRED', `/required_live_inputs/${id}/not_applicable_reason`)
    }
  }
  const counts = claimedStatusCounts(record)
  return {
    valid: findings.length === 0,
    mode,
    structural_state: findings.length === 0 ? (mode === 'template' ? 'template_valid' : 'record_structurally_valid') : 'invalid',
    observations_authenticated: false,
    approval_granted: false,
    claimed_status_counts: counts,
    recorded_signoff: plainObject(record.signoff)
      ? { assembly_entry: record.signoff.assembly_entry?.decision ?? 'invalid', g3: record.signoff.g3?.decision ?? 'invalid' }
      : { assembly_entry: 'invalid', g3: 'invalid' },
    findings,
  }
}

function printResult(result) {
  if (result.valid) {
    const counts = STATUSES.map((status) => `${status}=${result.claimed_status_counts[status] ?? 0}`).join(',')
    console.log(
      `B0 preflight OK mode=${result.mode} structural_state=${result.structural_state} ` +
      `observations_authenticated=false approval_granted=false claimed_statuses=${counts}`,
    )
    return
  }
  console.error(`B0 preflight FAIL mode=${result.mode} findings=${result.findings.length}`)
  for (const item of result.findings) console.error(`${item.code} ${item.path || '/'}`)
}

function main() {
  const args = process.argv.slice(2)
  let mode
  let inputPath
  if (args.length === 1 && args[0] === '--template') {
    mode = 'template'
    inputPath = join(REPO, TEMPLATE_PATH)
  } else if (args.length === 2 && args[0] === '--record') {
    mode = 'record'
    inputPath = resolve(args[1])
  } else {
    console.error('B0 preflight usage error')
    process.exit(2)
  }
  let canonicalTemplate
  let record
  try {
    canonicalTemplate = JSON.parse(readFileSync(join(REPO, TEMPLATE_PATH), 'utf8'))
    const bytes = readFileSync(inputPath)
    if (bytes.length > 2 * 1024 * 1024) throw new Error('oversize')
    record = JSON.parse(bytes.toString('utf8'))
  } catch {
    printResult({ valid: false, mode, findings: [{ code: 'INVALID_JSON_OR_INPUT', path: '/' }] })
    process.exit(1)
  }
  const result = validateB0Record(record, { mode, canonicalTemplate })
  printResult(result)
  process.exit(result.valid ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
