import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import https from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import { createUserRuntimeCredentialBundle, userRuntimeServerName } from '@nexus-ai-fs/vfs-client'
import { UserPodService, userPodName, type UserPodResources } from '../src/userPodService.js'
import type { K8sResource } from '../src/k8sResources.js'
import { runtimeCredential } from './runtimeCredential.js'

const owner = 'expired-runtime-owner'
const name = userPodName(owner)
const annotations = { 'moss.sudo.dev/runtime-owner': owner }
const protoRoot = join(dirname(fileURLToPath(import.meta.resolve('@nexus-ai-fs/vfs-client'))), '../proto')
const definitions = protoLoader.loadSync(join(protoRoot, 'nexus/raft/transport.proto'),
  { includeDirs: [protoRoot], keepCase: true, longs: String, defaults: true })

void test('a restarted controller renews an expired runtime over real mTLS before drain and preserves a busy owner', { timeout: 30_000 }, async t => {
  const expired = runtimeCredential(owner, true)
  const controller = runtimeCredential('controller')
  const authority = runtimeCredential('issuer')
  const configuration = { 'sudocode.json': '{"model":"owner-model"}',
    'backend-config.json': '{"mounts":[{"owner":"expired-runtime-owner"}]}' }
  const runtime = https.createServer({ ca: expired.caPem, cert: expired.certPem, key: expired.keyPem,
    requestCert: true, rejectUnauthorized: true }, (request, response) => {
    assert.equal(request.url, '/authenticated-drain')
    response.end('same owned runtime')
  })
  t.after(() => new Promise<void>(resolve => { runtime.closeAllConnections(); runtime.close(() => resolve()) }))
  runtime.listen(0, '127.0.0.1')
  await once(runtime, 'listening')
  const address = runtime.address()
  assert(address && typeof address !== 'string')
  const connect = () => new Promise<string>((resolve, reject) => {
    const request = https.get({ host: '127.0.0.1', port: address.port, path: '/authenticated-drain',
      ca: controller.caPem, cert: controller.certPem, key: controller.keyPem,
      servername: userRuntimeServerName(owner), agent: false }, response => {
      let body = ''
      response.on('data', data => { body += data.toString() })
      response.on('end', () => resolve(body))
    })
    request.on('error', reject)
  })
  await assert.rejects(connect(), /expired/)
  const issuer = new grpc.Server()
  t.after(() => issuer.forceShutdown())
  let issued = 0
  issuer.addService(definitions['nexus.raft.ZoneApiService'] as grpc.ServiceDefinition, {
    MintUserRuntime(call: grpc.ServerUnaryCall<{ owner_id: string; validity_secs: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      assert.equal(call.getAuthContext().sslPeerCertificate?.subject.CN, controller.subjectId)
      assert.equal(call.request.owner_id, owner)
      assert.equal(call.request.validity_secs, '300')
      const credential = runtimeCredential(owner)
      issued++
      callback(null, { success: true, subject_id: credential.subjectId, ca_pem: credential.caPem,
        agent_cert_pem: credential.certPem, agent_key_pem: credential.keyPem })
    },
  })
  const issuerPort = await new Promise<number>((resolve, reject) => issuer.bindAsync('127.0.0.1:0',
    grpc.ServerCredentials.createSsl(authority.caPem, [{ private_key: authority.keyPem, cert_chain: authority.certPem }], true),
    (error, port) => error ? reject(error) : resolve(port)))
  const bundle = createUserRuntimeCredentialBundle(owner, runtimeCredential(owner))
  const pod: K8sResource = { metadata: { name, uid: randomUUID(), annotations },
    spec: { containers: [{ name: 'runtime', image: 'runtime:old' }],
      volumes: [{ name: 'data', persistentVolumeClaim: { claimName: name } }] } }
  const volume: K8sResource = { metadata: { name, uid: randomUUID(), annotations } }
  const objects = new Map<string, K8sResource>([
    ['pod', pod], ['pvc', volume],
    ['secret', { metadata: { name, uid: randomUUID(), resourceVersion: '1', annotations },
      data: Object.fromEntries(Object.entries(configuration).map(([key, value]) => [key, Buffer.from(value).toString('base64')])) }],
    ['service', { metadata: { name, annotations }, spec: { type: 'NodePort', selector: { app: 'moss-user-runtime', runtime: name },
      ports: [{ name: 'nexus', port: 8443, targetPort: 8443, nodePort: address.port }] } }],
  ])
  const mutations: string[] = []
  const resources: UserPodResources = {
    async read(kind, resourceName) { return objects.get(resourceName.endsWith('-upgrade') ? 'lock' : kind) },
    async write(manifest, verb) {
      const metadata = manifest.metadata as K8sResource['metadata']
      if (metadata.name.endsWith('-upgrade')) {
        assert.equal(verb, 'create')
        objects.set('lock', { metadata: { ...metadata, uid: randomUUID() } })
        return
      }
      assert.equal(manifest.kind, 'Secret', 'busy runtime must not receive a new Pod or volume')
      assert.equal(verb, 'patch', 'credential history must not enter the apply annotation')
      const previous = objects.get('secret')!
      assert.equal(metadata.uid, previous.metadata.uid)
      assert.equal(metadata.resourceVersion, previous.metadata.resourceVersion)
      const data = { ...manifest.data as Record<string, string>,
        ...Object.fromEntries(Object.entries((manifest.stringData ?? {}) as Record<string, string>)
          .map(([key, value]) => [key, Buffer.from(value).toString('base64')])) }
      objects.set('secret', { metadata, data })
      const selection = JSON.parse(Buffer.from(data[bundle.manifestName]!, 'base64').toString()) as { cert: string; key: string }
      runtime.setSecureContext({ ca: controller.caPem, cert: Buffer.from(data[selection.cert]!, 'base64'),
        key: Buffer.from(data[selection.key]!, 'base64') })
      mutations.push('renewed')
    },
    async remove(kind, resourceName, uid) {
      assert.equal(kind, 'secrets')
      assert.equal(resourceName, `${name}-upgrade`)
      assert.equal(uid, objects.get('lock')!.metadata.uid)
      objects.delete('lock')
    },
  }
  const service = new UserPodService({ image: 'runtime:next', nodeHost: '127.0.0.1', namespace: 'fixture',
    storageClass: 'retained', issuer: { endpoint: `https://127.0.0.1:${issuerPort}`,
      tls: { ca: controller.caPem, cert: controller.certPem, key: controller.keyPem, serverName: userRuntimeServerName('issuer') } } },
  resources, async () => { assert.equal(await connect(), 'same owned runtime'); mutations.push('ready') })
  t.after(() => service.close())
  await assert.rejects(service.upgrade(owner, async previous => {
    assert.equal(previous?.runtimeEndpoint, `https://127.0.0.1:${address.port}`)
    assert.equal(await connect(), 'same owned runtime')
    mutations.push('drain')
    throw new Error('Agent is busy')
  }), /Agent is busy/)
  assert.equal(issued, 1)
  assert.deepEqual(mutations, ['renewed', 'ready', 'drain'])
  assert.equal(objects.get('pod'), pod)
  assert.equal(objects.get('pvc'), volume)
  assert.equal(objects.has('lock'), false)
  for (const [key, value] of Object.entries(configuration)) {
    assert.equal(Buffer.from(objects.get('secret')!.data![key]!, 'base64').toString(), value)
  }
})
