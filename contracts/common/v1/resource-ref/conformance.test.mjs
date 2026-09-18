import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import {
  MAX_RESOURCE_REF_JSON_BYTES,
  ResourceRefValidationError,
  isResourceRef,
  parseResourceRefJson,
  serializeResourceRef,
  validateResourceRef,
} from './resource-ref.gen.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACTS = join(HERE, '..', '..', '..')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const index = readJson(join(HERE, 'fixture-index.gen.json'))
const zoneIdVectors = readJson(join(CONTRACTS, 'zone-id', 'vectors.source.gen.json'))
const zonePathCases = readJson(join(CONTRACTS, 'zone-path', 'cases.source.gen.json'))
const zonePathSchema = readJson(join(CONTRACTS, 'zone-path', 'schema.gen.json'))
const zonePathMetaSchema = readJson(join(CONTRACTS, 'zone-path', 'meta-schema.gen.json'))

const base = () => ({
  api_version: 'common.sudo.dev/v1',
  kind: 'ResourceRef',
  zone_id: 'workspace-main',
  path: '/artifact',
})

test('all 25 Nexus fixtures match owner schema and adapter expectations', () => {
  assert.equal(index.resource_ref.count, 25)
  for (const fixture of index.resource_ref.cases) {
    const path = join(CONTRACTS, '..', fixture.distributed_path)
    const source = readFileSync(path, 'utf8')
    const value = JSON.parse(source)
    const issues = validateResourceRef(value)
    const accepts = issues.length === 0
    assert.equal(fixture.schema_expected, fixture.adapter_expected, fixture.case_id)
    assert.equal(accepts, fixture.adapter_expected === 'accept', fixture.case_id)
    if (accepts) {
      const parsed = parseResourceRefJson(source)
      const reparsed = parseResourceRefJson(serializeResourceRef(parsed))
      assert.deepEqual(reparsed, value, fixture.case_id)
    } else {
      if (fixture.expected_issue) {
        assert.ok(
          issues.some(
            (item) =>
              item.category === fixture.expected_issue.category &&
              item.path === fixture.expected_issue.path &&
              (!fixture.expected_issue.keyword || item.keyword === fixture.expected_issue.keyword),
          ),
          `${fixture.case_id}: ${JSON.stringify(issues)}`,
        )
      }
      assert.throws(() => parseResourceRefJson(source), ResourceRefValidationError, fixture.case_id)
    }
  }
})

test('all 12 ZoneId owner vectors compose through ResourceRef', () => {
  assert.equal(zoneIdVectors.cases.length, 12)
  const indexed = new Map(index.zone_id.cases.map((ownerCase) => [ownerCase.owner_case_id, ownerCase]))
  for (const ownerCase of zoneIdVectors.cases) {
    const metadata = indexed.get(ownerCase.id)
    assert.ok(metadata, ownerCase.id)
    assert.equal(metadata.schema_expected, ownerCase.expected, ownerCase.id)
    assert.equal(metadata.adapter_expected, ownerCase.expected, ownerCase.id)
    const value = { ...base(), zone_id: ownerCase.value }
    assert.equal(isResourceRef(value), ownerCase.expected === 'accept', ownerCase.id)
  }
})

test('all 23 ZonePath owner cases compose through the required vocabulary', () => {
  assert.equal(zonePathCases.cases.length, 23)
  const indexed = new Map(index.zone_path.cases.map((ownerCase) => [ownerCase.owner_case_id, ownerCase]))
  for (const ownerCase of zonePathCases.cases) {
    const metadata = indexed.get(ownerCase.id)
    assert.ok(metadata, ownerCase.id)
    assert.equal(metadata.schema_expected, ownerCase.expected, ownerCase.id)
    assert.equal(metadata.adapter_expected, ownerCase.expected, ownerCase.id)
    const value = { ...base(), path: ownerCase.path }
    assert.equal(isResourceRef(value), ownerCase.expected === 'accept', ownerCase.id)
  }
})

