import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createEgressPolicy } from '@sudo/egress-policy'
import { readEgressPolicyFile, writeEgressPolicyFile } from '../src/egressPolicyFile.js'

void test('local policy replacement leaves one complete valid file and invalid input preserves the previous policy', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'egress-policy-'))
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('egress-policy-')) {
    throw new Error('Unexpected test cleanup directory')
  }
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'policy.json')
  const initial = createEgressPolicy({ modelMounts: ['/cloud-model'] })
  await writeEgressPolicyFile(filename, initial)
  const next = { ...initial, enabled: true, revision: 1 }
  await writeEgressPolicyFile(filename, next)
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), next)
  await assert.rejects(writeEgressPolicyFile(filename, { ...next, revision: -1 }))
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), next)
  assert.deepEqual(await readdir(directory), ['policy.json'])
  assert.deepEqual(readEgressPolicyFile(filename), next)
  await writeFile(filename, 'private-value-in-invalid-json')
  assert.throws(() => readEgressPolicyFile(filename), error => error instanceof Error &&
    !error.message.includes('private-value'))
  await writeFile(filename, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))
  assert.throws(() => readEgressPolicyFile(filename), /Invalid deployment egress policy JSON/)
  await writeFile(filename, 'a'.repeat(1024 * 1024 + 1))
  assert.throws(() => readEgressPolicyFile(filename), /exceeds size limit/)
  assert.throws(() => readEgressPolicyFile(directory))
})
