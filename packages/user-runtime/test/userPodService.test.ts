import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { NexusZoneApiClient } from '@nexus-ai-fs/vfs-client'
import { UserPodService, userPodName, type UserPodOptions } from '../src/userPodService.js'
import type { RuntimeRelease } from '../src/runtimeRelease.js'
import { runtimeCredential } from './runtimeCredential.js'
import { userPodPlatform as platform } from './userPodPlatform.js'

const options: UserPodOptions = {
  image: 'runtime:verified', nodeHost: 'compute.internal', namespace: 'private-runtimes', storageClass: 'retained-local',
  issuer: { endpoint: 'https://control-plane', tls: { ca: '/ca', cert: '/moss', key: '/moss-key' } },
}

void test('same owner allocations keep independent Pods and volumes through concurrent creation and one allocation upgrade', async t => {
  const kube = platform(true)
  const issuedOwners: string[] = []
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async (owner: string) => {
    issuedOwners.push(owner); return runtimeCredential(owner)
  }, close() {} }))
  const runtime = new UserPodService(options, kube.resources, async () => {})
  t.after(() => runtime.close())
  const secondary = runtime.forAllocation('secondary')
  assert.equal(runtime.forAllocation('secondary'), secondary)
  assert.equal(secondary.forAllocation('primary'), runtime)
  assert.equal(await secondary.find('alice'), undefined)
  assert.equal(kube.writes.length, 0)
  const [primaryConfig, ...secondaryConfigs] = await Promise.all([
    runtime.resolve('alice'), ...Array.from({ length: 4 }, () => secondary.resolve('alice')),
  ])
  assert(secondaryConfigs.every(config => config.runtimeEndpoint === secondaryConfigs[0]!.runtimeEndpoint))
  assert.notEqual(primaryConfig!.runtimeEndpoint, secondaryConfigs[0]!.runtimeEndpoint)
  assert.deepEqual(issuedOwners, ['alice', 'alice'], 'placement must preserve the authenticated owner')
  const primaryName = userPodName('alice'), secondaryName = userPodName('alice', 'secondary')
  assert.notEqual(primaryName, secondaryName)
  const primaryPod = kube.objects.get(`pod:${primaryName}`)!, secondaryPod = kube.objects.get(`pod:${secondaryName}`)!
  const primaryVolume = kube.objects.get(`pvc:${primaryName}`), secondaryVolume = kube.objects.get(`pvc:${secondaryName}`)
  assert.notEqual(primaryVolume?.metadata.uid, secondaryVolume?.metadata.uid)
  for (const [name, pod] of [[primaryName, primaryPod], [secondaryName, secondaryPod]] as const) {
    const volumes = pod.spec!.volumes as Array<{ name: string; persistentVolumeClaim?: { claimName: string } }>
    assert.equal(volumes.find(volume => volume.name === 'data')?.persistentVolumeClaim?.claimName, name)
  }
  assert.equal(kube.writes.filter(write => write.kind === 'pod').length, 2)
  await secondary.upgrade('alice', async previous => { assert.equal(previous?.runtimeEndpoint, secondaryConfigs[0]!.runtimeEndpoint) })
  assert.equal(kube.objects.get(`pod:${primaryName}`), primaryPod)
  assert.notEqual(kube.objects.get(`pod:${secondaryName}`)?.metadata.uid, secondaryPod.metadata.uid)
  assert.equal(kube.objects.get(`pvc:${primaryName}`), primaryVolume)
  assert.equal(kube.objects.get(`pvc:${secondaryName}`), secondaryVolume)
  await runtime.close()
  await assert.rejects(secondary.resolve('alice'), /closed/)
  assert.throws(() => runtime.forAllocation('third'), /closed/)
})

