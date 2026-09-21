import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

import { sha256 } from './content-candidate.mjs'
import { compareSuccessorSchemas, preflightSuccessor } from './successor-compatibility.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PREVIOUS = '5a2a53130e37d1c63993ebf8ba1253b15eb9eebf'
const CANDIDATE = '273fd4097cbc33c1c049c39bb1fb60cef2663e2b'
const MANIFEST = 'manifests/releases/0.2.1-candidate.gen.json'
const SCHEMA = 'contracts/common/v1/resource-ref/schema.gen.json'
const RUNTIME = 'contracts/common/v1/resource-ref/resource-ref.gen.js'
const CLI = join(REPO, 'tools/contracts/successor-compatibility.mjs')
const baseSchema = {
  type: 'object', required: ['kind'], additionalProperties: true,
  properties: { kind: { const: 'Example' }, mode: { enum: ['ready'] }, value: { type: ['string', 'null'], maxLength: 20 },
    list: { type: 'array', items: { type: 'string' } }, ref: { $ref: '#/$defs/value' } },
  $defs: { value: { type: 'string' } },
}
const families = () => ({ zone_id: { type: 'string' }, zone_path: { type: 'string' }, resource_ref: structuredClone(baseSchema) })
const compare = (mutate) => {
  const before = families()
  const after = structuredClone(before)
  mutate(after.resource_ref)
  return compareSuccessorSchemas(before, after)
}
function unapproved(result) {
  for (const key of ['release_admission', 'consumer_adoption_verified', 'deployment_verified', 'semantic_compatibility_verified']) assert.equal(result[key], false)
  assert.equal(result.resource_ref, 'deferred_manual_semantic_review')
}
function rejected(result, rule) {
  assert.equal(result.preflight_passed, false, JSON.stringify(result))
  assert.ok(result.findings.some((item) => item.rule === rule), JSON.stringify(result))
  unapproved(result)
}

test('closed enum growth is breaking in the candidate-to-previous direction', () => {
  const result = compare((schema) => schema.properties.mode.enum.push('pending'))
  assert.equal(result.status, 'breaking_risk')
  assert.equal(result.families.resource_ref.previous_payloads_to_candidate_validator.status, 'compatible')
  assert.equal(result.families.resource_ref.candidate_payloads_to_previous_validator.status, 'breaking')
  assert.ok(result.families.resource_ref.candidate_payloads_to_previous_validator.findings.some((item) => item.rule === 'enum_value_removed'))
  unapproved(result)
})

for (const [name, mutate] of [
  ['enum removal', (schema) => { schema.properties.mode.enum.pop() }],
  ['required', (schema) => schema.required.push('mode')],
  ['type and nullability', (schema) => { schema.properties.value.type = 'string' }],
  ['const', (schema) => { schema.properties.kind.const = 'Other' }],
  ['bounds', (schema) => { schema.properties.value.maxLength = 2 }],
  ['items', (schema) => { schema.properties.list.items.type = 'integer' }],
  ['additionalProperties', (schema) => { schema.additionalProperties = false }],
  ['ref', (schema) => { schema.properties.ref.$ref = '#/$defs/other' }],
  ['kind deletion', (schema) => { delete schema.properties.kind }],
]) {
  test(`both directions block ${name} mutations`, () => {
    const before = families()
    if (name === 'enum removal') before.resource_ref.properties.mode.enum.push('pending')
    const after = structuredClone(before)
    mutate(after.resource_ref)
    for (const [a, b] of [[before, after], [after, before]]) {
      const result = compareSuccessorSchemas(a, b)
      assert.equal(result.status, 'breaking_risk', name)
      unapproved(result)
    }
  })
}

for (const key of ['default', 'readOnly', 'writeOnly', 'description', 'deprecated', 'x-sudo-max-json-bytes']) {
  test(`${key} annotation or policy changes require review`, () => {
    const result = compare((schema) => { schema.properties.value[key] = key === 'description' ? 'changed policy' : true })
    assert.equal(result.status, 'manual_review')
    assert.ok(result.findings.some((item) => item.rule === 'annotation_or_policy_changed'))
  })
}

