import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID, X509Certificate } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import grpc from '@grpc/grpc-js'
import { NexusVfsClient, SessionCodec, userRuntimeServerName, type NexusSessionEndpoint } from '@nexus-ai-fs/vfs-client'

import { connectSessionRuntime } from '../src/index.js'
import { serve, testAuthority } from './helpers/tls.js'

void test('real mTLS separates issuer authority from owner runtime and preserves the target on automatic renewal', { timeout: 30_000 }, async t => {
  const { ca, issue } = testAuthority()
  const operator = issue('operator', [{ type: 6, value: 'nexus://agent/moss' }])
  const issuer = issue('issuer', [{ type: 2, value: 'issuer.test' }])
  const runtime = issue('runtime', [{ type: 2, value: userRuntimeServerName('alice') }])
  const subjectId = `session-${randomUUID()}`
  const altNames = [{ type: 6, value: `nexus://agent/${subjectId}` }, { type: 6, value: 'nexus://owner/alice' }]
  let original: TlsMaterial
  let renewed: TlsMaterial | undefined
  let renewalCount = 0
  let markRenewed: () => void = () => {}
  const renewalReceived = new Promise<void>(resolve => { markRenewed = resolve })
  const reply = (material: TlsMaterial) => ({ success: true, subject_id: subjectId,
    ca_pem: ca, agent_cert_pem: material.cert, agent_key_pem: material.key })
  const issuerEndpoint = await serve(t, ca, issuer, 'nexus.raft.ZoneApiService', {
    MintSessionAgent(call: grpc.ServerUnaryCall<{ owner_id: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      assert.equal(call.getAuthContext().sslPeerCertificate?.subject.CN, 'operator')
      assert.equal(call.request.owner_id, 'alice')
      original = issue(subjectId, altNames, 12)
      callback(null, reply(original))
    },
    RenewSessionAgent(call: grpc.ServerUnaryCall<{ proof: Buffer; agent_cert_pem: Buffer }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      assert.equal(call.getAuthContext().sslPeerCertificate?.subject.CN, 'operator')
      assert.ok(call.request.proof.length > 0)
      assert.deepEqual(call.request.agent_cert_pem, original.cert)
      renewed = issue(subjectId, altNames)
      renewalCount++
      callback(null, reply(renewed))
      markRenewed()
    },
  })
  const runtimePeers: Buffer[] = []
  const runtimeEndpoint = await serve(t, ca, runtime, 'nexus.grpc.vfs.NexusVFSService', {
    Read(call: grpc.ServerUnaryCall<{ auth_token: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      const peer = call.getAuthContext().sslPeerCertificate!
      assert.equal(peer.subject.CN, subjectId)
      assert.equal(call.request.auth_token, '')
      runtimePeers.push(peer.raw)
      callback(null, { content: Buffer.from('owned runtime bytes') })
    },
  })
  const connection = await connectSessionRuntime({ endpoint: issuerEndpoint, runtimeEndpoint,
    tls: { ca, ...operator, serverName: 'issuer.test' } }, 'alice')
  t.after(() => connection.client.close())
  assert.equal((await connection.client.read('/agents/a/file', connection.authToken)).toString(), 'owned runtime bytes')
  assert.deepEqual(runtimePeers.at(-1), new X509Certificate(original!.cert).raw)
  await Promise.race([
    renewalReceived,
    setTimeout(15_000, undefined, { ref: false }).then(() => {
      throw new Error(`Issuer did not receive renewal; count=${renewalCount}`)
    }),
  ])
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await connection.client.read('/agents/a/file', connection.authToken)
    if (runtimePeers.at(-1)!.equals(new X509Certificate(renewed!.cert).raw)) break
    await setTimeout(25)
  }
  assert.equal(renewalCount, 1)
  assert.deepEqual(runtimePeers.at(-1), new X509Certificate(renewed!.cert).raw)
})

void test('a runtime with another owner server name fails the real TLS handshake', { timeout: 45_000 }, async t => {
  const { ca, issue } = testAuthority()
  const operator = issue('operator', [{ type: 6, value: 'nexus://agent/moss' }])
  const issuer = issue('issuer', [{ type: 2, value: 'issuer.test' }])
  const runtime = issue('bob-runtime', [{ type: 2, value: userRuntimeServerName('bob') }])
  const subjectId = `session-${randomUUID()}`
  const delegated = issue(subjectId, [{ type: 6, value: `nexus://agent/${subjectId}` }, { type: 6, value: 'nexus://owner/alice' }])
  const issuerEndpoint = await serve(t, ca, issuer, 'nexus.raft.ZoneApiService', {
    MintSessionAgent(_call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) {
      callback(null, { success: true, subject_id: subjectId, ca_pem: ca,
        agent_cert_pem: delegated.cert, agent_key_pem: delegated.key })
    },
  })
  let runtimeRequests = 0
  const runtimeEndpoint = await serve(t, ca, runtime, 'nexus.grpc.vfs.NexusVFSService', {
    Read(_call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) {
      runtimeRequests++
      callback(null, { content: Buffer.from('wrong owner') })
    },
  })
  const positive = NexusVfsClient.withMtls(runtimeEndpoint,
    { ca, ...delegated, serverName: userRuntimeServerName('bob') })
  t.after(() => positive.close())
  assert.equal((await positive.read('/agents/a/file', '')).toString(), 'wrong owner')
  assert.equal(runtimeRequests, 1, 'The same endpoint and CA must be reachable with its actual server name')
  const connection = await connectSessionRuntime({ endpoint: issuerEndpoint, runtimeEndpoint,
    tls: { ca, ...operator, serverName: 'issuer.test' } }, 'alice')
  t.after(() => connection.client.close())
  await assert.rejects(connection.client.read('/agents/a/file', connection.authToken), /DEADLINE_EXCEEDED|UNAVAILABLE/)
  assert.equal(runtimeRequests, 1, 'The Alice-target connection must not reach the Bob runtime')
})

void test('private controller uses actual delegated mTLS for Call, mailbox and file reads', { timeout: 30_000 }, async t => {
  const { ca, issue } = testAuthority()
  const operator = issue('operator', [{ type: 6, value: 'nexus://agent/moss' }])
  const issuer = issue('issuer', [{ type: 2, value: 'issuer.test' }])
  const runtime = issue('runtime', [{ type: 2, value: userRuntimeServerName('alice') }])
  const subjectId = `session-${randomUUID()}`
  const delegated = issue(subjectId, [{ type: 6, value: `nexus://agent/${subjectId}` }, { type: 6, value: 'nexus://owner/alice' }])
  const issuerEndpoint = await serve(t, ca, issuer, 'nexus.raft.ZoneApiService', {
    MintSessionAgent(call: grpc.ServerUnaryCall<{ owner_id: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      assert.equal(call.getAuthContext().sslPeerCertificate?.subject.CN, 'operator')
      assert.equal(call.request.owner_id, 'alice')
      callback(null, { success: true, subject_id: subjectId, ca_pem: ca,
        agent_cert_pem: delegated.cert, agent_key_pem: delegated.key })
    },
  })
  let calls = 0
  const snapshot = { session_id: '19.3', owner_id: 'alice', agent_id: 'moss-alice',
    durable_session_id: 'history-original', workspace_path: '/proc/19.3/workspace/', state: 'ready',
    session_endpoint: { protocol: 'acp-mailbox/1', channel_id: 'channel-original',
      agent: 'moss-alice', controller: subjectId, transcript: `/conversations/${'a'.repeat(32)}/transcript` },
    fixture_text: '客户 📝' }
  const agentCodec = new SessionCodec(snapshot.session_endpoint as NexusSessionEndpoint, 'agent')
  const records: Buffer[] = []
  let mailboxWrites = 0
  let mailboxReads = 0
  let fileReads = 0
  const originalFile = Buffer.from('original transcript 客户 📝\n')
  let replyLost = false
  const assertPeer = (call: grpc.ServerUnaryCall<{ auth_token: string; path: string }, unknown>) => {
    assert.equal(call.request.auth_token, '')
    assert.equal(call.request.path, snapshot.session_endpoint.transcript)
    assert.deepEqual(call.getAuthContext().sslPeerCertificate?.raw, new X509Certificate(delegated.cert).raw)
  }
  const runtimeEndpoint = await serve(t, ca, runtime, 'nexus.grpc.vfs.NexusVFSService', {
    Read(call: grpc.ServerUnaryCall<{ path: string; auth_token: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      fileReads++
      assert.equal(call.request.auth_token, '')
      assert.deepEqual(call.getAuthContext().sslPeerCertificate?.raw, new X509Certificate(delegated.cert).raw)
      if (call.request.path === '/original/unavailable') {
        callback({ code: grpc.status.UNAVAILABLE, details: 'fixture read unavailable' }, null)
        return
      }
      assert.ok(['/original/transcript', '/original/empty'].includes(call.request.path))
      callback(null, { content: call.request.path === '/original/empty' ? Buffer.alloc(0) : originalFile })
    },
    StreamReadAt(call: grpc.ServerUnaryCall<{ path: string; offset: string; auth_token: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      assertPeer(call)
      mailboxReads++
      const data = records[Number(call.request.offset)]
      callback(null, { data: data ?? Buffer.alloc(0),
        next_offset: data ? String(Number(call.request.offset) + 1) : call.request.offset,
        timed_out: !data })
    },
    StreamWriteNowait(call: grpc.ServerUnaryCall<{ path: string; data: Buffer; auth_token: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      assertPeer(call)
      mailboxWrites++
      records.push(call.request.data)
      const payload = agentCodec.decode(call.request.data)
      if (replyLost) {
        callback({ code: grpc.status.UNAVAILABLE, details: 'fixture committed; reply lost' }, null)
        return
      }
      if (payload?.type === 'rpc') records.push(agentCodec.encode({ type: 'rpc', message: {
        jsonrpc: '2.0', id: payload.message.id,
        error: { code: -32002, message: 'Original history is unavailable',
          data: { sessionId: 'history-original', preserved: '原始 🧩' } },
      } }))
      callback(null, {})
    },
    Call(call: grpc.ServerUnaryCall<{ method: string; payload: Buffer; auth_token: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      calls++
      assert.equal(call.request.auth_token, '')
      assert.deepEqual(call.getAuthContext().sslPeerCertificate?.raw, new X509Certificate(delegated.cert).raw)
      assert.equal(call.request.method, 'managed_agent.get_session_v1')
      const params = JSON.parse(call.request.payload.toString('utf8')) as { session_id: string; owner_id?: string }
      assert.equal(params.session_id, '19.3')
      if (params.owner_id && params.owner_id !== 'alice') {
        callback(null, { is_error: true, payload: Buffer.from(JSON.stringify({ code: -32603, message: 'fixture owner mismatch' })) })
      } else callback(null, { payload: Buffer.from(JSON.stringify(snapshot)) })
    },
  })
  const temporaryRoot = await realpath(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'sudo-controller-rpc-'))
  t.after(async () => {
    const target = await realpath(directory)
    assert.equal(dirname(target), temporaryRoot)
    assert.ok(basename(target).startsWith('sudo-controller-rpc-'))
    await rm(target, { recursive: true, force: true })
  })
  const tls = { ca: join(directory, 'ca.pem'), cert: join(directory, 'operator.pem'),
    key: join(directory, 'operator-key.pem'), serverName: 'issuer.test' }
  await Promise.all([[tls.ca, ca], [tls.cert, operator.cert], [tls.key, operator.key]].map(
    async ([path, bytes]) => writeFile(path as string, bytes as Buffer, { mode: 0o600 })))
  const safeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP'].includes(key.toUpperCase())))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/controller-rpc.mjs', import.meta.url))],
    { env: safeEnvironment })
  t.after(() => { if (child.exitCode === null) child.kill() })
  child.stderr.resume()
  const lines = createInterface({ input: child.stdout })
  const iterator = lines[Symbol.asyncIterator]()
  const next = async () => {
    const frame = await iterator.next()
    assert.equal(frame.done, false)
    return JSON.parse(frame.value!) as Record<string, unknown>
  }
  child.stdin.write(JSON.stringify({ type: 'capabilities' }) + '\n')
  assert.deepEqual(await next(), { type: 'capabilities', version: 1,
    operations: ['call', 'session.open', 'session.send', 'session.receive', 'session.close', 'file.read'] })
  assert.equal(calls, 0)
  assert.equal(fileReads, 0)
  child.stdin.write(JSON.stringify({ type: 'connect', version: 1, ownerId: 'alice',
    config: { endpoint: issuerEndpoint, runtimeEndpoint, tls } }) + '\n')
  assert.deepEqual(await next(), { type: 'ready', version: 1 })
  child.stdin.write(JSON.stringify({ type: 'call', id: 1, method: 'managed_agent.get_session_v1',
    payload: JSON.stringify({ session_id: '19.3' }) }) + '\n')
  const response = await next()
  assert.equal(response.type, 'result')
  assert.deepEqual(JSON.parse(response.payload as string), snapshot)
  child.stdin.write(JSON.stringify({ type: 'call', id: 2, method: 'managed_agent.get_session_v1',
    payload: JSON.stringify({ session_id: '19.3', owner_id: 'bob' }) }) + '\n')
  assert.deepEqual(await next(), { type: 'error', id: 2, code: 'SDK_CALL_FAILED', isOutcomeUncertain: true,
    nativeFailure: { code: -32603, message: 'fixture owner mismatch' } })
  assert.equal(calls, 2)
  const session = (id: number, operation: string, payload = '') => child.stdin.write(
    JSON.stringify({ type: 'session', id, operation, payload }) + '\n')
  session(3, 'open', JSON.stringify(snapshot.session_endpoint))
  assert.deepEqual(await next(), { type: 'result', id: 3, payload: '' })
  session(4, 'send', JSON.stringify({ jsonrpc: '2.0', id: 'load-original', method: 'session/load',
    params: { sessionId: 'history-original' } }))
  assert.deepEqual(await next(), { type: 'result', id: 4, payload: '' })
  session(5, 'receive')
  const received = await next()
  assert.equal(received.type, 'result')
  assert.deepEqual(JSON.parse(received.payload as string), { jsonrpc: '2.0', id: 'load-original',
    error: { code: -32002, message: 'Original history is unavailable',
      data: { sessionId: 'history-original', preserved: '原始 🧩' } } })
  assert.ok(mailboxReads > 0)
  assert.equal(mailboxWrites, 1)
  replyLost = true
  session(6, 'send', JSON.stringify({ jsonrpc: '2.0', id: 'original-input', method: 'session/prompt',
    params: { sessionId: 'history-original' } }))
  assert.deepEqual(await next(), { type: 'error', id: 6, code: 'SDK_SESSION_FAILED', isOutcomeUncertain: true })
  assert.equal(mailboxWrites, 2, 'An ambiguous typed append is never retried')
  child.stdin.write(JSON.stringify({ type: 'read', id: 7, path: '/original/transcript' }) + '\n')
  assert.deepEqual(await next(), { type: 'result', id: 7, payload: originalFile.toString('base64') })
  child.stdin.write(JSON.stringify({ type: 'read', id: 8, path: '/original/unavailable' }) + '\n')
  assert.deepEqual(await next(), { type: 'error', id: 8, code: 'SDK_READ_FAILED', isOutcomeUncertain: true })
  child.stdin.write(JSON.stringify({ type: 'read', id: 9, path: '/original/empty' }) + '\n')
  assert.deepEqual(await next(), { type: 'result', id: 9, payload: '' })
  assert.equal(fileReads, 3, 'A failed read is not retried')
  assert.equal(calls, 2, 'Typed reads do not use a generic Call alias')
  assert.equal(mailboxWrites, 2, 'Read reconciliation submits no new native input')
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve))
  child.stdin.end()
  assert.equal(await exited, 0)
  lines.close()
})