void test('a newly created Pod receives projection notifications on later credential updates', async t => {
  const kube = platform()
  const projected: Array<{ name: string; uid: string; ownerId: string }> = []
  kube.resources.refreshProjection = async (name, uid, ownerId) => {
    assert.equal(uid, kube.objects.get('pod')!.metadata.uid)
    projected.push({ name, uid, ownerId })
  }
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({
    mintUserRuntime: async (owner: string) => runtimeCredential(owner), close() {},
  }))
  const service = new UserPodService(options, kube.resources, async () => {})
  t.after(() => service.close())
  await service.resolve('alice')
  assert.equal(projected.length, 0, 'initial credentials precede Pod creation')
  const pod = kube.objects.get('pod')!
  await service.resolve('alice', { 'sudocode.json': '{"model":"next-model"}', 'backend-config.json': '{"mounts":[]}' })
  assert.deepEqual(projected, [{ name: userPodName('alice'), uid: pod.metadata.uid!, ownerId: 'alice' }])
  assert.equal(kube.objects.get('pod'), pod)
})

void test('an allocation refuses same-owner resources attributed to another allocation before mutation', async t => {
  const kube = platform(true)
  const runtime = new UserPodService(options, kube.resources, async () => {})
  t.after(() => runtime.close())
  const secondary = runtime.forAllocation('secondary')
  kube.objects.set(`pod:${userPodName('alice', 'secondary')}`, { metadata: {
    name: userPodName('alice', 'secondary'), uid: randomUUID(),
    annotations: { 'moss.sudo.dev/runtime-owner': 'alice', 'moss.sudo.dev/runtime-allocation': 'primary' },
  } })
  await assert.rejects(secondary.inspect('alice'), /another allocation/)
  await assert.rejects(secondary.find('alice'), /another allocation/)
  await assert.rejects(secondary.resolve('alice'), /another allocation/)
  assert.equal(kube.writes.length, 0)
})

void test('primary placement names remain compatible and allocation IDs cannot become paths or resource names', () => {
  assert.equal(userPodName('4ffb1be9-5bad-43ec-9db4-f09f10141a37'), 'moss-user-54caa08a51f8902ed6bc4bf9e384a5a5cef0d1f1')
  assert.equal(userPodName('alice'), userPodName('alice', 'primary'))
  for (const allocation of ['', '../primary', '/primary', 'UPPER', 'a/b', 'a'.repeat(65)]) {
    assert.throws(() => userPodName('alice', allocation), /Invalid runtime allocation ID/)
  }
})

void test('cached readiness cannot hide an allocation mounting a sibling volume', async t => {
  const kube = platform(true)
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  const runtime = new UserPodService(options, kube.resources, async () => {})
  t.after(() => runtime.close())
  const secondary = runtime.forAllocation('secondary')
  await secondary.resolve('alice')
  const pod = kube.objects.get(`pod:${userPodName('alice', 'secondary')}`)!
  const volumes = pod.spec!.volumes as Array<{ name: string; persistentVolumeClaim?: { claimName: string } }>
  volumes.find(volume => volume.name === 'data')!.persistentVolumeClaim!.claimName = userPodName('alice')
  const writes = kube.writes.length
  await assert.rejects(secondary.resolve('alice'), /data volume does not belong/)
  await assert.rejects(secondary.inspect('alice'), /data volume does not belong/)
  assert.equal(kube.writes.length, writes, 'identity annotations cannot override the actual mounted PVC')
})

void test('Agent discovery does not provision a missing box and refuses another owner before mutation', async t => {
  const kube = platform()
  const service = new UserPodService(options, kube.resources, async () => {})
  t.after(() => service.close())
  assert.equal(await service.find('alice'), undefined)
  assert.equal(kube.writes.length, 0)
  kube.objects.set('pod', { metadata: { name: userPodName('alice'),
    annotations: { 'moss.sudo.dev/runtime-owner': 'bob' } } })
  await assert.rejects(service.find('alice'), /another owner/)
  assert.equal(kube.writes.length, 0)
})

