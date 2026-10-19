import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { test } from 'node:test'
import { files, validateLock, verifySource } from './generate.mjs'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const lock = JSON.parse(read('./source.lock.json'))
test('Registry artifact closure is exact and rejects foreign owners, abbreviated pins and byte drift', () => {
  for (const file of files) {
    const source = read(`./${file}`)
    assert.equal(verifySource(lock, file, source), source)
    assert.throws(() => verifySource(lock, file, source + '\n'))
  }
  assert.throws(() => validateLock({ ...lock, revision: lock.revision.slice(0, 8) }))
  assert.throws(() => validateLock({ ...lock, repository: 'https://github.com/other/nexus' }))
  assert.throws(() => validateLock({ ...lock, files: {} }))
})
test('Python owner signature fixture verifies in Node and rejects modified payloads', () => {
  const fixture = JSON.parse(read('./signed-version.fixture.json'))
  const signed = fixture.version, payload = Buffer.from(signed.payload_base64, 'base64')
  const publicKey = createPublicKey(fixture.public_key_pem)
  assert.equal(verify(null, payload, publicKey, Buffer.from(signed.signature_base64, 'base64')), true)
  assert.equal(`sha256:${createHash('sha256').update(payload).digest('hex')}`, signed.digest)
  assert.deepEqual(JSON.parse(payload.toString()), signed.manifest)
  assert.equal(verify(null, Buffer.concat([payload, Buffer.from(' ')]), publicKey, Buffer.from(signed.signature_base64, 'base64')), false)
})
