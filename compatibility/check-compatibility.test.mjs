// Self-check for the compatibility checker: B4 requires evidence that it can
// catch required/type/validation breaking changes — a self-declared "green"
// is worthless if the detector itself has never fired. These tests feed it
// synthetic old/new pairs where exactly one breaking change (or none) was
// introduced, and assert the verdict.
import test from 'node:test'
import assert from 'node:assert/strict'
import { diffSets } from './check-compatibility.mjs'

const base = (id, props, required) => ({
  $id: id,
  type: 'object',
  properties: props,
  required,
})

test('detects required-added', () => {
  const old = base('https://x/v1/a.schema.json', { name: { type: 'string' }, note: { type: 'string' } }, ['name'])
  const now = base('https://x/v1/a.schema.json', { name: { type: 'string' }, note: { type: 'string' } }, ['name', 'note'])
  const findings = diffSets({ [old.$id]: old }, { [now.$id]: now })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].kind, 'required-added')
  assert.equal(findings[0].field, 'note')
})

test('detects type-changed', () => {
  const old = base('https://x/v1/a.schema.json', { size: { type: 'string' } }, ['size'])
  const now = base('https://x/v1/a.schema.json', { size: { type: 'integer' } }, ['size'])
  const findings = diffSets({ [old.$id]: old }, { [now.$id]: now })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].kind, 'type-changed')
})

test('detects validation tightening: enum shrinks', () => {
  const old = base('https://x/v1/a.schema.json', { status: { enum: ['a', 'b', 'c'] } }, ['status'])
  const now = base('https://x/v1/a.schema.json', { status: { enum: ['a', 'b'] } }, ['status'])
  const findings = diffSets({ [old.$id]: old }, { [now.$id]: now })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].kind, 'validation-tightened')
  assert.equal(findings[0].rule, 'enum-shrunk')
})

test('detects validation tightening: maxLength shrinks', () => {
  const old = base('https://x/v1/a.schema.json', { n: { type: 'string', maxLength: 63 } }, ['n'])
  const now = base('https://x/v1/a.schema.json', { n: { type: 'string', maxLength: 40 } }, ['n'])
  const findings = diffSets({ [old.$id]: old }, { [now.$id]: now })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'maxLength')
})

test('detects validation tightening: minLength grows', () => {
  const old = base('https://x/v1/a.schema.json', { n: { type: 'string', minLength: 3 } }, ['n'])
  const now = base('https://x/v1/a.schema.json', { n: { type: 'string', minLength: 8 } }, ['n'])
  const findings = diffSets({ [old.$id]: old }, { [now.$id]: now })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'minLength')
})

test('clean changelog: additive-only changes stay silent', () => {
  const old = base('https://x/v1/a.schema.json', { name: { type: 'string' } }, ['name'])
  const now = base('https://x/v1/a.schema.json', { name: { type: 'string' }, extra: { type: 'string' } }, ['name'])
  const findings = diffSets({ [old.$id]: old }, { [now.$id]: now })
  assert.equal(findings.length, 0)
})

test('relaxations stay silent (maxLength grows)', () => {
  const old = base('https://x/v1/a.schema.json', { n: { type: 'string', maxLength: 40 } }, ['n'])
  const now = base('https://x/v1/a.schema.json', { n: { type: 'string', maxLength: 63 } }, ['n'])
  const findings = diffSets({ [old.$id]: old }, { [now.$id]: now })
  assert.equal(findings.length, 0)
})