void test('an owner rollout waits for drain, retains the PVC and blocks competing starts', async t => {
  const kube = platform()
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  const old = new UserPodService(options, kube.resources, async () => {})
  await old.resolve('alice')
  await old.close()
  const pvc = kube.objects.get('pvc')
  const podId = kube.objects.get('pod')!.metadata.uid
  const next = new UserPodService({ ...options, image: 'runtime:next-verified' }, kube.resources, async () => {})
  t.after(() => next.close())
  assert.equal((await next.inspect('alice')).isDrifted, true)
  await assert.rejects(next.upgrade('alice', async () => { throw new Error('Agent is busy') }), /Agent is busy/)
  assert.equal(kube.objects.get('pod')!.metadata.uid, podId, 'a busy owner keeps its original running Pod')
  assert.equal(kube.objects.has('upgrade-secret'), false)
  await next.upgrade('alice', async previous => {
    assert(previous?.runtimeEndpoint)
    assert.equal(kube.objects.get('pod')!.metadata.uid, podId)
    await assert.rejects(next.resolve('alice'), /draining/)
  })
  assert.notEqual(kube.objects.get('pod')!.metadata.uid, podId)
  assert.equal(kube.objects.get('pvc'), pvc, 'rollout retains exactly the original user volume')
  assert.equal((await next.inspect('alice')).isDrifted, false)
  assert.equal(kube.objects.has('upgrade-secret'), false)
})

void test('controller closure joins credential delivery before a replacement can write its Secret', async t => {
  const kube = platform()
  let isWaiting = false
  let releaseCredential!: () => void
  let markWaiting!: () => void
  const waiting = new Promise<void>(resolve => { markWaiting = resolve })
  const credentialReady = new Promise<void>(resolve => { releaseCredential = resolve })
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => {
    if (isWaiting) { markWaiting(); await credentialReady }
    return runtimeCredential('alice')
  }, close() {} }))
  const service = new UserPodService(options, kube.resources, async () => {})
  await service.resolve('alice')
  isWaiting = true
  const configuring = service.resolve('alice', { 'sudocode.json': '{"model":"next"}' })
  await waiting
  let isClosed = false
  const closing = service.close().then(() => { isClosed = true })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(isClosed, false, 'the prior controller cannot outlive its configuration write')
  releaseCredential()
  await Promise.all([configuring, closing])
  assert.equal(isClosed, true)
  const delivered = Buffer.from(kube.objects.get('secret')!.data!['sudocode.json']!, 'base64').toString()
  assert.equal(delivered, '{"model":"next"}')
})

void test('upgrade refuses a foreign identity and a Pod replaced during authenticated readiness', async t => {
  const kube = platform()
  let issued = 0
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => { issued++; return runtimeCredential('alice') }, close() {} }))
  const old = new UserPodService(options, kube.resources, async () => {})
  await old.resolve('alice')
  await old.close()
  const ownedSecret = kube.objects.get('secret')!
  kube.objects.set('secret', { ...ownedSecret, metadata: { ...ownedSecret.metadata,
    annotations: { 'moss.sudo.dev/runtime-owner': 'bob' } } })
  const next = new UserPodService({ ...options, image: 'runtime:next' }, kube.resources, async () => {
    const pod = kube.objects.get('pod')!
    kube.objects.set('pod', { ...pod, metadata: { ...pod.metadata, uid: randomUUID() } })
  })
  t.after(() => next.close())
  const drain = () => { throw new Error('Unchecked runtime must never drain') }
  await assert.rejects(next.upgrade('alice', drain), /Secret belongs to another owner/)
  assert.equal(issued, 1, 'foreign identity is refused before issuing credentials')
  assert.equal(kube.objects.has('upgrade-secret'), false)
  kube.objects.set('secret', ownedSecret)
  await assert.rejects(next.upgrade('alice', drain), /identity changed/)
  assert.equal(kube.objects.has('pod'), true, 'a concurrent Pod replacement remains intact')
  assert.equal(kube.objects.has('upgrade-secret'), false)
})

