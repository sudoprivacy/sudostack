import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { NexusZoneApiClient } from '@nexus-ai-fs/vfs-client'
import { createEgressPolicy, POLICY_FILENAME } from '@sudo/egress-policy'
import { UserPodService, UserRuntimeUpdateRequiredError, userPodName, type UserPodOptions } from '../src/userPodService.js'
import type { RuntimeRelease } from '../src/runtimeRelease.js'
import { runtimeCredential } from './runtimeCredential.js'
import { userPodPlatform } from './userPodPlatform.js'

function release(version: string, image: string, byte: string): RuntimeRelease {
  const digest = `sha256:${byte.repeat(64)}`
  return { schemaVersion: 1, releaseId: `test-${version}`,
    engine: { version, commit: 'abcdef0' },
    cohost: { version, nexusVersion: '0.8.26', pluginAbi: 7, binaryDigest: digest },
    issuerVersion: '0.8.26', image: { reference: image, digest, digestKind: 'oci-config' },
    archive: { name: 'test-runtime.tar.gz', digest } }
}

function fixture(t: TestContext) {
  const old = release('0.2.37', 'runtime:test-old', 'a')
  const next = release('0.2.38', 'runtime:test-next', 'b')
  const kube = userPodPlatform(true)
  const versions = new Map([old, next].map(value => [value.image.reference, value]))
  const options: UserPodOptions = { image: old.image.reference, release: old,
    nodeHost: 'compute.internal', namespace: 'test-runtimes', storageClass: 'retained-local',
    issuer: { endpoint: 'https://issuer.internal', tls: { ca: '/ca', cert: '/controller', key: '/controller-key' } } }
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({
    mintUserRuntime: async (owner: string) => runtimeCredential(owner), close() {},
  }))
  const write = kube.resources.write
  kube.resources.write = async (manifest, verb) => {
    await write(manifest, verb)
    if (manifest.kind === 'Pod') {
      const metadata = manifest.metadata as { name: string }
      const pod = kube.objects.get(`pod:${metadata.name}`)!
      const image = (pod.spec!.containers as Array<{ image: string }>)[0]!.image
      pod.status!.containerStatuses = [{ name: 'runtime', imageID: versions.get(image)!.image.digest }]
    }
  }
  kube.resources.observe = async name => {
    const pod = kube.objects.get(`pod:${name}`)!
    const image = (pod.spec!.containers as Array<{ image: string }>)[0]!.image
    const observed = versions.get(image)!
    return { version: `nexusd-cohost v${observed.cohost.version} (sudocode abcdef0, nexus-vfs v0.8.26) (plugin-abi 7)`, binaryDigest: observed.cohost.binaryDigest }
  }
  return { next, kube, options }
}

void test('owner rollout keeps other owners available and upgrades only the selected allocation with verified provenance', async t => {
  const { next, kube, options } = fixture(t)
  const original = new UserPodService(options, kube.resources, async () => {})
  const model = { 'backend-config.json': '{"mounts":[{"credential":"alice-model"}]}', 'sudocode.json': '{}' }
  await original.resolve('alice', model)
  await original.forAllocation('secondary').resolve('alice', model)
  await original.resolve('bob', { ...model, 'backend-config.json': '{"mounts":[{"credential":"bob-model"}]}' })
  await original.close()
  const alice = userPodName('alice'), secondary = userPodName('alice', 'secondary'), bob = userPodName('bob')
  const before = new Map([alice, secondary, bob].map(name => [name, kube.objects.get(`pod:${name}`)!]))
  const volume = kube.objects.get(`pvc:${alice}`), network = kube.objects.get(`service:${alice}`)
  const overrides = { alice: { release: next, egressAnalyzerRelay: { image: 'relay:verified', secretName: 'classifier' } } }
  const service = new UserPodService({ ...options, ownerRuntimeOverrides: overrides }, kube.resources, async () => {})
  t.after(() => service.close())
  overrides.alice.release = { ...next, image: { ...next.image, reference: 'runtime:unexpected-mutation' } }
  assert.equal((await service.inspect('alice')).isDrifted, true)
  assert.equal((await service.inspect('bob')).isDrifted, false)
  assert.equal((await service.forAllocation('secondary').inspect('alice')).expectedImage, next.image.reference)
  await assert.rejects(service.resolve('alice'), UserRuntimeUpdateRequiredError)
  await assert.rejects(service.configurePolicy('alice', createEgressPolicy()), UserRuntimeUpdateRequiredError)
  await service.find('alice')
  await service.resolve('bob')
  assert.equal(kube.objects.get(`pod:${bob}`), before.get(bob))
  assert.equal(kube.objects.get(`pod:${alice}`), before.get(alice))
  await service.upgrade('alice', async previous => {
    assert(previous)
    await service.resolve('bob')
    assert.equal(kube.objects.get(`pod:${bob}`), before.get(bob))
  })
  assert.notEqual(kube.objects.get(`pod:${alice}`)!.metadata.uid, before.get(alice)!.metadata.uid)
  assert.equal(kube.objects.get(`pod:${secondary}`), before.get(secondary))
  assert.equal(kube.objects.get(`pvc:${alice}`), volume)
  assert.equal(kube.objects.get(`service:${alice}`), network)
  assert.equal((await service.inspect('alice')).releaseId, next.releaseId)
  assert.equal((await service.inspect('alice')).isDrifted, false)
  const containers = kube.objects.get(`pod:${alice}`)!.spec!.containers as Array<{ name: string }>
  assert(containers.some(container => container.name === 'egress-analyzer-relay'))
  const policy = createEgressPolicy({ revision: 9, modelMounts: ['/model'] })
  await service.configurePolicy('alice', policy)
  const configuration = kube.objects.get(`secret:${alice}`)!.data!
  assert.equal(Buffer.from(configuration['backend-config.json']!, 'base64').toString(), model['backend-config.json'])
  assert.deepEqual(JSON.parse(Buffer.from(configuration[POLICY_FILENAME]!, 'base64').toString()), policy)
  assert.equal((await service.forAllocation('secondary').inspect('alice')).isDrifted, true)
  await service.close()
  await assert.rejects(service.resolve('alice'), /closed/)
  assert.throws(() => service.forAllocation('secondary'), /closed/)
})

void test('owner overrides reject invalid releases before provisioning and retain binary verification after controller restart', async t => {
  const { next, kube, options } = fixture(t)
  assert.throws(() => new UserPodService({ ...options, ownerRuntimeOverrides: {
    alice: { release: { ...next, image: { ...next.image, reference: 'runtime:latest' } } },
  } }, kube.resources, async () => {}))
  assert.equal(kube.writes.length, 0)
  const selected: UserPodOptions = { ...options, ownerRuntimeOverrides: { alice: { release: next } } }
  const first = new UserPodService(selected, kube.resources, async () => {})
  await first.resolve('alice')
  await first.resolve('bob')
  await first.close()
  const observe = kube.resources.observe!
  kube.resources.observe = async name => {
    const result = await observe(name)
    return name === userPodName('alice') ? { ...result, binaryDigest: `sha256:${'c'.repeat(64)}` } : result
  }
  const restarted = new UserPodService(selected, kube.resources, async () => {})
  t.after(() => restarted.close())
  await assert.rejects(restarted.resolve('alice'), /verified release manifest/)
  await restarted.resolve('bob')
  assert.equal((await restarted.inspect('bob')).isDrifted, false)
})
