import assert from 'node:assert/strict'
import test from 'node:test'
import { createEgressPolicy, parseEgressPolicy, policyApplicationStatus, readEgressPolicyStatus } from '../src/index.js'

test('cloud is disabled by default; an enabled policy needs explicit outbound mounts', () => {
  assert.equal(createEgressPolicy().enabled, false)
  assert.throws(() => createEgressPolicy({ enabled: true }))
  assert.equal(createEgressPolicy({ enabled: true, modelMounts: ['/cloud-model'] }).mode, 'redact')
})
test('reject ambiguous paths, unknown fields, unsafe revisions and external analyzers', () => {
  for (const path of ['/', '/cloud/../model', '/cloud/', '/__sys__/model', '/cloud//model', 'cloud']) {
    assert.throws(() => createEgressPolicy({ modelMounts: [path] }))
  }
  for (const change of [{ revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { enabled: 'false' }, { surprise: true }]) {
    assert.throws(() => createEgressPolicy(change))
  }
  assert.throws(() => createEgressPolicy({ analyzer: { url: 'http://example.com:80', language: 'zh', scoreThreshold: 0.5, entities: [], timeoutMs: 1000 } }))
})
test('business values are cloned and validated; public exceptions do not change explicit protection', () => {
  const policy = createEgressPolicy({ analyzer: { url: 'http://127.0.0.1:59080', language: 'zh', scoreThreshold: 0.5, entities: [], timeoutMs: 1000 } })
  policy.businessPolicy.public_organizations.push('公开公司')
  policy.businessPolicy.protected_terms.push('客户甲')
  const copy = parseEgressPolicy(policy)
  copy.businessPolicy.protected_terms.push('客户乙')
  assert.deepEqual(policy.businessPolicy.protected_terms, ['客户甲'])
  assert.deepEqual(createEgressPolicy().businessPolicy.protected_terms, [])
  assert.throws(() => createEgressPolicy({ businessPolicy: { ...policy.businessPolicy, protected_terms: ['客户甲', '客户甲'] } }))
})
test('saving or delivering a policy cannot report an old runtime as applied', () => {
  const policy = createEgressPolicy({ revision: 2 })
  assert.equal(policyApplicationStatus(policy).state, 'pending')
  assert.equal(policyApplicationStatus(policy, { ...policy, revision: 1, error: null }).state, 'pending')
  assert.equal(policyApplicationStatus(policy, { ...policy, error: 'configuration unavailable' }).state, 'error')
  assert.equal(policyApplicationStatus(policy, { ...policy, error: null }).state, 'applied')
})
test('status uses the existing authenticated RPC and rejects malformed replies', async () => {
  const client = { call: async (...args) => {
    assert.deepEqual(args, ['egress_gate.get_policy_status_v1', '{}', 'test-token'])
    return JSON.stringify({ result: { ...createEgressPolicy(), error: null } })
  } }
  assert.equal((await readEgressPolicyStatus(client, 'test-token')).enabled, false)
  await assert.rejects(readEgressPolicyStatus({ call: async () => '{"result":{}}' }, ''))
})
