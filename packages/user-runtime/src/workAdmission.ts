import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/** New work was refused before its operation ran. */
export class WorkAdmissionPausedError extends Error {
  readonly statusCode = 503

  constructor() {
    super('Runtime work admission is paused')
    this.name = 'WorkAdmissionPausedError'
  }
}

interface WorkScope {
  isActive: boolean
  continuationId?: string
}

/**
 * Process-local admission and joining for asynchronous runtime work.
 * Pause before inspecting executions. Previously admitted work, including its
 * nested operations, can finish; new roots cannot claim jobs or forward input.
 * A released scope cannot authorize a timer or callback that outlives its work.
 * This gate does not coordinate peers, prove native idleness, or cancel work.
 */
export class WorkAdmission {
  readonly epochId = randomUUID()
  readonly #context = new AsyncLocalStorage<WorkScope>()
  readonly #pauses = new Set<symbol>()
  readonly #idleWaiters = new Set<() => void>()
  readonly #continuations = new Map<string, WorkScope>()
  #activeCount = 0

  get isPaused(): boolean { return this.#pauses.size > 0 }
  get activeCount(): number { return this.#activeCount }

  /** Refuse a new root synchronously; admitted descendants retain their grant. */
  tryRun<T>(operation: () => T | PromiseLike<T>): Promise<T> | undefined {
    if (this.isPaused && !this.#context.getStore()?.isActive) return undefined
    const scope: WorkScope = { isActive: true }
    this.#activeCount++
    return this.#context.run(scope, async () => {
      try { return await operation() }
      finally {
        scope.isActive = false
        if (scope.continuationId) this.#continuations.delete(scope.continuationId)
        this.#activeCount--
        if (this.#activeCount === 0) {
          for (const notify of this.#idleWaiters) notify()
        }
      }
    })
  }

  async run<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    const work = this.tryRun(operation)
    if (!work) throw new WorkAdmissionPausedError()
    return await work
  }

  /** Carry an active operation across this process's authenticated transports. */
  captureContinuation(): string | undefined {
    const scope = this.#context.getStore()
    if (!scope?.isActive) return undefined
    if (!scope.continuationId) {
      scope.continuationId = randomUUID()
      this.#continuations.set(scope.continuationId, scope)
    }
    return scope.continuationId
  }

  /** A continuation is admission only; callers must still authorize the peer. */
  tryRunContinuation<T>(id: string | undefined, operation: () => T | PromiseLike<T>): Promise<T> | undefined {
    const scope = id ? this.#continuations.get(id) : undefined
    return scope?.isActive
      ? this.#context.run(scope, () => this.tryRun(operation))
      : this.tryRun(operation)
  }

  /** Independent holders must all release before fresh roots may enter. */
  pause(): { resume(): void } {
    const token = Symbol('pause')
    this.#pauses.add(token)
    return { resume: () => { this.#pauses.delete(token) } }
  }

  /** Join admitted work within a caller budget, without cancelling that work. */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError('Invalid idle timeout')
    if (this.#activeCount === 0) return true
    return await new Promise<boolean>(resolve => {
      const finish = (isIdle: boolean): void => {
        clearTimeout(timer)
        this.#idleWaiters.delete(onIdle)
        resolve(isIdle)
      }
      const onIdle = (): void => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      this.#idleWaiters.add(onIdle)
    })
  }
}