void test('a failed replacement restores the prior owner image and model configuration on the retained volume', async t => {
  const kube = platform()
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  const configuration = { 'sudocode.json': '{}', 'backend-config.json': '{"mounts":[{"owner":"alice"}]}' }
  const old = new UserPodService(options, kube.resources, async () => {})
  await old.resolve('alice', configuration)
  await old.close()
  const pvc = kube.objects.get('pvc')
  const write = kube.resources.write
  t.mock.method(kube.resources, 'write', async (manifest: Record<string, unknown>, verb?: 'create' | 'apply') => {
    await write(manifest, verb)
    const container = (manifest.spec as { containers?: Array<{ image: string }> })?.containers?.[0]
    if (manifest.kind === 'Pod' && container?.image === 'runtime:broken') kube.objects.get('pod')!.status = { phase: 'Failed' }
  })
  const service = new UserPodService({ ...options, image: 'runtime:broken' }, kube.resources, async () => {})
  t.after(() => service.close())
  await assert.rejects(service.upgrade('alice', async () => {}, { ...configuration,
    'backend-config.json': '{"mounts":[{"owner":"alice","new":true}]}' }), /exited before/)
  assert.equal(kube.objects.get('pvc'), pvc)
  assert.equal(kube.objects.has('upgrade-secret'), false)
  assert.equal((kube.objects.get('pod')!.spec!.containers as Array<{ image: string }>)[0]!.image, options.image)
  assert.equal(Buffer.from(kube.objects.get('secret')!.data!['backend-config.json']!, 'base64').toString(), configuration['backend-config.json'])
  assert.equal((await service.inspect('alice')).isDrifted, true, 'rollback remains visible as release drift')
  assert.equal((await service.resolve('alice', configuration)).runtimeEndpoint, 'https://compute.internal:31443')
})

void test('concurrent sessions share one user Pod without delivering cluster authority', async t => {
  const kube = platform()
  let issued = 0
  t.mock.method(NexusZoneApiClient, 'withMtls', (endpoint: string) => {
    assert.equal(endpoint, options.issuer.endpoint)
    return { mintUserRuntime: async (owner: string) => {
      assert.equal(owner, 'alice')
      issued++
      return runtimeCredential(owner)
    }, close() {} }
  })
  const service = new UserPodService(options, kube.resources, async () => {})
  t.after(() => service.close())
  const [a, b] = await Promise.all([service.resolve('alice'), service.resolve('alice')])
  assert.equal(a, b)
  assert.equal(issued, 1)
  assert.equal(kube.writes.filter(write => write.kind === 'service').length, 1)
  assert.equal(kube.writes.filter(write => write.kind === 'pod').length, 1)
  const secret = kube.writes.find(write => write.kind === 'secret')!.manifest.stringData as Record<string, string>
  const credentialManifest = JSON.parse(secret['credential.json']!) as { ca: string; cert: string; key: string }
  assert.deepEqual(Object.keys(secret).sort(), [credentialManifest.key, credentialManifest.cert, 'backend-config.json', credentialManifest.ca, 'credential.json', 'sudocode.json'].sort())
  assert.equal(JSON.stringify(kube.writes).includes('/moss-key'), false)
  assert.equal(a.tls, options.issuer.tls)
  assert.equal(a.authToken, '')
  assert.equal(a.endpoint, options.issuer.endpoint)
  assert.equal(a.runtimeEndpoint, 'https://compute.internal:31443')
  assert.notEqual(userPodName('alice'), userPodName('bob'))
  const updated = { 'sudocode.json': '{"auth_modes":{"proxy":{"moss":{"baseUrl":"https://model-gateway"}}}}' }
  await service.resolve('alice', updated)
  assert.equal(issued, 2)
  assert.equal(kube.writes.filter(write => write.kind === 'service').length, 1)
  assert.equal(kube.writes.filter(write => write.kind === 'pod').length, 1)
  assert.equal(Buffer.from(kube.objects.get('secret')!.data!['sudocode.json']!, 'base64').toString(), updated['sudocode.json'])
  await service.resolve('alice', updated)
  assert.equal(issued, 2, 'an unchanged owner configuration keeps its existing service')
  const write = kube.resources.write
  let isFailing = true
  t.mock.method(kube.resources, 'write', async (manifest: Record<string, unknown>, verb?: 'create' | 'apply') => {
    if (manifest.kind === 'Secret' && isFailing) {
      isFailing = false
      throw new Error('temporary Kubernetes failure')
    }
    return write(manifest, verb)
  })
  const replacement = { 'sudocode.json': '{"auth_modes":{"proxy":{"moss":{"baseUrl":"https://new-gateway"}}}}' }
  await assert.rejects(service.resolve('alice', replacement), /temporary Kubernetes failure/)
  await service.resolve('alice', replacement)
  assert.equal(issued, 4, 'failed configuration delivery is retried')
  assert.equal(kube.writes.filter(write => write.kind === 'service').length, 1)
  await assert.rejects(service.resolve('alice', { ...replacement,
    'backend-config.json': '{"mounts":[{"path":"/model","backend_type":"openai","backend_name":"other"}]}' }), /explicit runtime restart/)
  assert.equal(issued, 4, 'an active model backend never receives another provider configuration')
  await service.close()
  assert.ok(kube.objects.has('service'), 'controller closure retains the runtime network address')
  assert.ok(kube.objects.has('pvc'), 'controller closure retains user storage')
})