test('unknown keywords including unchanged unknown vocabulary never pass', () => {
  const before = families()
  before.resource_ref.futureKeyword = { secret: 'do-not-print-credential' }
  const result = compareSuccessorSchemas(before, before)
  assert.equal(result.status, 'manual_review')
  assert.ok(result.findings.some((item) => item.rule === 'unsupported_keyword'))
  assert.equal(JSON.stringify(result).includes('do-not-print-credential'), false)
  assert.equal(JSON.stringify(result).includes('futureKeyword'), false)
})

test('unknown vocabulary retains independently detectable breaking directions', () => {
  const before = families()
  const after = structuredClone(before)
  after.resource_ref.properties.mode.enum.push('pending')
  after.resource_ref.properties.mode.futureKeyword = true
  before.resource_ref.patternProperties = { '(a+)+$': false }
  const result = compareSuccessorSchemas(before, after)
  assert.equal(result.status, 'breaking_risk')
  assert.ok(result.findings.some((item) => item.rule === 'unsupported_keyword'))
  assert.equal(result.families.resource_ref.previous_payloads_to_candidate_validator.status, 'compatible')
  assert.ok(result.families.resource_ref.candidate_payloads_to_previous_validator.findings.some((item) => item.rule === 'enum_value_removed'))
  assert.equal(after.resource_ref.properties.mode.futureKeyword, true)
  assert.deepEqual(before.resource_ref.patternProperties, { '(a+)+$': false })
})

test('applicator changes require semantic review', () => {
  for (const key of ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']) {
    const result = compare((schema) => { schema[key] = ['allOf', 'anyOf', 'oneOf'].includes(key) ? [true] : true })
    assert.equal(result.status, 'manual_review')
  }
})

test('family addition, deletion and schema deletion are not approved', () => {
  const before = families()
  for (const mutate of [
    (value) => { value.future_family = {} },
    (value) => { delete value.zone_path },
    (value) => { value.resource_ref = null },
  ]) {
    const after = structuredClone(before)
    mutate(after)
    const result = compareSuccessorSchemas(before, after)
    assert.ok(['manual_review', 'breaking_risk'].includes(result.status))
    unapproved(result)
  }
  assert.equal(compareSuccessorSchemas(null, before).status, 'initial_unreviewed')
})

test('raw objects and forged provenance remain unverified', () => {
  const raw = families()
  let result = compareSuccessorSchemas(raw, raw)
  assert.equal(result.status, 'structurally_compatible_only')
  assert.equal(result.local_objects_verified, false)
  raw.local_objects_verified = true
  raw.release_admission = true
  result = compareSuccessorSchemas(raw, raw)
  assert.equal(result.status, 'manual_review')
  assert.equal(result.local_objects_verified, false)
  unapproved(result)
})

test('malformed schemas, getters, proxies and graph expansion are bounded without execution', () => {
  let calls = 0
  const getter = Object.defineProperty({}, 'resource_ref', { enumerable: true, get() { calls++; throw new Error('credential') } })
  const proxy = new Proxy({}, { ownKeys() { calls++; throw new Error('credential') } })
  let dag = 'value'
  for (let i = 0; i < 20; i++) dag = [dag, dag]
  for (const input of [getter, proxy, dag, { zone_id: { required: 42 } }, { zone_id: { properties: [] } }]) {
    const result = compareSuccessorSchemas(input, families())
    assert.equal(result.status, 'invalid_input')
    assert.equal(JSON.stringify(result).includes('credential'), false)
  }
  assert.equal(calls, 0)
})

