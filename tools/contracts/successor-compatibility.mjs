#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, types } from 'node:util'
import { visit } from 'jsonc-parser'

import { compareSchemas } from './compatibility.mjs'
import {
  BASELINE_PATH, HISTORICAL_REVISION, expectedCurrentPackedPaths, sha256, verifyPackageBaseline,
} from './content-candidate.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CONTENT_C = '273fd4097cbc33c1c049c39bb1fb60cef2663e2b'
const REFERENCES = { '0.2.0': HISTORICAL_REVISION, '0.2.1': CONTENT_C }
const SCHEMAS = {
  zone_id: 'contracts/zone-id/schema.gen.json',
  zone_path: 'contracts/zone-path/schema.gen.json',
  resource_ref: 'contracts/common/v1/resource-ref/schema.gen.json',
}
const MAX_BYTES = 1024 * 1024
const MAX_NODES = 20000
const MAX_FINDINGS = 100
const equal = isDeepStrictEqual
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const commitSha = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
const digest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const safePath = (value) => typeof value === 'string' && value.length <= 240 &&
  value.split('/').every((part) => /^(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/.test(part))
const noAdmission = () => ({
  release_admission: false,
  consumer_adoption_verified: false,
  deployment_verified: false,
  semantic_compatibility_verified: false,
  resource_ref: 'deferred_manual_semantic_review',
})

class InvalidInput extends Error {
  constructor(rule) { super(rule); this.rule = rule }
}
const requireInput = (condition, rule) => { if (!condition) throw new InvalidInput(rule) }

function boundedJson(value) {
  let nodes = 0
  let bytes = 0
  function copy(input, depth) {
    requireInput(++nodes <= MAX_NODES && depth <= 32, 'input_limit')
    if (typeof input === 'string') {
      bytes += Buffer.byteLength(input)
      requireInput(bytes <= MAX_BYTES, 'input_limit')
      return input
    }
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number') {
      requireInput(Number.isFinite(input), 'invalid_json_value')
      return input
    }
    requireInput(typeof input === 'object' && !types.isProxy(input), 'invalid_json_value')
    requireInput([Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(input)), 'invalid_json_value')
    const array = Array.isArray(input)
    const descriptors = Object.getOwnPropertyDescriptors(input)
    requireInput(Reflect.ownKeys(descriptors).length <= MAX_NODES, 'input_limit')
    const result = array ? [] : {}
    let count = 0
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue
      requireInput(typeof key === 'string', 'invalid_json_value')
      const descriptor = descriptors[key]
      requireInput(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'invalid_json_value')
      if (array) requireInput(key === String(count++), 'invalid_json_value')
      bytes += Buffer.byteLength(key)
      requireInput(bytes <= MAX_BYTES, 'input_limit')
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true })
    }
    if (array) requireInput(count === input.length, 'invalid_json_value')
    return result
  }
  return copy(value, 0)
}

function parseJson(bytes) {
  requireInput(bytes.length <= MAX_BYTES, 'input_limit')
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new InvalidInput('invalid_json') }
  const stack = []
  let nodes = 0
  const enter = (keys) => {
    requireInput(++nodes <= MAX_NODES && stack.length < 32, 'input_limit')
    stack.push(keys)
  }
  visit(text, {
    onObjectBegin: () => enter(new Set()),
    onObjectProperty: (key) => {
      requireInput(!stack.at(-1).has(key), 'duplicate_json_key')
      stack.at(-1).add(key)
      requireInput(++nodes <= MAX_NODES, 'input_limit')
    },
    onObjectEnd: () => stack.pop(),
    onArrayBegin: () => enter(null),
    onArrayEnd: () => stack.pop(),
    onLiteralValue: () => requireInput(++nodes <= MAX_NODES, 'input_limit'),
    onError: () => { throw new InvalidInput('invalid_json') },
  }, { disallowComments: true, allowTrailingComma: false })
  try { return boundedJson(JSON.parse(text)) } catch (error) {
    if (error instanceof InvalidInput) throw error
    throw new InvalidInput('invalid_json')
  }
}