void test('concurrent requests recreate a lost owner Pod on the same PVC and configuration', async t => {
  const kube = platform()
  let issued = 0
  let verified = 0
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => {
    issued++
    return runtimeCredential('alice')
  }, close() {} }))
  const service = new UserPodService(options, kube.resources, async () => { verified++ })
  t.after(() => service.close())
  const configuration = { 'sudocode.json': '{"model":"owner-model"}', 'backend-config.json': '{"mounts":[{"owner":"alice"}]}' }
  await service.resolve('alice', configuration)
  const originalPod = kube.objects.get('pod')!.metadata.uid
  const originalPvc = kube.objects.get('pvc')
  const originalService = kube.objects.get('service')
  kube.objects.delete('pod')
  const [first, second] = await Promise.all([service.resolve('alice'), service.resolve('alice')])
  assert.equal(first, second)
  assert.notEqual(kube.objects.get('pod')!.metadata.uid, originalPod)
  assert.equal(kube.objects.get('pvc'), originalPvc)
  assert.equal(kube.objects.get('service'), originalService)
  assert.equal(kube.writes.filter(write => write.kind === 'pod').length, 2)
  assert.equal(issued, 2)
  assert.equal(verified, 2, 'the replacement needs authenticated readiness')
  for (const [key, value] of Object.entries(configuration)) {
    assert.equal(Buffer.from(kube.objects.get('secret')!.data![key]!, 'base64').toString(), value)
  }
})

void test('an externally replaced Pod invalidates cached readiness without creating another Pod', async t => {
  const kube = platform()
  let verified = 0
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  const service = new UserPodService(options, kube.resources, async () => { verified++ })
  t.after(() => service.close())
  await service.resolve('alice')
  kube.objects.get('pod')!.metadata.uid = randomUUID()
  await service.resolve('alice')
  assert.equal(verified, 2)
  assert.equal(kube.writes.filter(write => write.kind === 'pod').length, 1)
  const writes = kube.writes.length
  kube.objects.get('pod')!.metadata.annotations!['moss.sudo.dev/runtime-owner'] = 'bob'
  await assert.rejects(service.resolve('alice'), /another owner/)
  assert.equal(kube.writes.length, writes, 'a cached connection cannot authorize a foreign replacement')
})

void test('a restarted controller reuses the owned Pod, Service and retained volume', async t => {
  const kube = platform()
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  const service = new UserPodService(options, kube.resources, async () => {})
  t.after(() => service.close())
  await service.resolve('alice')
  await service.close()
  for (const resource of kube.objects.values()) delete resource.metadata.annotations?.['moss.sudo.dev/runtime-allocation']
  const restarted = new UserPodService(options, kube.resources, async () => {})
  t.after(() => restarted.close())
  const [a, b] = await Promise.all([restarted.resolve('alice'), restarted.resolve('alice')])
  assert.equal(a, b)
  assert.equal(kube.writes.filter(write => write.kind === 'service').length, 1)
  assert.equal(kube.writes.filter(write => write.kind === 'pod').length, 1)
  assert.equal(kube.writes.filter(write => write.kind === 'pvc').length, 1)
})

void test('a resource with another owner is refused before any credential or volume mutation', async t => {
  const kube = platform()
  kube.objects.set('pod', { metadata: { name: userPodName('alice'),
    annotations: { 'moss.sudo.dev/runtime-owner': 'bob' } } })
  t.mock.method(NexusZoneApiClient, 'withMtls', () => { throw new Error('issuer must not be opened') })
  const service = new UserPodService(options, kube.resources, async () => {})
  t.after(() => service.close())
  await assert.rejects(service.resolve('alice'), /another owner/)
  assert.equal(kube.writes.length, 0)
})

