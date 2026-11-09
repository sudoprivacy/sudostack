import { NexusSessionTransport, type NexusSessionEndpoint, type SessionRpcMessage } from '@nexus-ai-fs/vfs-client'
import type { SessionRuntimeConnection } from './index.js'

const MAX_MESSAGES = 64
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

export class SessionReceiveBusy extends Error {
  constructor() { super('A controller session receive is already pending') }
}

/** Bounded private controller access to the official mailbox transport.
 *
 * Trusted composition authorizes the exact original allocation before open
 * and each operation. An endpoint is not that grant or proof of incarnation.
 * No runtime is started, cancelled, rebound or replaced by this adapter.
 */
export class ControllerSessionMailbox {
  private transport?: NexusSessionTransport
  private opened = false
  private closed = false
  private receiving = false
  private closeResult?: Promise<void>
  private bufferedBytes = 0
  private readonly messages: { message: SessionRpcMessage; bytes: number }[] = []
  private wake?: () => void

  constructor(private readonly connection: SessionRuntimeConnection) {}

  open(value: unknown): void {
    if (this.opened || this.closed) throw new Error('Controller session cannot be rebound')
    this.opened = true
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid controller session endpoint')
    }
    const endpoint = value as Record<string, unknown>
    if (Object.keys(endpoint).length !== 5 ||
      !['protocol', 'channel_id', 'agent', 'controller', 'transcript'].every(key => typeof endpoint[key] === 'string') ||
      endpoint.controller !== this.connection.identity.subjectId) {
      throw new Error('Session endpoint does not belong to this original controller')
    }
    // The official SDK validates protocol, participants and transcript, owns
    // framing/sequences/cursors and retries reads only at the same cursor.
    this.transport = new NexusSessionTransport({
      client: this.connection.client,
      endpoint: Object.freeze({ ...endpoint }) as unknown as NexusSessionEndpoint,
      authToken: '',
      onMessage: message => {
        const bytes = Buffer.byteLength(JSON.stringify(message))
        if (this.messages.length >= MAX_MESSAGES || this.bufferedBytes + bytes > MAX_BUFFER_BYTES) {
          throw new Error('Controller session receive capacity exhausted')
        }
        this.messages.push({ message, bytes })
        this.bufferedBytes += bytes
        this.wake?.()
      },
      onClose: () => {
        this.closed = true
        this.messages.length = this.bufferedBytes = 0
        this.wake?.()
      },
    })
    this.transport.start()
  }

  async send(message: SessionRpcMessage): Promise<void> {
    if (!this.transport || this.closed) throw new Error('Original controller session is unavailable')
    // The original SDK encodes synchronously before waiting for its write and
    // never retries an ambiguous StreamWriteNowait.
    await this.transport.send(message)
  }

  async receive(): Promise<SessionRpcMessage | undefined> {
    if (this.receiving) throw new SessionReceiveBusy()
    if (!this.transport || this.closed) throw new Error('Original controller session is unavailable')
    this.receiving = true
    try {
      if (!this.messages.length) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { this.wake = undefined; resolve() }, 1000)
          this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve() }
        })
      }
      if (this.closed) throw new Error('Original controller session is unavailable')
      const item = this.messages.shift()
      if (item) this.bufferedBytes -= item.bytes
      return item?.message
    } finally {
      this.receiving = false
    }
  }

  close(): Promise<void> {
    // This closes the original SDK transport only. Its closed frame and a
    // joined read loop do not prove that an Agent's writer/receiver stopped.
    this.closeResult ??= this.closeTransport()
    return this.closeResult
  }

  private async closeTransport(): Promise<void> {
    this.closed = true
    this.messages.length = this.bufferedBytes = 0
    this.wake?.()
    await this.transport?.close()
  }
}
