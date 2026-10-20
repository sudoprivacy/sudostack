import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import { files, validateLock, verifySource } from './generate.mjs'
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const lock = JSON.parse(read('./source.lock.json'))
test('pre-write receipt projection pins exact owner, source paths and bytes', () => {
  for (const file of files) {
    const source = read(`./${file}`)
    assert.equal(verifySource(lock, file, source), source)
    assert.throws(() => verifySource(lock, file, source + '\n'))
  }
  for (const patch of [{ revision: lock.revision.slice(0, 8) }, { repository: 'https://github.com/other/nexus-vfs' }, { files: {} }]) assert.throws(() => validateLock({ ...lock, ...patch }))
})
test('owner fixture validates and unsupported or incomplete receipts fail closed', () => {
  const validate = new Ajv2020({ strict: true }).compile(JSON.parse(read('./schema.json')))
  const fixture = JSON.parse(read('./fixture.json'))
  assert(validate(fixture))
  for (const patch of [{ schema_version: 2 }, { stage: 'post_write' }, { request_digest: 'missing' }, { operation: 'read' }]) assert.equal(validate({ ...fixture, data: { ...fixture.data, ...patch } }), false)
})
