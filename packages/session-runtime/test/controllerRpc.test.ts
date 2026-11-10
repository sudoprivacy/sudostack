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

function harness(t: TestContext,
  invoke: (method: string, payload: string) => Promise<string> = async (_method, payload) => payload,
  read: (path: string) => Promise<Buffer> = async () => { throw new Error('Test read not configured') }) {
  const input = new PassThrough()
  const output = new PassThrough()
  const calls: { method: string; payload: string; authToken: string }[] = []
  const reads: { path: string; authToken: string }[] = []
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
      read: async (path: string, authToken: string) => {
        reads.push({ path, authToken })
        return read(path)
      },
      close: () => { runtimeCloses++ },
    }
  })
  const finished = runControllerRpc(input, output).then(() => true, () => false)
  const send = (frame: unknown) => input.write(JSON.stringify(frame) + '\n')
  const next = () => frames.length
    ? Promise.resolve(frames.shift()!)
    : new Promise<Record<string, unknown>>(receive => { waiting.push(receive) })
  return { input, calls, reads, send, next, finished, outputText: () => seen.join(''),
    issuerConnections: () => issuerConnections, runtimeCloses: () => runtimeCloses }
}

void test('private capability inspection uses no issuer or owner connection', { timeout: 5000 }, async t => {
  const h = harness(t)
  h.send({ type: 'capabilities' })
  assert.deepEqual(await h.next(), { type: 'capabilities', version: 1,
    operations: ['call', 'session.open', 'session.send', 'session.receive', 'session.close', 'file.read'] })
  assert.equal(h.issuerConnections(), 0)
  assert.equal(h.reads.length, 0)
  h.input.end()
  assert.equal(await h.finished, true)
  assert.equal(h.runtimeCloses(), 0)
})

void test('inspection can precede the same original owner bootstrap', { timeout: 5000 }, async t => {
  const h = harness(t)
  h.send({ type: 'capabilities' })
  assert.equal((await h.next()).type, 'capabilities')
  assert.equal(h.issuerConnections(), 0)
  h.send(bootstrap())
  assert.deepEqual(await h.next(), { type: 'ready', version: 1 })
  assert.equal(h.issuerConnections(), 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('capability inspection accepts no owner or credential channel', { timeout: 5000 }, async t => {
  const h = harness(t)
  h.send({ type: 'capabilities', ownerId: 'other-owner' })
  assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
  assert.equal(await h.finished, false)
  assert.equal(h.issuerConnections(), 0)
})

void test('file reads use official typed Read, original owner and empty bearer', { timeout: 5000 }, async t => {
  const content = Buffer.concat([Buffer.from('原始输入 📝\n'), Buffer.from([0, 255])])
  const h = harness(t, undefined, async () => content)
  h.send(bootstrap())
  await h.next()
  const path = '/original/conversation/历史.jsonl'
  h.send({ type: 'read', id: 1, path })
  assert.deepEqual(await h.next(), { type: 'result', id: 1, payload: content.toString('base64') })
  assert.deepEqual(h.reads, [{ path, authToken: '' }])
  assert.equal(h.calls.length, 0)
  assert.equal(h.issuerConnections(), 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('empty file content is a successful read result', { timeout: 5000 }, async t => {
  const h = harness(t, undefined, async () => Buffer.alloc(0))
  h.send(bootstrap())
  await h.next()
  h.send({ type: 'read', id: 1, path: '/original/empty' })
  assert.deepEqual(await h.next(), { type: 'result', id: 1, payload: '' })
  assert.equal(h.reads.length, 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('failed read is private and never retried or classified as session absence', { timeout: 5000 }, async t => {
  const h = harness(t, undefined, async () => { throw new Error('private-key-value /private/path') })
  h.send(bootstrap())
  await h.next()
  h.send({ type: 'read', id: 1, path: '/original/transcript' })
  assert.deepEqual(await h.next(), { type: 'error', id: 1, code: 'SDK_READ_FAILED', isOutcomeUncertain: true })
  assert.equal(h.outputText().includes('private-key-value'), false)
  assert.equal(h.outputText().includes('/private/path'), false)
  assert.equal(h.reads.length, 1)
  assert.equal(h.calls.length, 0)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('oversized read result refuses without truncation or re-read', { timeout: 5000 }, async t => {
  const h = harness(t, undefined, async () => Buffer.alloc(4 * 1024 * 1024 + 1, 97))
  h.send(bootstrap())
  await h.next()
  h.send({ type: 'read', id: 1, path: '/original/large-transcript' })
  assert.deepEqual(await h.next(), { type: 'error', id: 1, code: 'RESULT_UNAVAILABLE', isOutcomeUncertain: true })
  assert.equal(h.reads.length, 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

void test('maximum raw read fits the existing private frame after base64 encoding', { timeout: 5000 }, async t => {
  const content = Buffer.alloc(4 * 1024 * 1024, 255)
  const h = harness(t, undefined, async () => content)
  h.send(bootstrap())
  await h.next()
  h.send({ type: 'read', id: 1, path: '/original/maximum' })
  const result = await h.next()
  assert.equal(result.type, 'result')
  assert.equal(result.id, 1)
  assert.deepEqual(Buffer.from(result.payload as string, 'base64'), content)
  assert.ok(Buffer.byteLength(JSON.stringify(result) + '\n') <= 8 * 1024 * 1024)
  assert.equal(h.reads.length, 1)
  h.input.end()
  assert.equal(await h.finished, true)
})

for (const field of ['authToken', 'ownerId', 'endpoint']) {
  void test(`file read refuses a per-request ${field}`, { timeout: 5000 }, async t => {
    const h = harness(t)
    h.send(bootstrap())
    await h.next()
    h.send({ type: 'read', id: 1, path: '/original/transcript', [field]: 'other-authority' })
    assert.deepEqual(await h.next(), { type: 'failed', code: 'INVALID_PROTOCOL' })
    assert.equal(await h.finished, false)
    assert.equal(h.reads.length, 0)
  })
}

void test('read and native call replies retain their shared original correlation', { timeout: 5000 }, async t => {
  let finish: ((text: string) => void) | undefined
  const h = harness(t, async () => new Promise<string>(resolve => { finish = resolve }), async () => Buffer.from('original'))
  h.send(bootstrap())
  await h.next()
  h.send({ type: 'call', id: 1, method: 'managed_agent.get_session_v1', payload: '{}' })
  h.send({ type: 'read', id: 2, path: '/original/transcript' })
  assert.deepEqual(await h.next(), { type: 'result', id: 2, payload: Buffer.from('original').toString('base64') })
  finish!('native-original')
  assert.deepEqual(await h.next(), { type: 'result', id: 1, payload: 'native-original' })
  h.input.end()
  assert.equal(await h.finished, true)
})

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
