import { isAbsolute } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { connectSessionRuntime, type SessionConnectionConfig, type SessionRuntimeConnection } from './index.js'

const MAX_FRAME_BYTES = 8 * 1024 * 1024
const MAX_CALLS = 16
const decoder = new TextDecoder('utf-8', { fatal: true })

interface Call {
  type: 'call'
  id: number
  method: string
  payload: string
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}

function text(value: unknown, limit = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00\r\n]/.test(value)
}

async function* frames(input: Readable): AsyncGenerator<unknown> {
  let parts: Buffer[] = []
  let length = 0
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    let start = 0
    while (start < bytes.length) {
      const newline = bytes.indexOf(10, start)
      const end = newline < 0 ? bytes.length : newline
      const part = bytes.subarray(start, end)
      length += part.length
      if (length > MAX_FRAME_BYTES) throw new Error('Invalid controller frame')
      parts.push(part)
      if (newline < 0) break
      const line = Buffer.concat(parts, length)
      parts = []
      length = 0
      yield JSON.parse(decoder.decode(line)) as unknown
      start = newline + 1
    }
  }
  if (length) throw new Error('Incomplete controller frame')
}

async function send(output: Writable, message: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(message) + '\n')
  if (bytes.length > MAX_FRAME_BYTES) throw new Error('Controller frame exceeds limit')
  await new Promise<void>((resolve, reject) => {
    output.write(bytes, error => error ? reject(error) : resolve())
  })
}

function boot(value: unknown): { ownerId: string; config: SessionConnectionConfig; connectTimeoutMs: number } {
  if (!object(value) || !keys(value, ['type', 'version', 'ownerId', 'config'], ['connectTimeoutMs']) ||
    value.type !== 'connect' || value.version !== 1 || !text(value.ownerId) || !object(value.config) ||
    !keys(value.config, ['endpoint', 'tls'], ['runtimeEndpoint']) || !text(value.config.endpoint) ||
    (value.config.runtimeEndpoint !== undefined && !text(value.config.runtimeEndpoint))) {
    throw new Error('Invalid controller bootstrap')
  }
  const tls = value.config.tls
  if (!object(tls) || !keys(tls, ['ca', 'cert', 'key'], ['serverName']) ||
    !['ca', 'cert', 'key'].every(key => text(tls[key]) && isAbsolute(tls[key] as string)) ||
    (tls.serverName !== undefined && !text(tls.serverName))) {
    throw new Error('Controller requires trusted existing PEM paths')
  }
  const timeout = value.connectTimeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeout) || (timeout as number) < 1 || (timeout as number) > 120_000) {
    throw new Error('Invalid controller timeout')
  }
  return {
    ownerId: value.ownerId,
    config: { endpoint: value.config.endpoint, ...(value.config.runtimeEndpoint !== undefined
      ? { runtimeEndpoint: value.config.runtimeEndpoint as string } : {}),
    tls: { ca: tls.ca as string, cert: tls.cert as string, key: tls.key as string,
      ...(tls.serverName !== undefined ? { serverName: tls.serverName as string } : {}) } },
    connectTimeoutMs: timeout as number,
  }
}

function call(value: unknown): Call {
  if (!object(value) || !keys(value, ['type', 'id', 'method', 'payload']) || value.type !== 'call' ||
    !Number.isSafeInteger(value.id) || (value.id as number) < 1 || !text(value.method, 512) ||
    typeof value.payload !== 'string' || Buffer.byteLength(value.payload) > 4 * 1024 * 1024) {
    throw new Error('Invalid controller call')
  }
  return value as unknown as Call
}

/** Retain only the native structured error needed for exact controller recovery.
 * This travels on private controller IPC, never in public errors or logs.
 */
function nativeFailure(error: unknown): { code: number | string; message: string } | undefined {
  if (!(error instanceof Error) || error.message.length > 8192) return undefined
  try {
    const body: unknown = JSON.parse(error.message)
    if (object(body) && keys(body, ['code', 'message'], ['data']) &&
      (typeof body.code === 'string' || (typeof body.code === 'number' && Number.isSafeInteger(body.code))) &&
      typeof body.message === 'string') return { code: body.code, message: body.message }
  } catch { /* Transport errors have no native JSON-RPC verdict. */ }
  return undefined
}

/** Private IPC for one trusted controller's existing owner-authenticated SDK.
 *
 * No listener, new issuer, managed child, ACP framing or mailbox codec is created.
 * The authenticated application must authorize connection and each operation.
 * Local correlation IDs are neither native operation IDs nor delivery receipts.
 */
export async function runControllerRpc(input: Readable, output: Writable): Promise<void> {
  let connection: SessionRuntimeConnection | undefined
  let phase: 'bootstrap' | 'connect' | 'ready' = 'bootstrap'
  const active = new Map<number, Promise<void>>()
  let lastId = 0
  try {
    const iterator = frames(input)
    const first = await iterator.next()
    const selected = boot(first.value)
    phase = 'connect'
    connection = await connectSessionRuntime(selected.config, selected.ownerId,
      { connectTimeoutMs: selected.connectTimeoutMs })
    await send(output, { type: 'ready', version: 1 })
    phase = 'ready'
    for await (const frame of iterator) {
      const request = call(frame)
      if (request.id <= lastId) throw new Error('Reused controller correlation')
      lastId = request.id
      if (active.size >= MAX_CALLS) {
        await send(output, { type: 'error', id: request.id, code: 'LIMIT_REACHED', isOutcomeUncertain: false })
        continue
      }
      const client = connection.client
      const work = (async () => {
        let result: string
        try {
          // Only the delegated runtime client is reachable from RPC; issuer
          // access and deployment bearer overrides have no IPC surface.
          result = await client.call(request.method, request.payload, '')
        } catch (error) {
          const failure = nativeFailure(error)
          await send(output, { type: 'error', id: request.id, code: 'SDK_CALL_FAILED',
            isOutcomeUncertain: true, ...(failure ? { nativeFailure: failure } : {}) })
          return
        }
        try {
          await send(output, { type: 'result', id: request.id, payload: result })
        } catch (error) {
          // A completed native effect can have a response too large for IPC.
          // This is not a pre-effect rejection and must never authorize replay.
          if (Buffer.byteLength(result) > MAX_FRAME_BYTES / 2) {
            await send(output, { type: 'error', id: request.id, code: 'RESULT_UNAVAILABLE', isOutcomeUncertain: true })
            return
          }
          throw error
        }
      })().catch(() => {
        // Broken private output invalidates the controller connection. Closing
        // it says nothing about a native task already started by a request.
        input.destroy(new Error('Controller IPC unavailable'))
      }).finally(() => { active.delete(request.id) })
      active.set(request.id, work)
    }
  } catch {
    const code = phase === 'connect' ? 'CONNECT_FAILED' : 'INVALID_PROTOCOL'
    await send(output, { type: 'failed', code }).catch(() => {})
    throw new Error('Controller RPC unavailable')
  } finally {
    connection?.client.close()
    await Promise.allSettled(active.values())
  }
}
