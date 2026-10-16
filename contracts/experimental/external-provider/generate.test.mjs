import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { sha256 } from '../../../tools/contracts/source.mjs'
import { renderExternalContract, validateExternalLock } from './generate.mjs'

const lock = JSON.parse(readFileSync(new URL('./source.lock.json', import.meta.url), 'utf8'))
test('experimental provenance rejects abbreviated revisions and foreign sources', () => {
  for (const patch of [{ revision: 'HEAD' }, { revision: lock.revision.slice(0, 8) }, { repository: 'https://github.com/other/moss' }, { path: '../arbitrary.ts' }, { maturity: 'stable' }]) {
    assert.throws(() => validateExternalLock({ ...lock, ...patch }))
  }
})
test('experimental generation rejects owner byte drift and ambiguous line endings', () => {
  const source = 'export const example = 1\n', pinned = { ...lock, digest: `sha256:${sha256(source)}` }
  assert.match(renderExternalContract(pinned, source), /Derived from Moss/)
  assert.throws(() => renderExternalContract(pinned, source.replace('1', '2')), /digest mismatch/)
  assert.throws(() => renderExternalContract(pinned, source.replace('\n', '\r\n')), /LF/)
})
