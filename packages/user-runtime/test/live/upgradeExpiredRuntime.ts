/** Opt-in acceptance against an owned native cohost Pod and the real mTLS issuer. */
import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { NexusVfsClient, NexusZoneApiClient, userRuntimeServerName } from '@nexus-ai-fs/vfs-client'
import { UserPodService, userPodName, type UserPodOptions, type UserRuntimeConnectionConfig } from '../../src/userPodService.js'
import { buildKubectlBaseArgs, readK8sResource, deleteK8sResource } from '../../src/k8sResources.js'

assert.equal(process.env.USER_RUNTIME_LIVE, '1', 'Set USER_RUNTIME_LIVE=1 for real cluster acceptance')
const settings = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as { options: UserPodOptions; output: string; captureRuntimeLogs?: boolean }
const owner = `pc3-runtime-credential-live-${randomUUID()}`
const options = settings.options
const base = buildKubectlBaseArgs(options.namespace, options.kubeconfig)
const name = userPodName(owner)
const issuer = NexusZoneApiClient.withMtls(options.issuer.endpoint, options.issuer.tls)
const evidence: Record<string, unknown> = { owner, resourceName: name, startedAt: new Date().toISOString(), passed: false }
const publish = () => writeFile(settings.output, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const execute = promisify(execFile)
let first: UserPodService | undefined
let upgraded: UserPodService | undefined
const runtimeClient = async (config: UserRuntimeConnectionConfig) => {
  const delegated = await issuer.mintSessionAgent(owner, { validitySecs: 300 })
  return NexusVfsClient.withMtls(config.runtimeEndpoint,
    { ca: delegated.caPem, cert: delegated.certPem, key: delegated.keyPem, serverName: userRuntimeServerName(owner) }, { connectTimeoutMs: 2000 })
}
const ready = async (config: UserRuntimeConnectionConfig, _owner: string, signal: AbortSignal) => {
  const client = await runtimeClient(config)
  const deadline = Date.now() + 90_000
  try {
    while (true) {
      signal.throwIfAborted()
      try { await client.stat('/', ''); return } catch (error) {
        if (Date.now() >= deadline) throw error
        await delay(1000, undefined, { signal })
      }
    }
  } finally { client.close() }
}
try {
  for (const kind of ['pod', 'secret', 'service', 'pvc']) {
    assert.equal(await readK8sResource(base, kind, name), undefined, 'The live fixture must own newly created resources')
  }
  first = new UserPodService(options, undefined, ready)
  const connection = await first.resolve(owner)
  const initialPod = (await readK8sResource(base, 'pod', name))!
  const initialVolume = (await readK8sResource(base, 'pvc', name))!
  const initialSecret = (await readK8sResource(base, 'secret', name))!
  const manifest = JSON.parse(Buffer.from(initialSecret.data!['credential.json']!, 'base64').toString()) as { cert: string }
  const certificate = new X509Certificate(Buffer.from(initialSecret.data![manifest.cert]!, 'base64'))
  const nonce = randomUUID()
  const client = await runtimeClient(connection)
  try {
    await client.write('/credential-live-nonce.txt', Buffer.from(nonce), '')
    assert.equal((await client.read('/credential-live-nonce.txt', '')).toString(), nonce)
  } finally { client.close() }
  await first.close()
  evidence.oldCertificateExpiresAt = certificate.validTo
  evidence.originalPodUid = initialPod.metadata.uid
  evidence.originalVolumeUid = initialVolume.metadata.uid
  await publish()
  await delay(Math.max(0, Date.parse(certificate.validTo) + 3000 - Date.now()))
  const probe = await runtimeClient(connection)
  try { await assert.rejects(probe.stat('/', ''), /DEADLINE_EXCEEDED|UNAVAILABLE|expired/) }
  finally { probe.close() }
  evidence.expiredServerRejectedFreshClient = true
  await publish()
  upgraded = new UserPodService(options, undefined, ready)
  let drained = false
  const replacement = await upgraded.upgrade(owner, async previous => {
    assert(previous)
    assert.equal((await readK8sResource(base, 'pod', name))!.metadata.uid, initialPod.metadata.uid)
    const original = await runtimeClient(previous)
    try { assert.equal((await original.read('/credential-live-nonce.txt', '')).toString(), nonce) }
    finally { original.close() }
    drained = true
  })
  assert(drained)
  assert.notEqual((await readK8sResource(base, 'pod', name))!.metadata.uid, initialPod.metadata.uid)
  assert.equal((await readK8sResource(base, 'pvc', name))!.metadata.uid, initialVolume.metadata.uid)
  const after = await runtimeClient(replacement)
  try { assert.equal((await after.read('/credential-live-nonce.txt', '')).toString(), nonce) }
  finally { after.close() }
  evidence.passed = true
  evidence.retainedVolumeAndBytes = true
  evidence.completedAt = new Date().toISOString()
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  await first?.close()
  await upgraded?.close()
  issuer.close()
  // Preserve the selected server certificate dates and native reload errors
  // before deleting the fixture. Never record Secret data or private keys.
  try {
    const secret = await readK8sResource(base, 'secret', name)
    if (secret?.data?.['credential.json']) {
      const selection = JSON.parse(Buffer.from(secret.data['credential.json'], 'base64').toString()) as { cert: string }
      const certificate = new X509Certificate(Buffer.from(secret.data[selection.cert]!, 'base64'))
      evidence.finalSelectedCertificate = { validFrom: certificate.validFrom, validTo: certificate.validTo,
        fingerprint: certificate.fingerprint256 }
    }
    if (settings.captureRuntimeLogs) {
      const { stdout } = await execute('kubectl', [...base, 'logs', name, '-c', 'runtime', '--tail=30'],
        { timeout: 20_000, maxBuffer: 32_768 })
      evidence.nativeRuntimeLogs = stdout
    }
  } catch (error) { evidence.diagnosticsError = error instanceof Error ? error.message : String(error) }
  // Remove only the fixture Pod and identity. Retain its small volume and
  // placement metadata until the operator reviews the recorded evidence.
  const cleanup: string[] = []
  for (const [kind, plural] of [['pod', 'pods'], ['secret', 'secrets']] as const) {
    const resource = await readK8sResource(base, kind, name)
    if (resource) {
      assert.equal(resource.metadata.annotations?.['moss.sudo.dev/runtime-owner'], owner)
      assert(resource.metadata.uid)
      await deleteK8sResource(base, options.namespace, plural, name, resource.metadata.uid)
      cleanup.push(kind)
    }
  }
  evidence.cleanup = cleanup
  await publish()
}
console.log(JSON.stringify(evidence))