const temporary = mkdtempSync(join(tmpdir(), 'successor-compatibility-'))
after(() => rmSync(temporary, { recursive: true, force: true }))
const repository = join(temporary, 'repo')
execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', REPO, repository], { stdio: 'pipe' })
const git = (args, input) => execFileSync('git', ['-C', repository, ...args], {
  input, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 'Offline Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Offline Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
})
const read = (path) => git(['show', `${CANDIDATE}:${path}`])
const json = (path) => JSON.parse(read(path))
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
function revision(changes, updateDigests = true) {
  changes = new Map(changes)
  if (updateDigests) {
    const manifest = changes.has(MANIFEST) ? JSON.parse(changes.get(MANIFEST)) : json(MANIFEST)
    for (const entry of [...manifest.generated_artifacts, ...manifest.internal_generation_artifacts]) {
      if (changes.get(entry.path)) entry.sha256 = sha256(changes.get(entry.path))
    }
    for (const [path, field] of [['package.json', 'package_json_sha256'], ['package-lock.json', 'package_lock_sha256']]) {
      if (changes.get(path)) manifest.package[field] = sha256(changes.get(path))
    }
    changes.set(MANIFEST, encode(manifest))
  }
  git(['read-tree', CANDIDATE])
  for (const [path, bytes] of changes) {
    if (bytes === null) git(['update-index', '--force-remove', path])
    else {
      const blob = git(['hash-object', '-w', '--stdin'], bytes).toString().trim()
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`])
    }
  }
  const tree = git(['write-tree']).toString().trim()
  return git(['commit-tree', tree, '-p', CANDIDATE], 'temporary local compatibility test\n').toString().trim()
}
const check = (candidate, previous = PREVIOUS) => preflightSuccessor({ previous, candidate, repository })

test('immutable historical Git pair passes only the no-contract-byte-change preflight', () => {
  const result = check(CANDIDATE)
  assert.equal(result.status, 'no_contract_byte_change', JSON.stringify(result))
  assert.equal(result.preflight_passed, true)
  assert.equal(result.local_objects_verified, true)
  assert.equal(result.input_provenance, 'local_git_bytes_only')
  unapproved(result)
})

test('CLI uses immutable Git bytes rather than dirty worktree or caller data', () => {
  writeFileSync(join(repository, 'package.json'), '{"name":"forged","local_objects_verified":true}')
  mkdirSync(join(repository, 'contracts'), { recursive: true })
  writeFileSync(join(repository, 'contracts/sources.lock.json'), 'credential-must-not-be-read')
  assert.equal(check(CANDIDATE).preflight_passed, true)
  const result = spawnSync(process.execPath, [CLI, '--previous', PREVIOUS, '--candidate', CANDIDATE], { cwd: repository, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).status, 'no_contract_byte_change')
  assert.equal(result.stdout.includes('credential'), false)
})

test('mutable refs, missing and non-commit objects, invalid CLI flags fail closed', () => {
  for (const candidate of ['main', CANDIDATE.slice(0, 8), 'f'.repeat(40), git(['rev-parse', `${CANDIDATE}^{tree}`]).toString().trim()]) {
    const result = check(candidate)
    assert.equal(result.status, 'invalid_input')
    assert.equal(result.local_objects_verified, false)
  }
  for (const args of [[], ['--candidate', CANDIDATE], ['--previous', PREVIOUS, '--candidate', 'credential-secret'],
    ['--candidate', CANDIDATE, '--candidate', CANDIDATE], ['--force', 'true', '--candidate', CANDIDATE]]) {
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).preflight_passed, false)
    assert.equal(result.stdout.includes('credential-secret'), false)
  }
  const initial = check(CANDIDATE, null)
  assert.equal(initial.status, 'initial_unreviewed')
  assert.equal(initial.preflight_passed, false)
})

test('runtime-only and fixture-only changes cannot hide behind schema equality', () => {
  for (const path of [RUNTIME, 'contracts/zone-id/vectors.source.gen.json']) {
    const bytes = Buffer.concat([read(path), Buffer.from('\n')])
    const result = check(revision([[path, bytes]]))
    assert.equal(result.preflight_passed, false)
    assert.ok(['manual_review', 'invalid_input'].includes(result.status))
  }
})

test('package dependency, engine, script and export changes require review', () => {
  for (const mutate of [
    (pkg) => { pkg.dependencies.ajv = '8.19.0' },
    (pkg) => { pkg.engines.node = '>=24' },
    (pkg) => { delete pkg.exports['./common/v1/resource-ref'] },
    (pkg) => { pkg.scripts.postinstall = 'must-not-run' },
  ]) {
    const pkg = json('package.json')
    mutate(pkg)
    const result = check(revision([['package.json', encode(pkg)]]))
    assert.equal(result.status, 'manual_review', JSON.stringify(result))
    assert.equal(result.preflight_passed, false)
    unapproved(result)
  }
})

test('package version reuse rejects changed packed content', () => {
  const mutated = revision([[RUNTIME, Buffer.concat([read(RUNTIME), Buffer.from('\n')])]])
  rejected(check(mutated, CANDIDATE), 'package_version_reused_with_different_content')
})

test('unrecognized version and manifest formats are blocked', () => {
  const pkg = json('package.json')
  pkg.version = '0.2.2'
  rejected(check(revision([['package.json', encode(pkg)]])), 'unsupported_snapshot_version')
  const manifest = json(MANIFEST)
  manifest.manifest_version = 100
  rejected(check(revision([[MANIFEST, encode(manifest)]], false)), 'unsupported_manifest_format')
})

test('null, duplicate, omitted and unsafe inventory entries cannot grant provenance', () => {
  for (const mutate of [
    (value) => { value.generated_artifacts = null },
    (value) => { value.generated_artifacts.push(value.generated_artifacts[0]) },
    (value) => { value.generated_artifacts = value.generated_artifacts.filter((entry) => entry.path !== RUNTIME) },
    (value) => { value.generated_artifacts[0].path = '../credential' },
    (value) => { value.generated_artifacts[0].sha256 = '0'.repeat(64) },
    (value) => { value.generated_artifacts[0] = null },
  ]) {
    const manifest = json(MANIFEST)
    mutate(manifest)
    const result = check(revision([[MANIFEST, encode(manifest)]], false))
    assert.equal(result.status, 'invalid_input')
    assert.equal(result.local_objects_verified, false)
    assert.equal(JSON.stringify(result).includes('credential'), false)
  }
})

test('omitting exported bytes from every supplied inventory still fails closed', () => {
  const manifest = json(MANIFEST)
  manifest.generated_artifacts = manifest.generated_artifacts.filter((entry) => entry.path !== RUNTIME)
  const pkg = json('package.json')
  pkg.files = pkg.files.filter((path) => path !== RUNTIME)
  const result = check(revision([[MANIFEST, encode(manifest)], ['package.json', encode(pkg)], [RUNTIME, null]], false))
  assert.equal(result.status, 'invalid_input')
})

test('schema and family artifact deletion or addition cannot bypass inventory', () => {
  for (const changes of [[[SCHEMA, null]], [['contracts/future/schema.json', Buffer.from('{}')]],
    [['contracts/common/v1/resource-ref/fixtures/valid/new.json', Buffer.from('{}')]]]) {
    assert.equal(check(revision(changes)).status, 'invalid_input')
  }
})

test('owner digest, pin and closure forgeries are blocked even with matching outer hashes', () => {
  const lockPath = 'contracts/sources.lock.json'
  const closurePath = 'manifests/source-closure.gen.json'
  for (const mutate of [
    (lock) => { lock.repositories.nexus.revision = '1'.repeat(40) },
    (lock) => { lock.repositories.nexus.files.schema.sha256 = '1'.repeat(64) },
    (lock) => { lock.repositories = null },
  ]) {
    const lock = json(lockPath)
    mutate(lock)
    const bytes = encode(lock)
    const manifest = json(MANIFEST)
    manifest.sudostack.assembly_source_lock.sha256 = sha256(bytes)
    const result = check(revision([[lockPath, bytes], [MANIFEST, encode(manifest)]]))
    assert.equal(result.status, 'invalid_input', JSON.stringify(result))
  }
  assert.equal(check(revision([[closurePath, Buffer.from('null')]])).status, 'invalid_input')
})

test('a self-consistent new owner pin is still unreviewed, not authenticated provenance', () => {
  const lock = json('contracts/sources.lock.json')
  const closure = json('manifests/source-closure.gen.json')
  const manifest = json(MANIFEST)
  lock.repositories.nexus.revision = '1'.repeat(40)
  closure.repositories.nexus.revision = '1'.repeat(40)
  manifest.owners.nexus.provenance_revision = '1'.repeat(40)
  const lockBytes = encode(lock)
  manifest.sudostack.assembly_source_lock.sha256 = sha256(lockBytes)
  const candidate = revision([['contracts/sources.lock.json', lockBytes],
    ['manifests/source-closure.gen.json', encode(closure)], [MANIFEST, encode(manifest)]])
  const result = check(candidate)
  assert.equal(result.status, 'manual_review')
  assert.equal(result.local_objects_verified, true)
  assert.equal(result.preflight_passed, false)
  unapproved(result)
})

test('unrelated copied package trees cannot masquerade as successor history', () => {
  const tree = git(['rev-parse', `${CANDIDATE}^{tree}`]).toString().trim()
  const unrelated = git(['commit-tree', tree], 'temporary unrelated history\n').toString().trim()
  assert.equal(check(unrelated).status, 'invalid_input')
})

test('unknown manifest fields and forged approval metadata require review', () => {
  const manifest = json(MANIFEST)
  manifest.release_admission = true
  manifest.local_objects_verified = true
  const result = check(revision([[MANIFEST, encode(manifest)]], false))
  assert.equal(result.status, 'manual_review')
  assert.equal(result.preflight_passed, false)
  unapproved(result)
})

test('duplicate JSON keys and malformed JSON never reflect input data', () => {
  for (const bytes of [Buffer.from('{"name":"credential", "name":"@sudo/contracts"}'),
    Buffer.from('{ credential'), Buffer.from('{"key": /*credential*/ true}'), Buffer.from([0xff])]) {
    const result = check(revision([['package.json', bytes]], false))
    assert.equal(result.status, 'invalid_input')
    assert.equal(JSON.stringify(result).includes('credential'), false)
  }
})

test('package-external docs and additive tools do not become contract deltas', () => {
  const candidate = revision([['docs/successor-test.txt', Buffer.from('offline evidence')],
    ['tools/contracts/temporary-preflight-test.mjs', Buffer.from('throw new Error("must not run")')]], false)
  assert.equal(check(candidate, CANDIDATE).preflight_passed, true)
})

test('npm implicit files, ignore rules, symlinks and file modes cannot evade byte accounting', () => {
  for (const path of ['LICENSE', '.npmignore', 'contracts/common/v1/resource-ref/.npmignore']) {
    assert.equal(check(revision([[path, Buffer.from('new package input')]], false)).status, 'invalid_input')
  }
  git(['read-tree', CANDIDATE])
  const blob = git(['hash-object', '-w', '--stdin'], '/tmp/credential').toString().trim()
  git(['update-index', '--cacheinfo', `120000,${blob},${RUNTIME}`])
  const tree = git(['write-tree']).toString().trim()
  const linkRevision = git(['commit-tree', tree, '-p', CANDIDATE], 'temporary symlink test\n').toString().trim()
  rejected(check(linkRevision), 'missing_or_nonregular_artifact')
  git(['read-tree', CANDIDATE])
  const runtimeBlob = git(['rev-parse', `${CANDIDATE}:${RUNTIME}`]).toString().trim()
  git(['update-index', '--cacheinfo', `100755,${runtimeBlob},${RUNTIME}`])
  const modeTree = git(['write-tree']).toString().trim()
  const modeRevision = git(['commit-tree', modeTree, '-p', CANDIDATE], 'temporary mode test\n').toString().trim()
  assert.equal(check(modeRevision).preflight_passed, false)
})
