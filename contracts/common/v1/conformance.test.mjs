/**
 * Common contract artifacts must accept every published valid fixture and
 * reject every published invalid fixture. The test imports the generated
 * TypeScript file directly, so consumers and CI exercise the same artifact.
 *
 * Run: node --experimental-strip-types --test contracts/common/v1/conformance.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles } from '../../../tools/schema-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../../..')
const fixturesRoot = join(REPO, 'fixtures')
const mod = await import('./common.gen.ts')

test('generated common validators accept valid fixtures', () => {
  for (const path of fixtureFiles('valid')) {
    const value = readJson(path)
    const result = mod.safeParseCommon(value)
    assert.equal(result.ok, true, label(path, result))
  }
})

test('generated common validators reject invalid fixtures', () => {
  for (const path of fixtureFiles('invalid')) {
    const value = readJson(path)
    const result = mod.safeParseCommon(value)
    assert.equal(result.ok, false, `${label(path)} should be rejected`)
    assert.ok(result.issues.length > 0, `${label(path)} should explain why it was rejected`)
  }
})

test('generated common validators preserve roundtrip fixtures', () => {
  for (const path of fixtureFiles('roundtrip')) {
    const value = readJson(path)
    const result = mod.safeParseCommon(JSON.parse(JSON.stringify(value)))
    assert.equal(result.ok, true, label(path, result))
    assert.deepEqual(JSON.parse(JSON.stringify(result.value)), value, `${label(path)} changed during parse`)
  }
})

test('typed helpers refuse the wrong common kind', () => {
  const errorInfo = readJson(join(fixturesRoot, 'valid/common/v1/error-info/minimal.json'))
  const result = mod.safeParseResourceRef(errorInfo)
  assert.equal(result.ok, false)
  assert.match(result.issues[0].message, /expected ResourceRef/)
})

function fixtureFiles(kind) {
  return listFiles(join(fixturesRoot, kind, 'common/v1'), (path) => path.endsWith('.json'))
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function label(path, result = null) {
  const name = relative(REPO, path)
  if (!result || result.ok) return name
  return `${name}: ${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
}
