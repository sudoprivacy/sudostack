import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, chmodSync, statSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./configure.mjs', import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sudo-node-preflight-'))
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert(root.startsWith(join(resolve(tmpdir()), 'sudo-node-preflight-')))
    rmSync(root, { recursive: true })
  })
  const configuration = { version: 1, dataDirectory: join(root, 'private-state'), bindAddress: '127.0.0.1',
    port: 9448, serverName: 'egress-node.internal', analyzerImage: 'unused-analyzer:fixture',
    gatewayImage: 'unused-gateway:fixture', namespace: 'fixture', relaySecretName: 'fixture-analyzer' }
  const input = join(root, 'input.json')
  return { root, configuration, run(value) {
    writeFileSync(input, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 })
    return spawnSync(process.execPath, [script, input], { encoding: 'utf8' })
  } }
}
test('malformed private deployment input is refused without repeating its values', { skip: process.platform !== 'linux' }, t => {
  const f = fixture(t)
  const result = f.run('{"password":"private-test-secret", BROKEN')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Invalid node analyzer deployment JSON/)
  assert(!result.stderr.includes('private-test-secret'))
  assert(!existsSync(f.configuration.dataDirectory))
  const invalidPlacement = f.run({ ...f.configuration, relayMode: 'arbitrary' })
  assert.notEqual(invalidPlacement.status, 0)
  assert.match(invalidPlacement.stderr, /Invalid node analyzer deployment configuration/)
  assert(!existsSync(f.configuration.dataDirectory))
  const invalid = f.run({ ...f.configuration, namespace: undefined })
  assert.notEqual(invalid.status, 0)
  assert(!existsSync(f.configuration.dataDirectory))
})
test('refusing an unowned nonempty directory preserves its files and access mode', { skip: process.platform !== 'linux' }, t => {
  const f = fixture(t)
  mkdirSync(f.configuration.dataDirectory)
  chmodSync(f.configuration.dataDirectory, 0o755)
  const existing = join(f.configuration.dataDirectory, 'operator-data')
  writeFileSync(existing, 'preserved operator data')
  const result = f.run(f.configuration)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /nonempty unowned/)
  assert.equal(statSync(f.configuration.dataDirectory).mode & 0o777, 0o755)
  assert.equal(readFileSync(existing, 'utf8'), 'preserved operator data')
  assert(!existsSync(join(f.configuration.dataDirectory, 'deployment.json')))
})

test('a remote node address is rejected before creating state or starting infrastructure', { skip: process.platform !== 'linux' }, t => {
  const f = fixture(t)
  const result = f.run({ ...f.configuration, bindAddress: '203.0.113.17' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /bind address does not belong to this host/)
  assert(!existsSync(f.configuration.dataDirectory))
})
test('a different node binding cannot replace an existing deployment or change its permissions', { skip: process.platform !== 'linux' }, t => {
  const f = fixture(t)
  mkdirSync(f.configuration.dataDirectory)
  chmodSync(f.configuration.dataDirectory, 0o755)
  const marker = join(f.configuration.dataDirectory, 'deployment.json')
  const previous = JSON.stringify({ version: 1, serverName: 'another-node.internal' })
  writeFileSync(marker, previous)
  const result = f.run(f.configuration)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /different node or namespace/)
  assert.equal(readFileSync(marker, 'utf8'), previous)
  assert.equal(statSync(f.configuration.dataDirectory).mode & 0o777, 0o755)
})

test('shared placement cannot silently replace a node-bound deployment identity', { skip: process.platform !== 'linux' }, t => {
  const f = fixture(t)
  mkdirSync(f.configuration.dataDirectory)
  const marker = join(f.configuration.dataDirectory, 'deployment.json')
  const { serverName, bindAddress, port, namespace, relaySecretName } = f.configuration
  const previous = JSON.stringify({ version: 1, serverName, bindAddress, port, namespace, relaySecretName })
  writeFileSync(marker, previous)
  const result = f.run({ ...f.configuration, relayMode: 'shared' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /different node or namespace/)
  assert.equal(readFileSync(marker, 'utf8'), previous)
})
