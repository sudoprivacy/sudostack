import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createEgressPolicy } from '../src/index.js'

test('deployment checks enforce default-off and keep local model mounts outside the edge gate', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'egress-cli-'))
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(directory).startsWith('egress-cli-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'policy.json')
  const cli = fileURLToPath(new URL('../bin/check-profile.mjs', import.meta.url))
  writeFileSync(filename, JSON.stringify(createEgressPolicy({ modelMounts: ['/cloud-model'] })))
  const check = args => spawnSync(process.execPath, [cli, filename, ...args], { encoding: 'utf8' })
  assert.equal(check(['--expect-disabled', '--model-mount', '/cloud-model', '--exclude-model-mount', '/model']).status, 0)
  assert.notEqual(check(['--expect-enabled']).status, 0)
  assert.notEqual(check(['--model-mount', '/wrong-mount']).status, 0)
  writeFileSync(filename, 'synthetic-private-business-value')
  const invalid = check([])
  assert.notEqual(invalid.status, 0)
  assert.ok(!invalid.stderr.includes('synthetic-private-business-value'))
})
