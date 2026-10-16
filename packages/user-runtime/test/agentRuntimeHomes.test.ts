import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { NexusZoneApiClient } from '@nexus-ai-fs/vfs-client'
import { AgentRuntimeHomes, runtimeAllocationId, type AgentRuntimeHome, type AgentRuntimeHomeStore } from '../src/agentRuntimeHomes.js'
import { UserPodService, userPodName } from '../src/userPodService.js'
import { runtimeCredential } from './runtimeCredential.js'
import { userPodPlatform } from './userPodPlatform.js'

/** A real durable store, independent of the process-local controller and Kubernetes fixture. */
function sqliteHomes(path: string) {
  const database = new DatabaseSync(path)
  database.exec('CREATE TABLE IF NOT EXISTS homes (ownerId TEXT NOT NULL, agentId TEXT NOT NULL, allocationId TEXT NOT NULL, PRIMARY KEY (ownerId, agentId))')
  const find = (ownerId: string, agentId: string) => {
    const row = database.prepare('SELECT * FROM homes WHERE ownerId = ? AND agentId = ?').get(ownerId, agentId)
    return row ? { ...row } as unknown as AgentRuntimeHome : undefined
  }
  const list = (ownerId: string) => database.prepare('SELECT * FROM homes WHERE ownerId = ?').all(ownerId)
    .map(row => ({ ...row }) as unknown as AgentRuntimeHome)
  const store: AgentRuntimeHomeStore = {
    async find(ownerId, agentId) { return find(ownerId, agentId) },
    async list(ownerId) { return list(ownerId) },
    async claim(ownerId, agentId, chooseAllocation) {
      database.exec('BEGIN IMMEDIATE')
      try {
        let home = find(ownerId, agentId)
        if (!home) {
          home = { ownerId, agentId, allocationId: chooseAllocation(list(ownerId)) }
          database.prepare('INSERT INTO homes VALUES (?, ?, ?)').run(ownerId, agentId, home.allocationId)
        }
        database.exec('COMMIT')
        return home
      } catch (error) { database.exec('ROLLBACK'); throw error }
    },
  }
  return { store, close: () => database.close() }
}

void test('Agent homes survive controller restart and capacity changes, and route sibling Pods to independent volumes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-runtime-homes-'))
  const stores = new Set<ReturnType<typeof sqliteHomes>>()
  t.after(async () => {
    for (const store of stores) store.close()
    await rm(directory, { recursive: true, force: true })
  })
  const path = join(directory, 'homes.sqlite')
  const first = sqliteHomes(path)
  stores.add(first)
  const homes = new AgentRuntimeHomes(first.store, 2)
  const sameAgent = await Promise.all(Array.from({ length: 8 }, () => homes.resolve('alice', 'agent-a')))
  assert(sameAgent.every(home => home.allocationId === 'primary'))
  assert.equal((await first.store.list('alice')).length, 1, 'new Sessions retain the Agent home')
  const secondAgent = await homes.resolve('alice', 'agent-b')
  const thirdAgent = await homes.resolve('alice', 'agent-c')
  assert.equal(secondAgent.allocationId, 'primary')
  assert.notEqual(thirdAgent.allocationId, 'primary')
  assert.equal((await homes.resolve('bob', 'agent-c')).allocationId, 'primary')
  first.close()
  stores.delete(first)

  const restartedStore = sqliteHomes(path)
  stores.add(restartedStore)
  const restarted = new AgentRuntimeHomes(restartedStore.store, 1)
  assert.deepEqual(await restarted.resolve('alice', 'agent-a'), sameAgent[0])
  assert.deepEqual(await restarted.resolve('alice', 'agent-c', 'primary'), thirdAgent,
    'even an explicit adoption hint cannot move an already assigned Agent')
  assert.equal(await restarted.find('bob', 'agent-a'), undefined)
  assert.deepEqual(await restarted.allocations('alice'), ['primary', thirdAgent.allocationId])

  const kube = userPodPlatform(true)
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({
    mintUserRuntime: async (owner: string) => runtimeCredential(owner), close() {},
  }))
  const runtime = new UserPodService({ image: 'runtime:verified', nodeHost: 'compute.internal',
    namespace: 'private-runtimes', storageClass: 'retained-local',
    issuer: { endpoint: 'https://issuer', tls: { ca: '/ca', cert: '/cert', key: '/key' } },
  }, kube.resources, async () => {})
  t.after(() => runtime.close())
  const [primary, secondary] = await Promise.all([
    runtime.forAllocation(sameAgent[0]!.allocationId).resolve('alice'),
    runtime.forAllocation(thirdAgent.allocationId).resolve('alice'),
  ])
  assert.notEqual(primary.runtimeEndpoint, secondary.runtimeEndpoint)
  const primaryName = userPodName('alice', sameAgent[0]!.allocationId)
  const secondaryName = userPodName('alice', thirdAgent.allocationId)
  assert.notEqual(kube.objects.get(`pvc:${primaryName}`)!.metadata.uid, kube.objects.get(`pvc:${secondaryName}`)!.metadata.uid)
  for (const name of [primaryName, secondaryName]) {
    const volumes = kube.objects.get(`pod:${name}`)!.spec!.volumes as Array<{ name: string; persistentVolumeClaim?: { claimName: string } }>
    assert.equal(volumes.find(volume => volume.name === 'data')!.persistentVolumeClaim!.claimName, name)
  }
  assert.notEqual(userPodName('bob', 'primary'), primaryName)
  assert.deepEqual(await restarted.resolve('alice', 'agent-c'), thirdAgent)
})

void test('existing storage adoption is durable and malformed or foreign store results are refused', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-runtime-adoption-'))
  const fixture = sqliteHomes(join(directory, 'homes.sqlite'))
  t.after(async () => { fixture.close(); await rm(directory, { recursive: true, force: true }) })
  const homes = new AgentRuntimeHomes(fixture.store, 1)
  await homes.resolve('alice', 'agent-a')
  const adopted = await homes.resolve('alice', 'previous-agent', 'primary')
  assert.equal(adopted.allocationId, 'primary', 'capacity must not move pre-existing native state')
  assert.notEqual((await homes.resolve('alice', 'new-agent')).allocationId, 'primary')
  await assert.rejects(homes.resolve('alice', 'invalid', '../sibling'), /Invalid runtime allocation/)
  assert.equal(await homes.find('alice', 'invalid'), undefined)
  for (const capacity of [0, -1, 1.5, Infinity]) assert.throws(() => new AgentRuntimeHomes(fixture.store, capacity))
  for (const invalid of [null, undefined, 1, {}]) {
    assert.throws(() => runtimeAllocationId(invalid as string), /Invalid runtime allocation/)
    await assert.rejects(homes.resolve(invalid as string, 'agent'), /requires owner/)
  }
  const foreign = new AgentRuntimeHomes({
    ...fixture.store,
    claim: async () => ({ ownerId: 'bob', agentId: 'agent-a', allocationId: 'primary' }),
    find: async () => ({ ownerId: 'alice', agentId: 'other-agent', allocationId: 'primary' }),
  }, 2)
  await assert.rejects(foreign.resolve('alice', 'agent-a'), /identity mismatch/)
  await assert.rejects(foreign.find('alice', 'agent-a'), /identity mismatch/)
})
