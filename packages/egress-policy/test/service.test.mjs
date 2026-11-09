import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  EgressPolicyRepository, EgressPolicyService, EgressPolicyConflict,
  createEgressPolicy, assertEgressRuntimeAdmission, EgressPolicyNotAppliedError,
} from '../src/index.js'

function storage(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const driver = {
    get: async (sql, params = []) => db.prepare(sql).get(...params),
    run: async (sql, params = []) => Number(db.prepare(sql).run(...params).changes),
    exec: async sql => db.exec(sql),
    transaction: async callback => {
      db.exec('BEGIN IMMEDIATE')
      try { const result = await callback(); db.exec('COMMIT'); return result }
      catch (error) { db.exec('ROLLBACK'); throw error }
    },
  }
  return new EgressPolicyRepository(driver, createEgressPolicy({ modelMounts: ['/cloud-model'] }))
}

test('save persists desired policy without falsely reporting native enforcement', async t => {
  const repository = storage(t)
  const deliveries = []
  const service = new EgressPolicyService(repository, {
    targets: async () => [{ ownerId: 'owner-a', organizationId: 'org-a' }],
    observe: async (_target, desired) => {
      if (desired) deliveries.push(desired)
      return [{ ownerId: 'owner-a', allocationId: 'primary', isPresent: true,
        status: { ...createEgressPolicy({ modelMounts: ['/cloud-model'] }), error: null } }]
    },
  })
  const initial = await service.view('org-a')
  assert.equal(initial.isInherited, true)
  assert.equal(deliveries.length, 0, 'read must not mutate runtime configuration')
  const result = await service.save('org-a', { ...initial.policy, enabled: true }, 0, 'admin-a')
  assert.equal(result.policy.enabled, true)
  assert.equal(result.isInherited, false)
  assert.equal(result.runtimes[0].state, 'pending')
  assert.equal(deliveries.length, 1)
  await assert.rejects(service.save('org-a', initial.policy, 0, 'admin-a'), EgressPolicyConflict)
  assert.equal(deliveries.length, 1, 'stale save must not distribute another policy')
  const inherited = await service.inherit('org-a', result.policy.revision)
  assert.equal(inherited.isInherited, true)
  assert.equal(inherited.policy.enabled, false)
})

test('platform propagation retains organization overrides and exposes runtime failures', async t => {
  const repository = storage(t)
  const delivered = new Map()
  const service = new EgressPolicyService(repository, {
    targets: async scope => ['org-a', 'org-b'].filter(org => !scope || scope === org)
      .map(organizationId => ({ ownerId: organizationId, organizationId })),
    observe: async (target, policy) => {
      if (policy) delivered.set(target.organizationId, policy.enabled)
      return [{ ownerId: target.ownerId, allocationId: 'primary', isPresent: true,
        error: 'Runtime upgrade required' }]
    },
  })
  const initial = await service.policy('org-a')
  await service.save('org-a', initial, initial.revision, 'admin-a')
  const platform = await service.policy()
  const view = await service.save(undefined, { ...platform, enabled: true }, platform.revision, 'root')
  assert.equal(delivered.get('org-a'), false)
  assert.equal(delivered.get('org-b'), true)
  assert(view.runtimes.every(row => row.state === 'error'))
  assert.equal(view.scopeType, 'platform')
})

test('scoped adapters cannot select another organization and absent runtimes stay pending', async t => {
  const repository = storage(t)
  let observed = 0
  const service = new EgressPolicyService(repository, {
    targets: async () => [{ ownerId: 'b', organizationId: 'org-b' }],
    observe: async () => { observed++; return [] },
  })
  await assert.rejects(service.view('org-a'), /outside the selected organization/)
  assert.equal(observed, 0)
  const absent = new EgressPolicyService(repository, {
    targets: async () => [{ ownerId: 'a', organizationId: 'org-a' }],
    observe: async () => [{ ownerId: 'a', allocationId: 'removed', isPresent: false,
      status: { ...await repository.get('org-a'), error: null } }],
  })
  assert.equal((await absent.view('org-a')).runtimes[0].state, 'pending')
})

