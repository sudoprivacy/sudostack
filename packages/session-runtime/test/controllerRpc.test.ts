import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { NexusVfsClient, NexusZoneApiClient } from '@nexus-ai-fs/vfs-client'

import { runControllerRpc } from '../src/controllerRpc.js'

function bootstrap() {
  return { type: 'connect', version: 1, ownerId: 'alice', config: {
    endpoint: 'https://issuer', runtimeEndpoint: 'https://alice-runtime',
    tls: { ca: resolve('issuer-ca'), cert: resolve('issuer-cert'), key: resolve('issuer-key'), serverName: 'issuer' },
  } }
}

function harness(t: TestContext, invoke: (method: string, payload: string) => Promise<string> = async (_method, payload) => payload) {
  const input = new PassThrough()
  const output = new PassThrough()
  const calls: { method: string; payload: string; authToken: string }[] = []
  const frames: Record<string, unknown>[] = []
  const waiting: ((frame: Record<string, unknown>) => void)[] = []
  const seen: string[] = []
  let held = ''
  let issuerConnections = 0
  let runtimeCloses = 0
  output.on('data', (bytes: Buffer) => {
    const chunk = bytes.toString('utf8')
    seen.push(chunk)
    held += chunk
    let newline: number
    while ((newline = held.indexOf('\n')) >= 0) {
      const frame = JSON.parse(held.slice(0, newline)) as Record<string, unknown>
      held = held.slice(newline + 1)
      const receive = waiting.shift()
      if (receive) receive(frame)
      else frames.push(frame)
    }
  })
  t.mock.method(NexusZoneApiClient, 'withMtls', () => {
    issuerConnections++
    return { mintSessionAgent: async (owner: string) => {
      assert.equal(owner, 'alice')
      return { subjectId: 'session-00000000-0000-0000-0000-000000000000',
        caPem: Buffer.from('delegated-ca'), certPem: Buffer.from('delegated-cert'), keyPem: Buffer.from('delegated-key') }
    }, close: () => {} }
  })
  t.mock.method(NexusVfsClient, 'withMtls', (endpoint, tls) => {
    assert.equal(endpoint, 'https://alice-runtime')
    assert.equal(tls.key.toString(), 'delegated-key')
    return {
      maintainSessionCredential: () => {},
      call: async (method: string, payload: string, authToken: string) => {
        calls.push({ method, payload, authToken })
        return invoke(method, payload)
      },
      close: () => { runtimeCloses++ },
    }
  })
  const finished = runControllerRpc(input, output).then(() => true, () => false)
  const send = (frame: unknown) => input.write(JSON.stringify(frame) + '\n')
  const next = () => frames.length
    ? Promise.resolve(frames.shift()!)
    : new Promise<Record<string, unknown>>(receive => { waiting.push(receive) })
  return { input, calls, send, next, finished, outputText: () => seen.join(''),
    issuerConnections: () => issuerConnections, runtimeCloses: () => runtimeCloses }
}

void test('controller calls preserve UTF-8, fixed owner connection and empty bearer', { timeout: 5000 }, async t => {
  const h = harness(t)
  h.send(bootstrap())
  assert.deepEqual(await h.next(), { type: 'ready', version: 1 })
  const payload = JSON.stringify({ text: '客户 📝\nretained' })
  h.send({ type: 'call', id: 1, method: 'managed_agent.get_session_v1', payload })
  assert.deepEqual(await h.next(), { type: 'result', id: 1, payload })
  assert.deepEqual(h.calls, [{ method: 'managed_agent.get_session_v1', payload, authToken: '' }])
  assert.equal(h.outputText().includes('delegated-key'), false)
  assert.equal(h.outputText().includes('issuer-key'), false)
  h.input.end()
  assert.equal(await h.finished, true)
  assert.equal(h.runtimeCloses(), 1)
})

for (const field of ['authToken', 'ownerId', 'endpoint']) {
  void test(`a per-call ${field} override refuses without native dispatch`, { timeout: 5000 }, async t => {
    const h = harness(t)
    h.send(bootstrap())
    await h.next()
    h.send({ type: 'call', id: 1, method: 'agent_list', payload: '{}', [field]: 'other-authority' })
    assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
    assert.equal(await h.finished, false)
    assert.equal(h.calls.length, 0)
  })
}

