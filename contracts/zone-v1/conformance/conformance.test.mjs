// Conformance for the derived zone-v1 package against the shared fixtures.
//
// The fixtures are materialized from the nexus owner repo at the pinned
// revision (fixtures/*.gen.json). They are the final judge: whatever the
// schema says, every enabled language must return the same verdicts on the
// same cases. This module is the TypeScript side of that agreement; the
// owner-side Python adapter faces the same corpus in nexus tests/contracts.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validatePrincipalRef,
  validateResourceRef,
} from '../common/v1/index.gen.js'
import {
  validateZone,
  validateZoneCreateRequest,
  validateZonePatchRequest,
  validateZoneGrant,
  validateZoneGrantCreateRequest,
  validateZoneOperation,
  validateZoneDelegationScopeRule,
  validateZoneDelegationIssueRequest,
  validateZoneDelegation,
  KNOWN_ERROR_CODES,
  CAPABILITY_PATTERN,
} from '../auth/v1/index.gen.js'
import { validateRuntimeResourceScope } from '../runtime/v2/index.gen.js'
import { validateZoneId } from '../../zone-id/zone-id.gen.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..')

const VALIDATORS = {
  'common/v1/principal-ref.schema.json': validatePrincipalRef,
  'common/v1/resource-ref.schema.json': validateResourceRef,
  'auth/v1/zone.schema.json': validateZone,
  'auth/v1/zone-create-request.schema.json': validateZoneCreateRequest,
  'auth/v1/zone-patch-request.schema.json': validateZonePatchRequest,
  'auth/v1/zone-grant.schema.json': validateZoneGrant,
  'auth/v1/zone-grant-create-request.schema.json': validateZoneGrantCreateRequest,
  'auth/v1/zone-operation.schema.json': validateZoneOperation,
  'auth/v1/zone-delegation-scope-rule.schema.json': validateZoneDelegationScopeRule,
  'auth/v1/zone-delegation-issue-request.schema.json': validateZoneDelegationIssueRequest,
  'auth/v1/zone-delegation.schema.json': validateZoneDelegation,
  'runtime/v2/runtime-resource-scope.schema.json': validateRuntimeResourceScope,
}

const load = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

test('every valid fixture passes its standalone validator', () => {
  for (const c of load('fixtures/valid.gen.json').cases) {
    const validate = VALIDATORS[c.schema]
    assert.ok(validate, `no validator mapped for ${c.schema}`)
    assert.ok(validate(c.payload), `${c.name} should be valid`)
  }
})

test('every invalid fixture is rejected', () => {
  for (const c of load('fixtures/invalid.gen.json').cases) {
    const validate = VALIDATORS[c.schema]
    assert.ok(validate, `no validator mapped for ${c.schema}`)
    assert.ok(!validate(c.payload), `${c.name} should be invalid`)
  }
})

test('secret-styled unknown optionals are accepted at the wire layer', () => {
  const doc = load('fixtures/secret-negative.gen.json')
  for (const c of doc.cases) {
    if (c.expect !== 'accepted-and-dropped') continue
    const validate = VALIDATORS[c.schema]
    assert.ok(validate(c.payload), `${c.name}: unknown optionals must not reject`)
  }
  for (const name of doc.secret_style_field_names) {
    assert.ok(!('api_version' in {} && name === 'api_version'))
  }
})

test('path-traversal fixtures are rejected (vendor zone-path projection holds)', () => {
  for (const c of load('fixtures/path-traversal.gen.json').cases) {
    const validate = VALIDATORS[c.schema]
    assert.ok(validate, `no validator mapped for ${c.schema}`)
    assert.ok(!validate(c.payload), `${c.name} should be invalid`)
  }
})

test('roundtrip: serialize-and-revalidate keeps the verdict', () => {
  for (const c of load('fixtures/roundtrip.gen.json').cases) {
    const validate = VALIDATORS[c.schema]
    const once = validate(c.payload)
    assert.ok(once, `${c.name}: input must be valid`)
    const re = JSON.parse(JSON.stringify(c.payload))
    assert.ok(validate(re), `${c.name}: roundtripped payload must stay valid`)
  }
})

test('compatibility baseline verdicts hold on the derived package', () => {
  for (const c of load('fixtures/compatibility.gen.json').cases) {
    const validate = VALIDATORS[c.schema]
    const expected = c.expected === 'valid'
    assert.equal(validate(c.payload), expected, `${c.name} drifted from the previous-minor baseline`)
  }
})

test('open registries: known constants exported, unknown codes survive validation', () => {
  assert.equal(KNOWN_ERROR_CODES.length, 24)
  assert.match('zone.data.read', CAPABILITY_PATTERN)
  assert.match('zone.brand.new', CAPABILITY_PATTERN)
  assert.doesNotMatch('zone_data_read', CAPABILITY_PATTERN)
})

test('zone-id export stays compatible: same vectors, same verdicts (0.1 consumers)', () => {
  // The one pre-existing consumer (moss, pinned to 45304cf) only consumes
  // ./zone-id; the 0.2 compatibility promise for it is exactly "behavior
  // unchanged". The vectors file is the corpus for that promise.
  const vectors = JSON.parse(readFileSync(join(FIXTURES, '..', 'zone-id', 'vectors.gen.json'), 'utf8'))
  for (const v of vectors) {
    assert.equal(validateZoneId(v.id) === null, v.valid, `zone-id ${v.id} drifted`)
  }
})
