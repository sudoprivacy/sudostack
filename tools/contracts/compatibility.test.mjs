import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareSchemas } from './compatibility.mjs'

const clone = (value) => structuredClone(value)
const base = {
  $id: 'urn:test:resource',
  type: 'object',
  required: ['api_version', 'kind', 'path'],
  properties: {
    api_version: { const: 'common.sudo.dev/v1' },
    kind: { const: 'ResourceRef' },
    path: { type: ['string', 'null'], minLength: 1, maxLength: 256 },
    mode: { type: 'string', enum: ['one', 'two'] },
    target: { $ref: 'urn:test:path:v1' },
  },
  additionalProperties: true,
}

const expectBreaking = (mutate, rule) => {
  const changed = clone(base)
  mutate(changed)
  const result = compareSchemas(base, changed)
  assert.equal(result.status, 'breaking')
  assert.ok(result.findings.some((finding) => finding.rule === rule), JSON.stringify(result))
}

test('first schema is recorded as an initial baseline, not backward compatible', () => {
  assert.deepEqual(compareSchemas(null, base), { status: 'initial_baseline', findings: [] })
})

test('schema deletion is breaking', () => {
  const result = compareSchemas(base, null)
  assert.equal(result.status, 'breaking')
  assert.equal(result.findings[0].rule, 'schema_deleted')
})

test('kind/property deletion is breaking', () => {
  expectBreaking((schema) => delete schema.properties.kind, 'property_deleted')
})

test('new required property is breaking', () => {
  expectBreaking((schema) => schema.required.push('mode'), 'required_added')
})

test('type removal including nullability is breaking', () => {
  expectBreaking((schema) => {
    schema.properties.path.type = 'string'
  }, 'type_removed')
})

test('const changes are breaking', () => {
  expectBreaking((schema) => {
    schema.properties.kind.const = 'Other'
  }, 'const_changed')
})

test('enum value removal is breaking', () => {
  expectBreaking((schema) => {
    schema.properties.mode.enum = ['one']
  }, 'enum_value_removed')
})

test('new and tightened bounds are breaking', () => {
  expectBreaking((schema) => {
    schema.properties.path.minLength = 2
  }, 'lower_bound_tightened')
  expectBreaking((schema) => {
    schema.properties.path.maxLength = 128
  }, 'upper_bound_tightened')
})

test('new or changed patterns are breaking', () => {
  expectBreaking((schema) => {
    schema.properties.path.pattern = '^/'
  }, 'pattern_changed')
})

test('additionalProperties tightening is breaking', () => {
  expectBreaking((schema) => {
    schema.additionalProperties = false
  }, 'additional_properties_tightened')
})

test('$ref target changes are breaking', () => {
  expectBreaking((schema) => {
    schema.properties.target.$ref = 'urn:test:path:v2'
  }, 'ref_target_changed')
})

test('unknown changed keywords fail closed for manual review', () => {
  const changed = clone(base)
  changed.properties.path.futureKeyword = true
  const result = compareSchemas(base, changed)
  assert.equal(result.status, 'manual_review')
  assert.ok(result.findings.some((finding) => finding.rule === 'unknown_keyword_changed'))
})

test('object key order does not change const or enum compatibility', () => {
  const previous = {
    const: { a: 1, b: 2 },
    enum: [{ first: true, second: false }],
  }
  const current = {
    const: { b: 2, a: 1 },
    enum: [{ second: false, first: true }],
  }
  assert.deepEqual(compareSchemas(previous, current), { status: 'compatible', findings: [] })
})

test('referenced definitions and property-name constraints cannot tighten silently', () => {
  const previous = {
    type: 'object',
    propertyNames: { pattern: '^[a-z]+$' },
    additionalProperties: { $ref: '#/$defs/value' },
    $defs: { value: { type: 'string', maxLength: 10 } },
  }
  const changedDefinition = clone(previous)
  changedDefinition.$defs.value.maxLength = 2
  assert.equal(compareSchemas(previous, changedDefinition).status, 'breaking')

  const changedPropertyNames = clone(previous)
  changedPropertyNames.propertyNames.pattern = '^a'
  assert.equal(compareSchemas(previous, changedPropertyNames).status, 'breaking')
})

test('new optional properties are compared with their previous extension allowance', () => {
  const previous = { type: 'object', properties: {}, additionalProperties: true }
  const current = {
    type: 'object',
    properties: { future_value: { type: 'string' } },
    additionalProperties: true,
  }
  const result = compareSchemas(previous, current)
  assert.equal(result.status, 'breaking')
  assert.ok(result.findings.some((finding) => finding.rule === 'optional_property_narrowed'))
})

test('new properties that overlap patternProperties require review', () => {
  const previous = {
    type: 'object',
    properties: {},
    patternProperties: { '^future_': { type: 'string' } },
    additionalProperties: false,
  }
  const current = clone(previous)
  current.properties.future_value = { type: 'string', maxLength: 1 }
  const result = compareSchemas(previous, current)
  assert.equal(result.status, 'manual_review')
  assert.ok(
    result.findings.some((finding) => finding.rule === 'pattern_property_intersection_changed'),
  )
})

test('__proto__ property additions and deletions use own-property semantics', () => {
  const open = { type: 'object', properties: JSON.parse('{}'), additionalProperties: true }
  const constrained = {
    type: 'object',
    properties: JSON.parse('{"__proto__":{"type":"string"}}'),
    additionalProperties: true,
  }
  const addition = compareSchemas(open, constrained)
  assert.equal(addition.status, 'breaking')
  assert.ok(addition.findings.some((finding) => finding.rule === 'optional_property_narrowed'))

  const deletion = compareSchemas(constrained, open)
  assert.notEqual(deletion.status, 'compatible')
  assert.ok(deletion.findings.some((finding) => finding.rule === 'property_deleted'))
})

test('applicator and runtime-policy changes never pass silently', () => {
  const withNot = clone(base)
  withNot.not = { required: ['version'] }
  assert.equal(compareSchemas(base, withNot).status, 'manual_review')

  const withConditional = clone(base)
  withConditional.if = { required: ['version'] }
  withConditional.then = { required: ['digest'] }
  assert.equal(compareSchemas(base, withConditional).status, 'manual_review')

  const previousBound = { ...clone(base), 'x-sudo-max-json-bytes': 65_536 }
  const currentBound = { ...clone(base), 'x-sudo-max-json-bytes': 1 }
  assert.equal(compareSchemas(previousBound, currentBound).status, 'breaking')
})

test('new refs and false item schemas are breaking', () => {
  const previousRef = { type: 'string', $defs: { value: { type: 'string' } } }
  const currentRef = { ...clone(previousRef), $ref: '#/$defs/value' }
  assert.equal(compareSchemas(previousRef, currentRef).status, 'breaking')

  const previousItems = { type: 'array', items: true }
  const currentItems = { type: 'array', items: false }
  assert.equal(compareSchemas(previousItems, currentItems).status, 'breaking')
})
