import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { EgressPolicyRepository, EgressPolicyConflict, createEgressPolicy } from '../src/index.js'

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
  return new EgressPolicyRepository(driver, createEgressPolicy({ modelMounts: ['/model'] }))
}

test('platform defaults, organization overrides and inheritance survive repository recreation', async t => {
  const repository = storage(t)
  await repository.initialize()
  assert.equal((await repository.get('org-a')).enabled, false)
  const platform = await repository.put(undefined, createEgressPolicy({ enabled: true, modelMounts: ['/model'] }), 0, 'root')
  assert.equal((await repository.get('org-a')).enabled, true)
  const override = await repository.put('org-a', { ...platform, enabled: false }, platform.revision, 'admin-a')
  assert.equal((await repository.get('org-a')).enabled, false)
  assert.equal((await repository.get('org-b')).enabled, true)
  assert.equal((await repository.get('org-b')).revision, platform.revision)
  const inherited = await repository.inherit('org-a', override.revision)
  assert.equal(inherited.enabled, true)
  assert.ok(inherited.revision > override.revision)
  assert.equal(await repository.hasOverride('org-a'), false)
  await repository.initialize()
  assert.deepEqual(await repository.get('org-a'), inherited)
})
test('stale writes cannot overwrite a newer policy; independent organizations retain their own revisions', async t => {
  const repository = storage(t)
  await repository.initialize()
  const first = await repository.put('a', createEgressPolicy(), 0, 'admin-a')
  await assert.rejects(repository.put('a', createEgressPolicy(), 0, 'admin-a'), EgressPolicyConflict)
  await repository.put('b', createEgressPolicy(), 0, 'admin-b')
  assert.equal((await repository.get('a')).revision, first.revision)
  await assert.rejects(repository.inherit('a', 0), EgressPolicyConflict)
  assert.equal(await repository.hasOverride('a'), true)
})
