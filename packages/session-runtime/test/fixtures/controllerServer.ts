/** Ephemeral TLS/Call fixture for cross-language acceptance; no native runtime. */
import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import grpc from '@grpc/grpc-js'
import { userRuntimeServerName } from '@nexus-ai-fs/vfs-client'
import { serve, testAuthority } from '../helpers/tls.js'

const lines = createInterface({ input: process.stdin })
const iterator = lines[Symbol.asyncIterator]()
const first = await iterator.next()
if (first.done) throw new Error('Fixture configuration required')
const { directory } = JSON.parse(first.value) as { directory: string }
assert.ok(isAbsolute(directory))
const closers: (() => void)[] = []
const scope = { after: (close: () => void) => { closers.push(close) } }
const { ca, issue } = testAuthority()
const operator = issue('operator', [{ type: 6, value: 'nexus://agent/moss' }])
const issuer = issue('issuer', [{ type: 2, value: 'issuer.test' }])
const runtime = issue('runtime', [{ type: 2, value: userRuntimeServerName('alice') }])
const subjectId = `session-${randomUUID()}`
const delegated = issue(subjectId, [{ type: 6, value: `nexus://agent/${subjectId}` },
  { type: 6, value: 'nexus://owner/alice' }])
let minted = 0
let calls = 0
let simulatedEffects = 0
let cancelCalls = 0
let changed = false
const issuerEndpoint = await serve(scope, ca, issuer, 'nexus.raft.ZoneApiService', {
  MintSessionAgent(call: grpc.ServerUnaryCall<{ owner_id: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
    assert.equal(call.getAuthContext().sslPeerCertificate?.subject.CN, 'operator')
    assert.equal(call.request.owner_id, 'alice')
    minted++
    callback(null, { success: true, subject_id: subjectId, ca_pem: ca,
      agent_cert_pem: delegated.cert, agent_key_pem: delegated.key })
  },
})
const endpoint = { protocol: 'acp-mailbox/1', channel_id: 'original-channel', agent: 'moss-alice',
  controller: subjectId, transcript: `/conversations/${'a'.repeat(32)}/transcript` }
const snapshot = { session_id: '19.3', owner_id: 'alice', agent_id: 'moss-alice',
  durable_session_id: 'history-original', workspace_path: '/proc/19.3/workspace/',
  state: 'ready', session_endpoint: endpoint, fixture_text: '客户 📝' }
const runtimeEndpoint = await serve(scope, ca, runtime, 'nexus.grpc.vfs.NexusVFSService', {
  Call(call: grpc.ServerUnaryCall<{ method: string; payload: Buffer; auth_token: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
    calls++
    assert.equal(call.request.auth_token, '')
    assert.deepEqual(call.getAuthContext().sslPeerCertificate?.raw, new X509Certificate(delegated.cert).raw)
    const params = JSON.parse(call.request.payload.toString('utf8')) as { owner_id?: string }
    if (params.owner_id && params.owner_id !== 'alice') {
      callback(null, { is_error: true, payload: Buffer.from(JSON.stringify({ code: -32603, message: 'fixture owner mismatch' })) })
      return
    }
    if (call.request.method === 'managed_agent.start_session_v1') {
      simulatedEffects++
      callback({ code: grpc.status.UNAVAILABLE, details: 'fixture effect recorded; reply lost' }, null)
      return
    }
    if (call.request.method.startsWith('managed_agent.cancel')) cancelCalls++
    callback(null, { payload: Buffer.from(JSON.stringify({ ...snapshot, session_endpoint:
      changed ? { ...endpoint, channel_id: 'changed-channel' } : endpoint })) })
  },
})
const paths = { ca: join(directory, 'ca.pem'), cert: join(directory, 'operator.pem'),
  key: join(directory, 'operator-key.pem') }
await Promise.all([[paths.ca, ca], [paths.cert, operator.cert], [paths.key, operator.key]].map(
  async ([path, data]) => writeFile(path as string, data as Buffer, { mode: 0o600 })))
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
emit({ type: 'fixture-ready', issuerEndpoint, runtimeEndpoint, ...paths, snapshot })
try {
  for await (const line of iterator) {
    const request = JSON.parse(line) as { operation: string; changed?: boolean }
    if (request.operation === 'channel') changed = request.changed === true
    emit({ type: 'fixture-state', minted, calls, simulatedEffects, cancelCalls, changed })
  }
} finally {
  for (const close of closers.reverse()) close()
  lines.close()
}