void test('a matching requested image cannot hide a running image with another digest', async t => {
  const kube = platform()
  const digest = `sha256:${'a'.repeat(64)}`
  const release: RuntimeRelease = { schemaVersion: 1, releaseId: 'server-v0.1.51',
    engine: { version: '0.2.28', commit: 'b2e2c57' },
    cohost: { version: '0.2.28', nexusVersion: '0.8.10', pluginAbi: 7, binaryDigest: digest },
    issuerVersion: '0.8.10', image: { reference: options.image, digest, digestKind: 'oci-config' },
    archive: { name: 'runtime.tar.gz', digest } }
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  kube.resources.observe = async () => ({ version: 'nexusd-cohost v0.2.28 (sudocode b2e2c57, nexus-vfs v0.8.10) (plugin-abi 7)', binaryDigest: digest })
  const write = kube.resources.write
  t.mock.method(kube.resources, 'write', async (manifest: Record<string, unknown>, verb?: 'create' | 'apply') => {
    await write(manifest, verb)
    if (manifest.kind === 'Pod') kube.objects.get('pod')!.status!.containerStatuses =
      [{ name: 'runtime', imageID: `sha256:${'b'.repeat(64)}` }]
  })
  const service = new UserPodService({ ...options, release }, kube.resources, async () => {})
  t.after(() => service.close())
  await assert.rejects(service.resolve('alice'), /runtime image differs/)
  assert.equal((await service.inspect('alice')).isDrifted, true)
  const status = kube.objects.get('pod')!.status!
  status.containerStatuses = [{ name: 'runtime', imageID: `docker.io/library/runtime@${digest}` }]
  await assert.rejects(service.resolve('alice'), /runtime image differs/, 'a manifest digest cannot substitute for a config digest')
  status.containerStatuses = [{ name: 'runtime', imageID: digest }]
  await service.resolve('alice')
  assert.equal((await service.inspect('alice')).isDrifted, false)
})

void test('controller restart preserves projected configuration and refuses a live provider change', async t => {
  const kube = platform()
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  const configuration = { 'sudocode.json': '{"auth_modes":{"proxy":{"moss":{"apiKey":"fixture"}}}}',
    'backend-config.json': '{"mounts":[{"path":"/model","backend_type":"anthropic"}]}' }
  const first = new UserPodService(options, kube.resources, async () => {})
  await first.resolve('alice', configuration)
  await first.close()
  const restarted = new UserPodService(options, kube.resources, async () => {})
  t.after(() => restarted.close())
  await restarted.resolve('alice')
  const delivered = kube.objects.get('secret')!.data!
  assert.equal(Buffer.from(delivered['sudocode.json']!, 'base64').toString(), configuration['sudocode.json'])
  assert.equal(Buffer.from(delivered['backend-config.json']!, 'base64').toString(), configuration['backend-config.json'])
  await restarted.close()
  const changed = new UserPodService(options, kube.resources, async () => {})
  t.after(() => changed.close())
  const before = kube.writes.length
  await assert.rejects(changed.resolve('alice', { ...configuration,
    'backend-config.json': '{"mounts":[]}' }), /explicit runtime restart/)
  assert.equal(kube.writes.length, before, 'restart cannot bypass the active backend configuration check')
})

void test('placement waits for authenticated readiness and controller closure cancels the wait', async t => {
  const kube = platform()
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({ mintUserRuntime: async () => runtimeCredential('alice'), close() {} }))
  let markStarted!: () => void
  const started = new Promise<void>(resolve => { markStarted = resolve })
  let isResolved = false
  const service = new UserPodService(options, kube.resources, async (config, owner, signal) => {
    assert.equal(config.runtimeEndpoint, 'https://compute.internal:31443')
    assert.equal(owner, 'alice')
    markStarted()
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const resolution = service.resolve('alice').then(() => { isResolved = true })
  const rejected = assert.rejects(resolution, /aborted/)
  await started
  assert.equal(isResolved, false, 'TCP Ready alone never publishes the connection')
  await service.close()
  await rejected
  assert.ok(kube.objects.has('pvc'))
})