test('ZonePath and extension strings reject lone UTF-16 surrogates', () => {
  assert.equal(isResourceRef({ ...base(), path: '/bad/\ud800' }), false)
  assert.equal(isResourceRef({ ...base(), path: '/bad/\udfff' }), false)
  assert.equal(isResourceRef({ ...base(), path: '/emoji/😀' }), true)
  const scalarExtension = '😀'.repeat(3_000)
  assert.ok(Buffer.byteLength(scalarExtension) < MAX_RESOURCE_REF_JSON_BYTES)
  assert.equal(isResourceRef({ ...base(), future_metadata: scalarExtension }), true)
  assert.equal(isResourceRef({ ...base(), future_metadata: '\ud800' }), false)
  assert.throws(
    () => parseResourceRefJson(JSON.stringify({ ...base(), future_metadata: '\ud800' })),
    ResourceRefValidationError,
  )
})

test('a validator missing the owner dialect or keyword fails closed', () => {
  const missingDialect = new Ajv2020({ strict: true, strictTypes: false })
  assert.throws(() => missingDialect.compile(zonePathSchema), /no schema with key or ref/)

  const missingKeyword = new Ajv2020({ strict: true, strictTypes: false })
  missingKeyword.addMetaSchema(zonePathMetaSchema)
  assert.throws(() => missingKeyword.compile(zonePathSchema), /unknown keyword|sudoZonePath/)
})

test('raw JSON parser rejects duplicate keys before object validation', () => {
  const source =
    '{"api_version":"common.sudo.dev/v1","kind":"ResourceRef",' +
    '"zone_id":"one","zone_id":"two","path":"/file"}'
  assert.throws(
    () => parseResourceRefJson(source),
    (error) =>
      error instanceof ResourceRefValidationError &&
      error.issues.length === 1 &&
      error.issues[0].category === 'duplicate_property',
  )
})

test('raw JSON depth is rejected before recursive parser materialization', () => {
  const nested = '['.repeat(3_000) + '0' + ']'.repeat(3_000)
  const source =
    '{"api_version":"common.sudo.dev/v1","kind":"ResourceRef",' +
    '"zone_id":"workspace-main","path":"/file","future_value":' +
    nested +
    '}'
  assert.ok(Buffer.byteLength(source) < MAX_RESOURCE_REF_JSON_BYTES)
  assert.throws(
    () => parseResourceRefJson(source),
    (error) =>
      error instanceof ResourceRefValidationError &&
      error.issues[0].category === 'extension_too_deep',
  )

  const disguised = '/*' + ']'.repeat(10_000) + '*/' + source
  assert.ok(Buffer.byteLength(disguised) < MAX_RESOURCE_REF_JSON_BYTES)
  assert.throws(
    () => parseResourceRefJson(disguised),
    (error) =>
      error instanceof ResourceRefValidationError && error.issues[0].category === 'invalid_json',
  )

  const unterminated = '{"future_value\n:' + '['.repeat(10_000) + '0' + ']'.repeat(10_000) + '}'
  assert.ok(Buffer.byteLength(unterminated) < MAX_RESOURCE_REF_JSON_BYTES)
  assert.throws(
    () => parseResourceRefJson(unterminated),
    (error) =>
      error instanceof ResourceRefValidationError && error.issues[0].category === 'invalid_json',
  )
})

test('extension depth accepts the boundary and rejects the next level', () => {
  let accepted = 0
  for (let index = 0; index < 8; index += 1) accepted = [accepted]
  let rejected = accepted
  rejected = [rejected]
  assert.equal(isResourceRef({ ...base(), future_metadata: accepted }), true)
  assert.equal(isResourceRef({ ...base(), future_metadata: rejected }), false)
  assert.doesNotThrow(() => parseResourceRefJson(JSON.stringify({ ...base(), future_metadata: accepted })))
  assert.throws(
    () => parseResourceRefJson(JSON.stringify({ ...base(), future_metadata: rejected })),
    ResourceRefValidationError,
  )
})

test('direct validation requires JSON-visible own root properties', () => {
  const inherited = Object.create(base())
  assert.equal(isResourceRef(inherited), false)
  assert.throws(() => serializeResourceRef(inherited), ResourceRefValidationError)

  const hidden = base()
  Object.defineProperty(hidden, 'path', { value: '/file', enumerable: false })
  assert.equal(isResourceRef(hidden), false)
  assert.throws(() => serializeResourceRef(hidden), ResourceRefValidationError)
})

test('direct objects reject accessors before validation and serialization', () => {
  let reads = 0
  const value = base()
  Object.defineProperty(value, 'version', {
    enumerable: true,
    get() {
      reads += 1
      return reads === 1 ? 'safe' : { api_key: 'secret' }
    },
  })
  assert.equal(isResourceRef(value), false)
  assert.equal(reads, 0)
  assert.throws(() => serializeResourceRef(value), ResourceRefValidationError)
  assert.equal(reads, 0)
})

