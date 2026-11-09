import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NexusZoneApiClient } from '@nexus-ai-fs/vfs-client'
import { UserPodService, userPodName, type UserPodOptions, type UserPodResources } from '../src/userPodService.js'
import type { K8sResource } from '../src/k8sResources.js'

const options: UserPodOptions = {
  image: 'runtime:verified', nodeHost: 'compute.internal', namespace: 'private-runtimes', storageClass: 'retained-local',
  issuer: { endpoint: 'https://control-plane', tls: { ca: '/ca', cert: '/controller', key: '/controller-key' } },
}

function resource(kind: 'pvc' | 'pod', allocation = 'primary'): K8sResource {
  const name = userPodName('alice', allocation)
  return { metadata: { name, namespace: options.namespace, uid: `${kind}-original`, resourceVersion: '12',
    annotations: { 'moss.sudo.dev/runtime-owner': 'alice', 'moss.sudo.dev/runtime-allocation': allocation } },
  ...(kind === 'pod' ? { spec: { volumes: [{ name: 'data', persistentVolumeClaim: { claimName: name } }] } } : {}) }
}

void test('storage inspection reads only PVC and Pod, preserves distinct incarnations and observes replacements', async t => {
  const objects = new Map<string, K8sResource>([['pvc', resource('pvc')], ['pod', resource('pod')]])
  const reads: string[] = []
  const unexpected = () => { assert.fail('storage observation reached a mutable or connection API') }
  t.mock.method(NexusZoneApiClient, 'withMtls', unexpected)
  const resources: UserPodResources = {
    read: async (kind, name) => { reads.push(`${kind}:${name}`); return structuredClone(objects.get(kind)) },
    write: unexpected, remove: unexpected, refreshProjection: unexpected, observe: unexpected, list: unexpected,
  }
  const service = new UserPodService(options, resources, unexpected)
  t.after(() => service.close())
  const first = await service.inspectStorage('alice')
  assert.equal(first.pvc?.uid, 'pvc-original')
  assert.equal(first.pod?.uid, 'pod-original')
  assert.equal(first.pvc?.resourceVersion, '12')
  assert.equal(first.pvc?.deletionTimestamp, null)
  assert.deepEqual(reads.sort(), [`pod:${userPodName('alice')}`, `pvc:${userPodName('alice')}`])

  objects.get('pod')!.metadata.uid = 'pod-replacement'
  objects.get('pod')!.metadata.resourceVersion = '13'
  const restarted = await service.inspectStorage('alice')
  assert.deepEqual(restarted.pvc, first.pvc)
  assert.equal(restarted.pod?.uid, 'pod-replacement')
  objects.get('pvc')!.metadata.uid = 'same-name-new-pvc'
  objects.get('pvc')!.metadata.resourceVersion = '14'
  objects.get('pvc')!.metadata.deletionTimestamp = '2026-11-10T00:00:00Z'
  const replaced = await service.inspectStorage('alice')
  assert.equal(replaced.pvc?.uid, 'same-name-new-pvc')
  assert.equal(replaced.pvc?.deletionTimestamp, '2026-11-10T00:00:00Z')
  assert.deepEqual(replaced.pod, restarted.pod)
  assert.equal(first.pvc?.uid, 'pvc-original', 'previous observations remain immutable snapshots')

  objects.delete('pvc')
  assert.equal((await service.inspectStorage('alice')).pvc, null)
  objects.clear()
  assert.deepEqual(await service.inspectStorage('alice'), {
    ownerId: 'alice', allocationId: 'primary', namespace: options.namespace, pvc: null, pod: null,
  })
  await service.close()
  await assert.rejects(service.inspectStorage('alice'), /closed/)
})

void test('storage inspection follows the selected allocation and preserves Kubernetes read errors', async t => {
  const reads: string[] = []
  let failure: Error | undefined
  const resources: UserPodResources = {
    read: async (kind, name) => {
      reads.push(name)
      if (failure) throw failure
      return resource(kind as 'pvc' | 'pod', 'secondary')
    },
    write: async () => { assert.fail('read-only inspection wrote a resource') },
  }
  const service = new UserPodService(options, resources, async () => { assert.fail('unexpected readiness check') })
  t.after(() => service.close())
  const selected = service.forAllocation('secondary')
  const result = await selected.inspectStorage('alice')
  assert.equal(result.allocationId, 'secondary')
  assert(reads.every(name => name === userPodName('alice', 'secondary')))
  failure = new Error('Kubernetes API Forbidden')
  await assert.rejects(selected.inspectStorage('alice'), error => error === failure)
})

for (const kind of ['pvc', 'pod'] as const) {
  for (const invalid of ['owner', 'allocation', 'name', 'namespace', 'uid', 'version'] as const) {
    void test(`storage inspection rejects ${kind} with invalid ${invalid}`, async t => {
      const malformed = resource(kind)
      const metadata = malformed.metadata
      if (invalid === 'owner') metadata.annotations!['moss.sudo.dev/runtime-owner'] = 'bob'
      if (invalid === 'allocation') metadata.annotations!['moss.sudo.dev/runtime-allocation'] = 'other'
      if (invalid === 'name') metadata.name = 'unrelated'
      if (invalid === 'namespace') metadata.namespace = 'another-namespace'
      if (invalid === 'uid') delete metadata.uid
      if (invalid === 'version') delete metadata.resourceVersion
      const service = new UserPodService(options, {
        read: async requested => requested === kind ? malformed : resource(requested as 'pvc' | 'pod'),
        write: async () => { assert.fail('invalid observations must not mutate resources') },
      }, async () => { assert.fail('unexpected readiness check') })
      t.after(() => service.close())
      await assert.rejects(service.inspectStorage('alice'))
    })
  }
}

for (const volume of ['missing-spec', 'wrong-claim', 'readonly', 'extra-claim'] as const) {
  void test(`storage inspection rejects Pod data volume: ${volume}`, async t => {
    const pod = resource('pod')
    if (volume === 'missing-spec') delete pod.spec
    else {
      const volumes = pod.spec!.volumes as Array<{ name: string; persistentVolumeClaim: { claimName: string; readOnly?: boolean } }>
      if (volume === 'wrong-claim') volumes[0]!.persistentVolumeClaim.claimName = 'someone-else'
      if (volume === 'readonly') volumes[0]!.persistentVolumeClaim.readOnly = true
      if (volume === 'extra-claim') volumes.push({ name: 'other', persistentVolumeClaim: { claimName: 'other' } })
    }
    const service = new UserPodService(options, {
      read: async kind => kind === 'pod' ? pod : resource('pvc'),
      write: async () => { assert.fail('invalid data volume must not mutate resources') },
    }, async () => { assert.fail('unexpected readiness check') })
    t.after(() => service.close())
    await assert.rejects(service.inspectStorage('alice'))
  })
}
