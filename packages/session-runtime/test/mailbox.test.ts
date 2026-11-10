import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test, type TestContext } from 'node:test'
import { SessionCodec, type SessionRpcMessage } from '@nexus-ai-fs/vfs-client'

import type { SessionRuntimeConnection } from '../src/index.js'
import { ControllerSessionMailbox, SessionReceiveBusy } from '../src/mailbox.js'

const endpoint = { protocol: 'acp-mailbox/1' as const, channel_id: 'original-channel',
  agent: 'agent-original', controller: 'session-original-controller',
  transcript: `/conversations/${'a'.repeat(32)}/transcript` }

function fixture(t: TestContext) {
  const records: Buffer[] = []
  const writes: Buffer[] = []
  const offsets: string[] = []
  const codec = new SessionCodec(endpoint, 'agent')
  let wake: (() => void) | undefined
  let readFailure: Error | undefined
  let writeFailure: Error | undefined
  let closed = false
  const push = (record: Buffer) => { records.push(record); wake?.(); wake = undefined }
  const client = {
    streamReadAt: async (path: string, offset: string, bearer: string) => {
      assert.equal(path, endpoint.transcript)
      assert.equal(bearer, '')
      offsets.push(offset)
      if (readFailure) { const error = readFailure; readFailure = undefined; throw error }
      if (Number(offset) >= records.length && !closed) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1000)
          wake = () => { clearTimeout(timer); resolve() }
        })
      }
      const data = records[Number(offset)] ?? Buffer.alloc(0)
      return { data, nextOffset: data.length ? String(Number(offset) + 1) : offset,
        eof: false, timedOut: data.length === 0 }
    },
    streamWrite: async (path: string, bytes: Buffer, bearer: string) => {
      assert.equal(path, endpoint.transcript)
      assert.equal(bearer, '')
      writes.push(Buffer.from(bytes))
      push(bytes)
      if (writeFailure) throw writeFailure
    },
    close: () => { closed = true; wake?.(); wake = undefined },
  }
  const connection = { client, authToken: '', identity: { subjectId: endpoint.controller } } as unknown as SessionRuntimeConnection
  const mailbox = new ControllerSessionMailbox(connection)
  t.after(async () => { client.close(); await mailbox.close().catch(() => {}) })
  return { mailbox, writes, offsets,
    agent: (message: SessionRpcMessage) => push(codec.encode({ type: 'rpc', message })),
    readFailsOnce: () => { readFailure = Object.assign(new Error('transient private transport detail'), { code: 14 }) },
    writeReplyLost: () => { writeFailure = new Error('fixture effect recorded; reply lost') },
  }
}

void test('original SDK owns mailbox framing, Unicode, own-echo suppression and structured ACP error bytes', async t => {
  const f = fixture(t)
  f.mailbox.open(endpoint)
  const message: SessionRpcMessage = { jsonrpc: '2.0', id: 41, method: 'session/load',
    params: { sessionId: 'original-history', text: '原始 🧩' } }
  await f.mailbox.send(message)
  const sent = new SessionCodec(endpoint, 'agent').decode(f.writes[0]!)
  assert.deepEqual(sent, { type: 'rpc', message })
  const response: SessionRpcMessage = { jsonrpc: '2.0', id: 41,
    error: { code: -32002, message: 'Original session unavailable', data: { sessionId: 'original-history', original: true } } }
  f.agent(response)
  assert.deepEqual(await f.mailbox.receive(), response)
  assert.equal(f.writes.length, 1)
  assert.ok(f.offsets.includes('1'))
})

void test('another controller endpoint refuses before any typed I/O or identity replacement', async t => {
  const f = fixture(t)
  assert.throws(() => f.mailbox.open({ ...endpoint, controller: 'another-controller' }))
  assert.equal(f.offsets.length, 0)
  assert.equal(f.writes.length, 0)
  assert.throws(() => f.mailbox.open(endpoint), /cannot be rebound/)
})

void test('a live original mailbox cannot be reopened for a different generation', async t => {
  const f = fixture(t)
  f.mailbox.open(endpoint)
  assert.throws(() => f.mailbox.open({ ...endpoint, channel_id: 'replacement' }), /cannot be rebound/)
  f.agent({ jsonrpc: '2.0', method: 'session/update', params: { original: true } })
  assert.equal((await f.mailbox.receive())?.method, 'session/update')
})

void test('only one receive owns message order; concurrent receive is refused without consuming', async t => {
  const f = fixture(t)
  f.mailbox.open(endpoint)
  const first = f.mailbox.receive()
  await assert.rejects(f.mailbox.receive(), SessionReceiveBusy)
  const message: SessionRpcMessage = { jsonrpc: '2.0', id: 'reverse-original', method: '_sudocode/session/host_context' }
  f.agent(message)
  assert.deepEqual(await first, message)
})

void test('empty local poll is not a session terminal result or native acknowledgment', async t => {
  const f = fixture(t)
  f.mailbox.open(endpoint)
  assert.equal(await f.mailbox.receive(), undefined)
  f.agent({ jsonrpc: '2.0', id: 1, result: {} })
  assert.deepEqual(await f.mailbox.receive(), { jsonrpc: '2.0', id: 1, result: {} })
  assert.equal(f.writes.length, 0)
})

void test('retryable official read keeps the original cursor/channel and performs no writes', async t => {
  const f = fixture(t)
  f.readFailsOnce()
  f.mailbox.open(endpoint)
  f.agent({ jsonrpc: '2.0', id: 1, result: {} })
  assert.deepEqual(await f.mailbox.receive(), { jsonrpc: '2.0', id: 1, result: {} })
  assert.deepEqual(f.offsets.slice(0, 2), ['0', '0'])
  assert.equal(f.writes.length, 0)
})

void test('a committed write with a lost reply is attempted once and cannot reopen or retry', async t => {
  const f = fixture(t)
  f.mailbox.open(endpoint)
  f.writeReplyLost()
  const message: SessionRpcMessage = { jsonrpc: '2.0', id: 1, method: 'session/prompt', params: {} }
  await assert.rejects(f.mailbox.send(message))
  await assert.rejects(f.mailbox.send(message))
  assert.equal(f.writes.length, 1)
  assert.throws(() => f.mailbox.open(endpoint))
})

void test('bounded receive backlog withdraws the mailbox instead of dropping/replaying a frame', async t => {
  const f = fixture(t)
  for (let id = 1; id <= 65; id++) f.agent({ jsonrpc: '2.0', id, result: { original: id } })
  f.mailbox.open(endpoint)
  await setImmediate()
  await assert.rejects(f.mailbox.receive(), /unavailable/)
  assert.equal(f.writes.length, 0)
})

void test('closing wakes a pending receive and cannot be presented as a native completed input', async t => {
  const f = fixture(t)
  f.mailbox.open(endpoint)
  const pending = assert.rejects(f.mailbox.receive(), /unavailable/)
  await f.mailbox.close()
  await pending
  await assert.rejects(f.mailbox.send({ jsonrpc: '2.0', id: 1, method: 'session/prompt' }))
  assert.equal(f.writes.length, 1) // Official SDK closed frame only.
})
