/** Deployment configuration is separate from tenant-editable policy. */
export const POLICY_FILENAME = 'egress-policy.json'
export const POLICY_ENVIRONMENT = 'NEXUS_EGRESS_GATE_CONFIG'
export { EgressPolicyRepository, EgressPolicyConflict } from './repository.js'
function freezeDefaults(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeDefaults(child)
  return Object.freeze(value)
}
export const DEFAULT_POLICY = freezeDefaults({
  version: 1, revision: 0, enabled: false, mode: 'redact',
  modelMounts: [], a2aMounts: [], analyzer: null,
  businessPolicy: { version: 1, public_organizations: [], protected_terms: [], protected_markers: [] },
})

const fields = Object.keys(DEFAULT_POLICY)
const businessFields = Object.keys(DEFAULT_POLICY.businessPolicy)
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid egress policy fields')
}
function list(value, max, item) {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length ||
    value.some(entry => typeof entry !== 'string' || !item(entry))) throw new Error('Invalid egress policy list')
}
function mount(value) {
  return new TextEncoder().encode(value).length <= 1024 && value.startsWith('/') && value !== '/' && !value.endsWith('/') &&
    !value.startsWith('/__sys__') && value.split('/').slice(1).every(part => part && part !== '.' && part !== '..') &&
    !/[\u0000-\u001f\u007f\\]/u.test(value)
}

/** Validate the complete wire document; invalid values never become defaults. */
export function parseEgressPolicy(input) {
  record(input, fields)
  if (fields.some(key => !(key in input)) || input.version !== 1 || !Number.isSafeInteger(input.revision) ||
    input.revision < 0 || typeof input.enabled !== 'boolean' || !['redact', 'deny', 'observe'].includes(input.mode)) {
    throw new Error('Invalid egress policy version, revision or mode')
  }
  list(input.modelMounts, 256, mount)
  list(input.a2aMounts, 256, mount)
  if (input.enabled && !input.modelMounts.length && !input.a2aMounts.length) throw new Error('Enabled egress policy requires an outbound mount')
  record(input.businessPolicy, businessFields)
  if (businessFields.some(key => !(key in input.businessPolicy)) || input.businessPolicy.version !== 1) throw new Error('Invalid business policy version')
  for (const field of businessFields.filter(key => key !== 'version')) {
    list(input.businessPolicy[field], 10000, value => value.trim().length > 0 && [...value].length <= 512)
  }
  if (input.analyzer === null && businessFields.filter(key => key !== 'version').some(key => input.businessPolicy[key].length)) {
    throw new Error('Business policy requires the local analyzer')
  }
  if (input.analyzer !== null) {
    const keys = ['url', 'language', 'scoreThreshold', 'entities', 'timeoutMs']
    record(input.analyzer, keys)
    const analyzer = input.analyzer
    let url
    try { url = new URL(analyzer.url) } catch { throw new Error('Invalid local analyzer URL') }
    if (keys.some(key => !(key in analyzer)) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash ||
      !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || !url.port ||
      !['zh', 'en'].includes(analyzer.language) || !Number.isFinite(analyzer.scoreThreshold) || analyzer.scoreThreshold < 0 || analyzer.scoreThreshold > 1 ||
      !Number.isSafeInteger(analyzer.timeoutMs) || analyzer.timeoutMs < 1 || analyzer.timeoutMs > 60000) throw new Error('Invalid local analyzer configuration')
    list(analyzer.entities, 256, value => /^[A-Z][A-Z0-9_]{0,63}$/.test(value))
  }
  if (new TextEncoder().encode(JSON.stringify(input)).length > 1024 * 1024) throw new Error('Egress policy exceeds size limit')
  return structuredClone(input)
}

/** Produce a complete deployment document without modifying caller-owned values. */
export function createEgressPolicy(overrides = {}) {
  return parseEgressPolicy({ ...structuredClone(DEFAULT_POLICY), ...overrides })
}

/** Do not claim that delivery means enforcement; runtime revision must agree. */
export function policyApplicationStatus(desired, actual) {
  const policy = parseEgressPolicy(desired)
  if (!actual) return { state: 'pending', desiredRevision: policy.revision, appliedRevision: null }
  if (actual.error) return { state: 'error', desiredRevision: policy.revision, appliedRevision: actual.revision ?? null }
  const isApplied = actual.revision === policy.revision && actual.enabled === policy.enabled && actual.mode === policy.mode &&
    JSON.stringify(actual.modelMounts) === JSON.stringify(policy.modelMounts) && JSON.stringify(actual.a2aMounts) === JSON.stringify(policy.a2aMounts)
  return { state: isApplied ? 'applied' : 'pending', desiredRevision: policy.revision, appliedRevision: actual.revision ?? null }
}

/** Runtime status is read through the existing authenticated Nexus Call surface. */
export async function readEgressPolicyStatus(client, authToken) {
  const raw = await client.call('egress_gate.get_policy_status_v1', '{}', authToken)
  const envelope = JSON.parse(raw)
  if (envelope?.error) throw new Error('Runtime could not report egress policy status')
  const status = envelope?.result ?? envelope
  if (!status || status.version !== 1 || !Number.isSafeInteger(status.revision) || typeof status.enabled !== 'boolean' ||
    !['redact', 'deny', 'observe'].includes(status.mode)) throw new Error('Invalid runtime egress policy status')
  list(status.modelMounts, 256, mount)
  list(status.a2aMounts, 256, mount)
  if (status.revision < 0 || !(status.error === null || typeof status.error === 'string')) throw new Error('Invalid runtime egress policy status')
  return { version: 1, revision: status.revision, enabled: status.enabled, mode: status.mode,
    modelMounts: [...status.modelMounts], a2aMounts: [...status.a2aMounts], error: status.error }
}
