/** Real Kubernetes regression for Secret history larger than apply annotations. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { buildKubectlBaseArgs, deleteK8sResource, kubectlApply, readK8sResource } from '../../src/k8sResources.js'

if (process.env.MOSS_RUNTIME_LIVE !== '1') throw new Error('Explicit live Kubernetes acceptance is required')
const namespace = process.env.MOSS_LIVE_NAMESPACE ?? 'moss-sessions'
const base = buildKubectlBaseArgs(namespace, process.env.MOSS_LIVE_KUBECONFIG)
const name = `pc3-secret-size-${randomUUID()}`
const owner = name
const blob = Buffer.alloc(400 * 1024, 'fixture-history').toString('base64')
const annotations = { 'moss.sudo.dev/runtime-owner': owner, 'moss.sudo.dev/test-fixture': 'secret-renewal-size' }
const manifest = { apiVersion: 'v1', kind: 'Secret', type: 'Opaque', metadata: { name, namespace, annotations }, data: { history: blob } }
const exec = promisify(execFile)
let uid: string | undefined
let passed = false
try {
  await kubectlApply(base, manifest, 'create')
  const observed = (await readK8sResource(base, 'secret', name))!
  uid = observed.metadata.uid
  assert(uid && observed.metadata.resourceVersion)
  const legacy = { ...manifest, metadata: { ...observed.metadata, namespace }, data: observed.data,
    stringData: { renewal: 'fixture-only' } }
  let rejected = false
  const child = exec('kubectl', [...base, 'apply', '--dry-run=server', '-f', '-'], { maxBuffer: 2 * 1024 * 1024, timeout: 30_000 })
  child.child.stdin!.end(JSON.stringify(legacy))
  try { await child } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '')
    rejected = /metadata\.annotations.*Too long/s.test(stderr)
  }
  assert(rejected, 'Reproduce the annotation limit without changing the observed Secret')
  const afterDryRun = (await readK8sResource(base, 'secret', name))!
  assert.equal(afterDryRun.metadata.resourceVersion, observed.metadata.resourceVersion)
  for (const metadata of [
    { uid: randomUUID(), resourceVersion: observed.metadata.resourceVersion, annotations },
    { uid, resourceVersion: '0', annotations },
    { uid, resourceVersion: observed.metadata.resourceVersion, annotations: { ...annotations, 'moss.sudo.dev/runtime-owner': 'another-owner' } },
  ]) {
    await assert.rejects(kubectlApply(base, { ...manifest, metadata: { ...manifest.metadata, ...metadata } }, 'patch'))
    const unchanged = (await readK8sResource(base, 'secret', name))!
    assert.equal(unchanged.metadata.resourceVersion, observed.metadata.resourceVersion)
    assert.equal(unchanged.data!.history, blob)
  }
  await kubectlApply(base, { ...manifest, metadata: { ...manifest.metadata, uid, resourceVersion: observed.metadata.resourceVersion },
    data: { ...observed.data, renewal: Buffer.from('fixture-only').toString('base64') } }, 'patch')
  const renewed = (await readK8sResource(base, 'secret', name))!
  assert.equal(renewed.metadata.uid, uid)
  assert.equal(renewed.data!.history, blob)
  assert.equal(Buffer.from(renewed.data!.renewal!, 'base64').toString(), 'fixture-only')
  passed = true
  const evidence = { passed, legacyApplyDryRunRejected: true, resourceVersionUnchangedByDryRun: true, patchRetainedUid: true,
    uidVersionAndOwnerFencesVerified: true, fixtureName: name,
    historyBytes: 400 * 1024, historySha256: createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex') }
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(evidence, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(evidence))
} finally {
  if (uid) await deleteK8sResource(base, namespace, 'secrets', name, uid)
}
if (!passed) process.exitCode = 1
