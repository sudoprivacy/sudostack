import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCohostModelConfiguration } from '../src/modelConfiguration.js'

void test('local and external accounts use independent mounts and credentials', () => {
  const result = buildCohostModelConfiguration([
    { id: 'local', mountPath: '/model', baseUrl: 'http://127.0.0.1:3000/v1', apiKey: 'local-only-token', models: ['qwen-local'] },
    { id: 'cloud', mountPath: '/cloud-model', baseUrl: 'https://router.example/v1/', apiKey: 'external-only-token', models: ['cloud-model'] },
  ])
  const engine = JSON.parse(result['sudocode.json']!)
  assert.equal(engine.auth_modes.proxy.local.baseUrl, 'nexus:///model')
  assert.equal(engine.auth_modes.proxy.cloud.baseUrl, 'nexus:///cloud-model')
  assert.equal(engine.models['qwen-local'].providers.proxy.provider, 'local')
  assert.equal(engine.models['cloud-model'].providers.proxy.provider, 'cloud')
  assert.ok(!result['sudocode.json']!.includes('only-token'))
  const mounts = JSON.parse(result['backend-config.json']!).mounts
  assert.equal(mounts.find((mount: { path: string }) => mount.path === '/model').backend_params.api_key, 'local-only-token')
  assert.equal(mounts.find((mount: { path: string }) => mount.path === '/cloud-model').backend_params.api_key, 'external-only-token')
})

void test('single-account model protocol selection remains owned by the engine', () => {
  const result = buildCohostModelConfiguration([{ id: 'moss-proxy', mountPath: '/model', baseUrl: 'https://router.example/v1/', apiKey: 'synthetic', models: ['gpt-model'] }])
  assert.deepEqual(JSON.parse(result['sudocode.json']!).models['gpt-model'].providers.proxy, { model: 'gpt-model' })
})
