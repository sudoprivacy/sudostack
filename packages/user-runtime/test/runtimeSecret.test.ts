import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { renewRuntimeSecretData } from '../src/runtimeSecret.js'
import { runtimeCredential } from './runtimeCredential.js'

void test('large renewal history retires only expired trusted owner files and preserves referenced credentials', () => {
  const owner = 'secret-owner'
  const expired = runtimeCredential(owner, true)
  const current = runtimeCredential(owner)
  const foreign = runtimeCredential('other-owner', true)
  const data: Record<string, string> = {}
  const write = (label: string, credential: typeof expired) => {
    const prefix = createHash('sha256').update(label).digest('hex')
    for (const [suffix, bytes] of [['ca', credential.caPem], ['cert', credential.certPem], ['key', credential.keyPem]] as const) {
      data[`${prefix}.${suffix}.pem`] = bytes.toString('base64')
    }
    return prefix
  }
  const historical = Array.from({ length: 180 }, (_, index) => write(`expired-${index}`, expired))
  const unexpired = write('unexpired', current)
  const otherOwner = write('foreign-owner', foreign)
  const referenced = write('referenced', expired)
  const customReferenced = write('custom-referenced', expired)
  const unknown = createHash('sha256').update('malformed').digest('hex') + '.cert.pem'
  data[unknown] = Buffer.from('Unknown writer data').toString('base64')
  const configuration = JSON.stringify({ mounts: [{ cert: `${referenced}.cert.pem` }] })
  data['backend-config.json'] = Buffer.from(configuration).toString('base64')
  data['application.conf'] = Buffer.from(`certificate=${customReferenced}.cert.pem`).toString('base64')
  data['sudocode.json'] = Buffer.from('{"model":"retained-owner-model"}').toString('base64')
  data['unrelated.key.pem'] = Buffer.from('Retain this caller-owned value').toString('base64')
  assert(JSON.stringify(data).length > 262_144, 'Reproduce the real apply annotation size boundary')
  const next = { 'credential.json': '{"version":1}', 'new-credential.pem': current.certPem.toString() }
  const renewed = renewRuntimeSecretData(owner, data, next, current.caPem)
  for (const prefix of historical) {
    for (const suffix of ['ca', 'cert', 'key']) assert.equal(renewed[`${prefix}.${suffix}.pem`], undefined)
  }
  for (const prefix of [unexpired, otherOwner, referenced, customReferenced]) {
    for (const suffix of ['ca', 'cert', 'key']) assert.equal(renewed[`${prefix}.${suffix}.pem`], data[`${prefix}.${suffix}.pem`])
  }
  for (const key of [unknown, 'sudocode.json', 'backend-config.json', 'application.conf', 'unrelated.key.pem']) assert.equal(renewed[key], data[key])
  for (const [key, value] of Object.entries(next)) assert.equal(Buffer.from(renewed[key]!, 'base64').toString(), value)
  assert(JSON.stringify(renewed).length < 32_768)
  assert(data[`${historical[0]}.cert.pem`], 'The observed resource is not mutated')
})