test('recreated controller reads the saved policy and accepts matching native receipts', async t => {
  const repository = storage(t)
  const operations = {
    targets: async () => [{ ownerId: 'a', organizationId: 'org-a' }],
    observe: async (_target, policy) => [{ ownerId: 'a', allocationId: 'primary', isPresent: true,
      status: { ...policy, error: null } }],
  }
  const first = new EgressPolicyService(repository, operations)
  const initial = await first.policy('org-a')
  const saved = await first.save('org-a', { ...initial, enabled: true }, 0, 'admin-a')
  const restarted = new EgressPolicyService(repository, operations)
  assert.deepEqual(await restarted.policy('org-a'), saved.policy)
  assert.equal(saved.runtimes[0].state, 'applied')
  assert.doesNotThrow(() => assertEgressRuntimeAdmission(saved.policy, 'cohost', saved.runtimes[0].status))
})

test('native admission denies bypasses and missing, stale, erroneous or malformed receipts', () => {
  const policy = createEgressPolicy({ enabled: true, revision: 9, modelMounts: ['/cloud-model'] })
  const actual = { version: 1, revision: 9, enabled: true, mode: 'redact', modelMounts: ['/cloud-model'], a2aMounts: [], error: null }
  for (const runtime of ['legacy', 'harness', 'cluster', '', 'cohost ']) {
    assert.throws(() => assertEgressRuntimeAdmission(policy, runtime, actual), EgressPolicyNotAppliedError)
  }
  for (const receipt of [undefined, null, {}, { ...actual, revision: 8 }, { ...actual, enabled: false },
    { ...actual, mode: 'observe' }, { ...actual, modelMounts: ['/model'] }, { ...actual, a2aMounts: ['/mailbox'] },
    { ...actual, error: 'sensitive detector output' }, { ...actual, version: 2 }, { ...actual, error: undefined }]) {
    assert.throws(() => assertEgressRuntimeAdmission(policy, 'cohost', receipt), error => {
      assert(error instanceof EgressPolicyNotAppliedError)
      assert.equal(error.code, 'EGRESS_POLICY_NOT_APPLIED')
      assert.doesNotMatch(error.message, /sensitive|detector/)
      return true
    })
  }
  assert.doesNotThrow(() => assertEgressRuntimeAdmission(policy, 'cohost', actual))
  assert.doesNotThrow(() => assertEgressRuntimeAdmission({ ...policy, enabled: false }, 'harness'))
  assert.throws(() => assertEgressRuntimeAdmission({ ...policy, enabled: 'false' }, 'harness'), /Invalid/)
})

test('initialization retries after failure and simultaneous reads share one initialization', async () => {
  let calls = 0
  let release
  const barrier = new Promise(resolve => { release = resolve })
  const repository = {
    initialize: async () => { if (++calls === 1) throw new Error('database unavailable'); await barrier },
    get: async () => createEgressPolicy(),
  }
  const service = new EgressPolicyService(repository, {})
  await assert.rejects(service.policy(), /database unavailable/)
  const reads = [service.policy(), service.policy()]
  assert.equal(calls, 2)
  release()
  await Promise.all(reads)
  assert.equal(calls, 2)
})

test('runtime observations are bounded to four in flight without timing assumptions', async t => {
  const repository = storage(t)
  const pending = []
  let active = 0
  let peak = 0
  let started
  const batch = new Promise(resolve => { started = resolve })
  const service = new EgressPolicyService(repository, {
    targets: async () => Array.from({ length: 9 }, (_, index) => ({ ownerId: String(index), organizationId: 'org-a' })),
    observe: async () => {
      active++
      peak = Math.max(peak, active)
      if (pending.length < 4) {
        await new Promise(resolve => { pending.push(resolve); if (pending.length === 4) started() })
      }
      active--
      return []
    },
  })
  const view = service.view('org-a')
  await batch
  assert.equal(active, 4)
  for (const release of pending) release()
  await view
  assert.equal(peak, 4)
})