for (const field of ['authToken', 'ownerId', 'endpoint']) {
  void test(`typed session ${field} override refuses before any mailbox dispatch`, { timeout: 5000 }, async t => {
    const h = harness(t)
    h.send(bootstrap())
    await h.next()
    h.send({ type: 'session', id: 1, operation: 'open', payload: '{}', [field]: 'untrusted' })
    assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
    assert.equal(await h.finished, false)
    assert.equal(h.calls.length, 0)
  })
}

for (const change of [
  (boot: ReturnType<typeof bootstrap>) => ({ ...boot, version: 2 }),
  (boot: ReturnType<typeof bootstrap>) => ({ ...boot, ownerId: '' }),
  (boot: ReturnType<typeof bootstrap>) => ({ ...boot, authToken: 'operator-token' }),
  (boot: ReturnType<typeof bootstrap>) => ({ ...boot, config: { ...boot.config, tls: { ...boot.config.tls, key: 'relative-key' } } }),
]) {
  void test('invalid private bootstrap refuses before issuer access', { timeout: 5000 }, async t => {
    const h = harness(t)
    h.send(change(bootstrap()))
    assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
    assert.equal(await h.finished, false)
    assert.equal(h.issuerConnections(), 0)
  })
}

void test('completed correlation cannot be reused to replay a native call', { timeout: 5000 }, async t => {
  const h = harness(t)
  h.send(bootstrap())
  await h.next()
  const call = { type: 'call', id: 1, method: 'write', payload: '{}' }
  h.send(call)
  assert.equal((await h.next()).type, 'result')
  h.send(call)
  assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
  assert.equal(await h.finished, false)
  assert.equal(h.calls.length, 1)
})

void test('native failure remains uncertain and preserves only its structured recovery verdict', { timeout: 5000 }, async t => {
  const h = harness(t, async () => { throw new Error(JSON.stringify({
    code: -32603, message: 'managed call refused /private/original', data: { privateKey: 'never-emit-this' },
  })) })
  h.send(bootstrap())
  await h.next()
  h.send({ type: 'call', id: 1, method: 'managed_agent.start_session_v1', payload: '{}' })
  assert.deepEqual(await h.next(), { type: 'error', id: 1, code: 'SDK_CALL_FAILED', isOutcomeUncertain: true,
    nativeFailure: { code: -32603, message: 'managed call refused /private/original' } })
  assert.equal(h.outputText().includes('never-emit-this'), false)
  assert.equal(h.calls.length, 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('lost/native transport reply never triggers an automatic retry', { timeout: 5000 }, async t => {
  const h = harness(t, async () => { throw new Error('unavailable private TLS detail') })
  h.send(bootstrap())
  await h.next()
  h.send({ type: 'call', id: 1, method: 'managed_agent.start_session_v1', payload: '{}' })
  assert.deepEqual(await h.next(), { type: 'error', id: 1, code: 'SDK_CALL_FAILED', isOutcomeUncertain: true })
  assert.equal(h.outputText().includes('private TLS'), false)
  assert.equal(h.calls.length, 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('capacity refusal occurs before dispatch while completed replies retain their IDs', { timeout: 5000 }, async t => {
  const resolvers: ((text: string) => void)[] = []
  const h = harness(t, async () => new Promise<string>(resolve => { resolvers.push(resolve) }))
  h.send(bootstrap())
  await h.next()
  for (let id = 1; id <= 17; id++) h.send({ type: 'call', id, method: 'agent_list', payload: '{}' })
  assert.deepEqual(await h.next(), { type: 'error', id: 17, code: 'LIMIT_REACHED', isOutcomeUncertain: false })
  assert.equal(h.calls.length, 16)
  for (let index = resolvers.length - 1; index >= 0; index--) resolvers[index]!(`reply-${index + 1}`)
  const replies = await Promise.all(Array.from({ length: 16 }, () => h.next()))
  assert.equal(replies[0]!.id, 16)
  assert.equal(replies[15]!.id, 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('oversized input terminates without submitting a native call', { timeout: 5000 }, async t => {
  const h = harness(t)
  h.send(bootstrap())
  await h.next()
  h.input.write(Buffer.alloc(8 * 1024 * 1024 + 1, 32))
  assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
  assert.equal(await h.finished, false)
  assert.equal(h.calls.length, 0)
})

void test('truncated input and invalid UTF-8 refuse without forwarding', { timeout: 5000 }, async t => {
  const h = harness(t)
  h.send(bootstrap())
  await h.next()
  h.input.end(Buffer.from([0xff, 10]))
  assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
  assert.equal(await h.finished, false)
  assert.equal(h.calls.length, 0)
})