test('nested values reject lossy own properties', () => {
  const hidden = { note: 'visible' }
  Object.defineProperty(hidden, 'hidden', { value: 'lost', enumerable: false })
  assert.equal(isResourceRef({ ...base(), metadata: hidden }), false)

  const symbol = { note: 'visible' }
  Object.defineProperty(symbol, Symbol('lost'), { value: 'lost', enumerable: true })
  assert.equal(isResourceRef({ ...base(), metadata: symbol }), false)

  const extraArray = [1]
  extraArray.extra = 'lost'
  assert.equal(isResourceRef({ ...base(), metadata: extraArray }), false)
})

test('raw JSON parser rejects invalid UTF-8 and unsupported kinds', () => {
  assert.throws(
    () => parseResourceRefJson(Uint8Array.from([0x7b, 0xff, 0x7d])),
    (error) =>
      error instanceof ResourceRefValidationError && error.issues[0].category === 'invalid_utf8',
  )
  assert.deepEqual(
    validateResourceRef({ ...base(), kind: 'Other' }).map((item) => item.category),
    ['unsupported_kind'],
  )
})

test('raw JSON parser rejects fractional and unsafe extension numbers before precision loss', () => {
  for (const number of ['1.0000000000000001', '1e-1000', '9007199254740992']) {
    const source =
      '{"api_version":"common.sudo.dev/v1","kind":"ResourceRef",' +
      '"zone_id":"workspace-main","path":"/file","future_value":' +
      number +
      '}'
    assert.throws(() => parseResourceRefJson(source), ResourceRefValidationError, number)
  }
})

test('raw JSON parser preserves mathematically integral safe number tokens', () => {
  for (const number of ['1.0', '1e0', '100e-2']) {
    const source =
      '{"api_version":"common.sudo.dev/v1","kind":"ResourceRef",' +
      '"zone_id":"workspace-main","path":"/file","future_value":' +
      number +
      '}'
    assert.equal(parseResourceRefJson(source).future_value, 1, number)
  }
})

test('known optional null rejects while bounded unknown null roundtrips', () => {
  assert.equal(isResourceRef({ ...base(), version: null }), false)
  const source = JSON.stringify({ ...base(), future_metadata: { note: null } })
  const parsed = parseResourceRefJson(source)
  assert.equal(parsed.future_metadata.note, null)
  assert.deepEqual(parseResourceRefJson(serializeResourceRef(parsed)), JSON.parse(source))
})

test('document bytes are bounded before parse and direct validation', () => {
  const oversized = '{"padding":"' + 'a'.repeat(MAX_RESOURCE_REF_JSON_BYTES) + '"}'
  assert.throws(
    () => parseResourceRefJson(oversized),
    (error) =>
      error instanceof ResourceRefValidationError &&
      error.issues[0].category === 'document_too_large',
  )
  assert.equal(
    validateResourceRef({
      ...base(),
      future_metadata: Array(17).fill('a'.repeat(4096)),
    }).some((item) => item.category === 'document_too_large'),
    true,
  )

  const metadata = Array(20).fill('x'.repeat(4096))
  Object.defineProperty(metadata, 'toJSON', { value: () => [], enumerable: false })
  assert.equal(
    validateResourceRef({ ...base(), metadata }).some(
      (item) => item.category === 'not_json_value',
    ),
    true,
  )

  let shared = 'x'.repeat(64)
  for (let depth = 0; depth < 8; depth += 1) shared = Array(64).fill(shared)
  assert.equal(
    validateResourceRef({ ...base(), metadata: shared }).some(
      (item) => item.category === 'document_too_large',
    ),
    true,
  )
})

test('accepted values are immutable and diagnostics do not reflect rejected values', () => {
  const parsed = parseResourceRefJson(JSON.stringify({ ...base(), future_metadata: { note: 'ok' } }))
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.future_metadata), true)

  const secret = 'do-not-reflect-this-value'
  const issues = validateResourceRef({ ...base(), vendor_metadata: { api_key: secret } })
  assert.equal(issues[0].category, 'secret_like_extension_key')
  assert.equal(JSON.stringify(issues).includes(secret), false)
})