const ANNOTATIONS = new Set(['$comment', 'description', 'title', 'examples', 'default', 'deprecated', 'readOnly', 'writeOnly'])
const MAPS = new Set(['properties', '$defs'])
const SINGLE = new Set(['items', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else'])
const ARRAYS = new Set(['allOf', 'anyOf', 'oneOf'])
const EXTENSIONS = new Set(['sudoZonePath', 'x-sudo-owner', 'x-sudo-semantics', 'x-sudo-contract-status',
  'x-sudo-primitive-validation', 'x-sudo-max-json-bytes', 'x-sudo-max-extension-depth'])
const STRINGS = new Set(['$id', '$schema', '$ref', 'pattern'])
const BOUNDS = new Set(['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'])
const KNOWN = new Set([...ANNOTATIONS, ...MAPS, ...SINGLE, ...ARRAYS, ...EXTENSIONS, ...STRINGS, ...BOUNDS,
  'type', 'const', 'enum', 'required'])
const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'])

function inspectSchema(schema, findings, family, location = '') {
  if (typeof schema === 'boolean') return
  requireInput(record(schema), 'malformed_schema')
  for (const [key, value] of Object.entries(schema)) {
    const path = `${location}/${KNOWN.has(key) ? key : '<unclassified-keyword>'}`
    if (!KNOWN.has(key)) {
      findings.push({ family, path, rule: 'unsupported_keyword', severity: 'manual_review' })
      // Unreviewed patternProperties must not execute regexes in the protected comparator.
      delete schema[key]
    } else if (MAPS.has(key)) {
      requireInput(record(value), 'malformed_schema')
      for (const item of Object.values(value)) inspectSchema(item, findings, family, `${path}/<member>`)
    } else if (SINGLE.has(key)) inspectSchema(value, findings, family, path)
    else if (ARRAYS.has(key)) {
      requireInput(Array.isArray(value) && value.length > 0, 'malformed_schema')
      for (const item of value) inspectSchema(item, findings, family, `${path}/<item>`)
    } else if (STRINGS.has(key)) requireInput(typeof value === 'string', 'malformed_schema')
    else if (BOUNDS.has(key)) requireInput(typeof value === 'number', 'malformed_schema')
    else if (key === 'type') {
      const values = Array.isArray(value) ? value : [value]
      requireInput(values.length > 0 && values.every((item) => JSON_TYPES.has(item)), 'malformed_schema')
    } else if (key === 'required') requireInput(Array.isArray(value) && value.every((item) => typeof item === 'string'), 'malformed_schema')
    else if (key === 'enum') requireInput(Array.isArray(value) && value.length > 0, 'malformed_schema')
    requireInput(findings.length <= MAX_FINDINGS, 'finding_limit')
  }
}

function annotationChanges(previous, candidate, findings, family, path = '') {
  if (!record(previous) || !record(candidate)) return
  for (const key of new Set([...Object.keys(previous), ...Object.keys(candidate)])) {
    const before = previous[key]
    const after = candidate[key]
    if (equal(before, after)) continue
    if (ANNOTATIONS.has(key) || EXTENSIONS.has(key)) {
      findings.push({ family, path: `${path}/${key}`, rule: 'annotation_or_policy_changed', severity: 'manual_review' })
    } else if (MAPS.has(key)) {
      for (const member of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
        annotationChanges(before?.[member], after?.[member], findings, family, `${path}/${key}/<member>`)
      }
    } else if (SINGLE.has(key)) annotationChanges(before, after, findings, family, `${path}/${key}`)
    else if (ARRAYS.has(key)) {
      for (let i = 0; i < Math.max(before?.length ?? 0, after?.length ?? 0); i++) {
        annotationChanges(before?.[i], after?.[i], findings, family, `${path}/${key}/<item>`)
      }
    }
    requireInput(findings.length <= MAX_FINDINGS, 'finding_limit')
  }
}

function direction(previous, candidate) {
  const result = compareSchemas(previous, candidate)
  requireInput(result.findings.length <= MAX_FINDINGS, 'finding_limit')
  return {
    status: result.status,
    findings: result.findings.map(({ severity, rule, path }) => ({
      severity, rule,
      path: path.split('/').map((part) => part === '' || KNOWN.has(part) ? part : '<member>').join('/'),
    })),
  }
}

export function compareSuccessorSchemas(previous, candidate) {
  const result = { ...noAdmission(), input_provenance: 'unverified_in_memory', local_objects_verified: false, families: {}, findings: [] }
  try {
    previous = boundedJson(previous)
    candidate = boundedJson(candidate)
    requireInput(record(candidate) && (previous === null || record(previous)), 'malformed_families')
    for (const value of [previous, candidate]) {
      if (value === null) continue
      if (!equal(Object.keys(value).sort(), Object.keys(SCHEMAS).sort())) {
        result.findings.push({ rule: 'family_set_changed_or_unsupported', severity: 'manual_review' })
      }
      for (const family of Object.keys(SCHEMAS)) {
        if (Object.hasOwn(value, family) && value[family] !== null) inspectSchema(value[family], result.findings, family)
      }
    }
    for (const family of Object.keys(SCHEMAS)) {
      const before = previous?.[family] ?? null
      const after = candidate[family] ?? null
      result.families[family] = {
        previous_payloads_to_candidate_validator: direction(before, after),
        candidate_payloads_to_previous_validator: direction(after, before),
      }
      annotationChanges(before, after, result.findings, family)
    }
    const directions = Object.values(result.families).flatMap((family) => Object.values(family))
    result.status = previous === null ? 'initial_unreviewed'
      : directions.some((item) => item.status === 'breaking') ? 'breaking_risk'
      : result.findings.length || directions.some((item) => item.status !== 'compatible') ? 'manual_review'
      : 'structurally_compatible_only'
  } catch (error) {
    result.status = 'invalid_input'
    result.findings = [{ rule: error instanceof InvalidInput ? error.rule : 'malformed_schema', severity: 'invalid' }]
    result.families = {}
  }
  return result
}

function git(repository, args, input) {
  try {
    const protocols = ['file', 'ssh', 'https', 'http', 'git', 'ext'].flatMap((name) => ['-c', `protocol.${name}.allow=never`])
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
    return execFileSync('git', ['--no-replace-objects', '-c', 'protocol.allow=never', ...protocols, '-C', repository, ...args], {
      env: { ...env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
      input, maxBuffer: 8 * MAX_BYTES, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch { throw new InvalidInput('local_git_object_unavailable') }
}

function reader(repository, revision) {
  requireInput(commitSha(revision), 'full_commit_sha_required')
  requireInput(git(repository, ['cat-file', '-t', revision]).toString().trim() === 'commit', 'commit_object_required')
  const entries = new Map()
  for (const line of git(repository, ['ls-tree', '-r', '-z', revision]).toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line)
    requireInput(match !== null, 'unsupported_git_tree')
    entries.set(match[4], { mode: match[1], type: match[2], oid: match[3] })
    requireInput(entries.size <= MAX_NODES, 'input_limit')
  }
  const cache = new Map()
  let total = 0
  const read = (path) => {
    requireInput(safePath(path), 'unsafe_path')
    const entry = entries.get(path)
    requireInput(entry?.type === 'blob' && ['100644', '100755'].includes(entry.mode), 'missing_or_nonregular_artifact')
    if (!cache.has(path)) {
      const bytes = git(repository, ['show', `${revision}:${path}`])
      total += bytes.length
      requireInput(bytes.length <= MAX_BYTES && total <= 8 * MAX_BYTES, 'input_limit')
      cache.set(path, bytes)
    }
    return cache.get(path)
  }
  const prefetch = (paths) => {
    const pending = [...new Set(paths)].filter((path) => !cache.has(path))
    requireInput(pending.length <= 200, 'input_limit')
    for (const path of pending) {
      requireInput(safePath(path), 'unsafe_path')
      requireInput(entries.get(path)?.type === 'blob' && ['100644', '100755'].includes(entries.get(path).mode), 'missing_or_nonregular_artifact')
    }
    if (pending.length === 0) return
    const output = git(repository, ['cat-file', '--batch'], pending.map((path) => entries.get(path).oid).join('\n') + '\n')
    let offset = 0
    for (const path of pending) {
      const end = output.indexOf(10, offset)
      const header = output.subarray(offset, end).toString().split(' ')
      const size = Number(header[2])
      requireInput(header[0] === entries.get(path).oid && header[1] === 'blob' && Number.isSafeInteger(size) && size >= 0 && size <= MAX_BYTES, 'invalid_git_blob')
      offset = end + 1
      const bytes = output.subarray(offset, offset + size)
      requireInput(bytes.length === size && output[offset + size] === 10, 'invalid_git_blob')
      total += size
      requireInput(total <= 8 * MAX_BYTES, 'input_limit')
      cache.set(path, bytes)
      offset += size + 1
    }
    requireInput(offset === output.length, 'invalid_git_blob')
  }
  return { read, entries, prefetch }
}

function inventory(entries) {
  requireInput(Array.isArray(entries) && entries.length > 0 && entries.length <= 200, 'malformed_inventory')
  const result = new Map()
  for (const entry of entries) {
    requireInput(record(entry) && safePath(entry.path) && digest(entry.sha256), 'malformed_inventory_entry')
    requireInput(!result.has(entry.path), 'duplicate_inventory_entry')
    result.set(entry.path, entry.sha256)
  }
  return result
}

function referenceSnapshots(repository) {
  const historical = reader(repository, HISTORICAL_REVISION)
  const content = reader(repository, CONTENT_C)
  const baselineBytes = content.read(BASELINE_PATH)
  const baselineData = parseJson(baselineBytes)
  historical.prefetch([...baselineData.packed_files, ...baselineData.protected_files].map(({ path }) => path))
  let baseline
  try { baseline = verifyPackageBaseline({ baselineBytes, historicalBytes: historical.read }) }
  catch { throw new InvalidInput('historical_baseline_invalid') }
  return Object.fromEntries(Object.entries(REFERENCES).map(([version, revision]) => {
    const source = version === '0.2.0' ? historical : content
    const manifestPath = `manifests/releases/${version}-candidate.gen.json`
    const manifest = parseJson(source.read(manifestPath))
    const packed = version === '0.2.0' ? baseline.packed_files.map(({ path }) => path) : expectedCurrentPackedPaths(baseline)
    const paths = new Set([...packed, ...baseline.protected_files.map(({ path }) => path), manifest.compatibility.prior_baseline_path])
    for (const value of Object.values(manifest.toolchain)) if (record(value) && value.path) paths.add(value.path)
    if (version === '0.2.1') paths.add(manifest.sudostack.content_stage.metadata_path)
    source.prefetch([...paths])
    const bytes = new Map([...paths].map((path) => [path, source.read(path)]))
    return [version, { revision, source, bytes, manifest, manifestPath, packed }]
  }))
}

function snapshot(repository, revision, references) {
  const source = reader(repository, revision)
  const pkg = parseJson(source.read('package.json'))
  requireInput(record(pkg) && pkg.name === '@sudo/contracts', 'repository_package_identity')
  requireInput(Object.hasOwn(references, pkg.version), 'unsupported_snapshot_version')
  const reference = references[pkg.version]
  git(repository, ['merge-base', '--is-ancestor', reference.revision, revision])
  source.prefetch([...reference.bytes.keys()])
  const manifest = parseJson(source.read(reference.manifestPath))
  requireInput(record(manifest) && manifest.manifest_version === reference.manifest.manifest_version, 'unsupported_manifest_format')
  requireInput(record(manifest.package) && manifest.package.version === pkg.version && manifest.package.name === pkg.name, 'manifest_package_identity')
  const findings = []
  const add = (rule, path) => findings.push({ rule, path, severity: 'manual_review' })
  for (const name of ['generated_artifacts', 'internal_generation_artifacts']) {
    const current = inventory(manifest[name])
    const expected = inventory(reference.manifest[name])
    requireInput(equal([...current.keys()].sort(), [...expected.keys()].sort()), 'unsupported_inventory_path_set')
    for (const [path, hash] of current) requireInput(sha256(source.read(path)) === hash, 'artifact_digest_mismatch')
  }
  requireInput(manifest.package.package_json_sha256 === sha256(source.read('package.json')), 'package_digest_mismatch')
  requireInput(manifest.package.package_lock_sha256 === sha256(source.read('package-lock.json')), 'lock_digest_mismatch')
  requireInput(record(manifest.sudostack?.assembly_source_lock), 'missing_source_closure')
  requireInput(manifest.sudostack.assembly_source_lock.path === 'contracts/sources.lock.json' &&
    manifest.sudostack.assembly_source_lock.sha256 === sha256(source.read('contracts/sources.lock.json')), 'source_lock_digest_mismatch')
  for (const name of ['owners', 'toolchain', 'fixtures', 'sudostack', 'compatibility', 'lifecycle', 'source_availability']) {
    requireInput(record(manifest[name]) && equal(Object.keys(manifest[name]).sort(), Object.keys(reference.manifest[name]).sort()), 'unsupported_manifest_vocabulary')
  }
  for (const [name, template] of Object.entries(reference.manifest.toolchain)) {
    if (!record(template)) continue
    const item = manifest.toolchain[name]
    requireInput(record(item) && item.path === template.path && item.sha256 === sha256(source.read(template.path)), 'toolchain_digest_mismatch')
  }
  const lock = parseJson(source.read('contracts/sources.lock.json'))
  const closure = parseJson(source.read('manifests/source-closure.gen.json'))
  requireInput(record(lock) && lock.lock_version === 1 && record(lock.repositories) &&
    record(closure) && closure.manifest_version === 1 && record(closure.repositories), 'missing_source_closure')
  requireInput(equal(Object.keys(lock.repositories).sort(), ['nexus', 'nexus-vfs']) &&
    equal(Object.keys(closure.repositories).sort(), ['nexus', 'nexus-vfs']), 'unsupported_owner_set')
  const ownerPaths = {
    nexus: { schema: SCHEMAS.resource_ref, manifest: 'contracts/common/v1/resource-ref/owner-manifest.source.gen.json',
      source_lock: 'contracts/common/v1/resource-ref/owner-source-lock.source.gen.json' },
    'nexus-vfs': { zone_id_schema: SCHEMAS.zone_id, zone_id_spec: 'contracts/zone-id/spec.source.gen.json',
      zone_id_vectors: 'contracts/zone-id/vectors.source.gen.json', zone_path_schema: SCHEMAS.zone_path,
      zone_path_spec: 'contracts/zone-path/spec.source.gen.json', zone_path_meta_schema: 'contracts/zone-path/meta-schema.gen.json',
      zone_path_cases: 'contracts/zone-path/cases.source.gen.json', zone_path_package_lock: 'contracts/zone-path/validator-lock.source.gen.json' },
  }
  for (const name of ['nexus', 'nexus-vfs']) {
    const entry = lock.repositories[name]
    requireInput(record(entry) && commitSha(entry.revision) && record(entry.files), 'malformed_owner_identity')
    requireInput(equal(Object.keys(entry.files).sort(), Object.keys(ownerPaths[name]).sort()), 'unsupported_owner_inventory')
    for (const [key, path] of Object.entries(ownerPaths[name])) {
      const file = entry.files[key]
      requireInput(record(file) && safePath(file.path) && digest(file.sha256), 'malformed_owner_file')
      requireInput(file.sha256 === sha256(source.read(path)), 'owner_digest_mismatch')
    }
    const expectedClosure = { ...entry }
    delete expectedClosure.checkout
    delete expectedClosure.root
    requireInput(equal(closure.repositories[name], expectedClosure), 'source_closure_mismatch')
  }
  requireInput(commitSha(lock.repositories.nexus.definition_revision), 'malformed_owner_identity')
  const vfsOwner = manifest.owners['nexus-vfs']
  const nexusOwner = manifest.owners.nexus
  requireInput(record(vfsOwner) && vfsOwner.revision === lock.repositories['nexus-vfs'].revision &&
    equal(vfsOwner.files, lock.repositories['nexus-vfs'].files), 'manifest_owner_mismatch')
  requireInput(record(nexusOwner) && nexusOwner.definition_revision === lock.repositories.nexus.definition_revision &&
    nexusOwner.provenance_revision === lock.repositories.nexus.revision, 'manifest_owner_mismatch')
  for (const key of ['schema', 'manifest', 'source_lock']) {
    requireInput(nexusOwner[`${key}_path`] === lock.repositories.nexus.files[key].path &&
      nexusOwner[`${key}_sha256`] === lock.repositories.nexus.files[key].sha256, 'manifest_owner_mismatch')
  }
  const packageReference = parseJson(reference.bytes.get('package.json'))
  for (const name of ['exports', 'dependencies', 'devDependencies', 'engines', 'files', 'scripts']) {
    requireInput(pkg[name] !== null && typeof pkg[name] === 'object', 'malformed_package_identity')
    if (!equal(pkg[name], packageReference[name])) add(`package_${name}_changed`, 'package.json')
  }
  for (const selector of pkg.files) requireInput(typeof selector === 'string' && safePath(selector.replace(/\/$/, '')), 'unsupported_package_selector')
  const npmControl = (path) => /(?:^|\/)(?:\.npmignore|\.gitignore|\.npmrc)$/.test(path) ||
    /^(?:readme|license|licence|copying)(?:$|\.)/i.test(path)
  requireInput(equal([...source.entries.keys()].filter(npmControl).sort(), [...reference.source.entries.keys()].filter(npmControl).sort()), 'unsupported_npm_control_files')
  for (const path of [...source.entries.keys()].filter(npmControl)) {
    requireInput(source.read(path).equals(reference.source.read(path)), 'npm_control_file_changed')
  }
  const selected = [...source.entries.keys()].filter((path) => pkg.files.some((selector) =>
    path === selector || path.startsWith(`${selector.replace(/\/$/, '')}/`)))
  const packed = [...new Set(['package.json', 'README.md', ...selected])].sort()
  requireInput(equal(packed, [...reference.packed].sort()), 'unsupported_packed_path_set')
  const relevant = (path) => /^contracts\/(?:zone-id|zone-path|common)\//.test(path) && !/\.(?:test\.mjs)$/.test(path)
  requireInput(equal([...source.entries.keys()].filter(relevant).sort(), [...reference.source.entries.keys()].filter(relevant).sort()), 'unsupported_family_artifact_set')
  for (const path of source.entries.keys()) {
    if (path.startsWith('contracts/') && !reference.source.entries.has(path) && !path.endsWith('.test.mjs')) {
      throw new InvalidInput('unsupported_family_artifact_set')
    }
  }
  const bytes = new Map()
  for (const [path, expected] of reference.bytes) {
    const actual = source.read(path)
    bytes.set(path, actual)
    if (!actual.equals(expected) || source.entries.get(path).mode !== reference.source.entries.get(path).mode) add('unreviewed_artifact_change', path)
  }
  requireInput(findings.length <= MAX_FINDINGS, 'finding_limit')
  const schemas = Object.fromEntries(Object.entries(SCHEMAS).map(([family, path]) => [family, parseJson(source.read(path))]))
  return { version: pkg.version, bytes, packed, findings, schemas }
}

export function preflightSuccessor({ previous, candidate, repository = REPO } = {}) {
  const result = { ...noAdmission(), input_provenance: 'unverified', local_objects_verified: false, status: 'invalid_input', findings: [] }
  try {
    requireInput(commitSha(candidate) && (previous === undefined || previous === null || commitSha(previous)), 'full_commit_sha_required')
    const references = referenceSnapshots(repository)
    const after = snapshot(repository, candidate, references)
    const before = previous == null ? null : snapshot(repository, previous, references)
    const comparison = compareSuccessorSchemas(before?.schemas ?? null, after.schemas)
    result.families = comparison.families
    result.findings = [...comparison.findings, ...(before?.findings ?? []), ...after.findings]
    requireInput(result.findings.length <= MAX_FINDINGS, 'finding_limit')
    if (before && before.version === after.version) {
      requireInput(before.packed.every((path) => before.bytes.get(path).equals(after.bytes.get(path))), 'package_version_reused_with_different_content')
    }
    result.status = comparison.status === 'structurally_compatible_only'
      ? result.findings.length ? 'manual_review' : 'no_contract_byte_change'
      : comparison.status
    result.input_provenance = 'local_git_bytes_only'
    result.local_objects_verified = true
    result.previous = before ? { revision: previous, version: before.version } : null
    result.candidate = { revision: candidate, version: after.version }
    result.byte_scope = 'anchored_0.2.0_and_0.2.1_package_runtime_owner_fixture_toolchain'
    result.remaining_gates = ['owner_semantic_security_review', 'successor_release_and_support_admission', 'real_consumer_evidence', 'migration_and_rollback']
  } catch (error) {
    result.status = 'invalid_input'
    result.findings = [{ rule: error instanceof InvalidInput ? error.rule : 'unsupported_snapshot', severity: 'invalid' }]
  }
  result.preflight_passed = result.status === 'no_contract_byte_change'
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const options = {}
  let valid = args.length === 4
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i] === '--previous' ? 'previous' : args[i] === '--candidate' ? 'candidate' : null
    if (!key || Object.hasOwn(options, key)) { valid = false; break }
    options[key] = args[i + 1]
  }
  const result = valid && options.previous && options.candidate ? preflightSuccessor(options) : {
    ...noAdmission(), status: 'invalid_input', local_objects_verified: false, preflight_passed: false,
    findings: [{ rule: 'usage_requires_previous_and_candidate_full_commit_shas', severity: 'invalid' }],
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.preflight_passed ? 0 : 1
}
