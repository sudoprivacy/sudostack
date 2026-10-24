import assert from 'node:assert/strict'
import { AsyncResource } from 'node:async_hooks'
import { test } from 'node:test'
import { WorkAdmission, WorkAdmissionPausedError } from '../src/workAdmission.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

void test('pause refuses fresh claims before their side effects and resumes independently', async () => {
  const gate = new WorkAdmission()
  const first = gate.pause()
  const second = gate.pause()
  let claims = 0
  assert.equal(gate.tryRun(() => ++claims), undefined)
  await assert.rejects(gate.run(() => ++claims), WorkAdmissionPausedError)
  first.resume()
  first.resume()
  assert.equal(gate.isPaused, true)
  assert.equal(claims, 0)
  second.resume()
  assert.equal(await gate.run(() => ++claims), 1)
  assert.equal(gate.activeCount, 0)
})

void test('an in-flight claim may dispatch and finish while fresh roots are paused', async () => {
  const gate = new WorkAdmission()
  const claimed = deferred()
  const releaseClaim = deferred()
  let dispatched = false
  const job = gate.run(async () => {
    claimed.resolve()
    await releaseClaim.promise
    await gate.run(() => { dispatched = true })
  })
  await claimed.promise
  const pause = gate.pause()
  assert.equal(gate.tryRun(() => assert.fail('new claim')), undefined)
  assert.equal(await gate.waitForIdle(1), false)
  assert.equal(gate.activeCount, 1)
  releaseClaim.resolve()
  assert.equal(await gate.waitForIdle(1000), true)
  await job
  assert.equal(dispatched, true)
  assert.equal(gate.activeCount, 0)
  pause.resume()
})

void test('a child registered before its parent returns remains in the join', async () => {
  const gate = new WorkAdmission()
  const releaseChild = deferred()
  let child!: Promise<void>
  await gate.run(() => { child = gate.run(() => releaseChild.promise) })
  gate.pause()
  assert.equal(gate.activeCount, 1)
  const joined = gate.waitForIdle(1000)
  releaseChild.resolve()
  assert.equal(await joined, true)
  await child
})

void test('an escaped asynchronous context cannot admit work after its scope settles', async () => {
  const gate = new WorkAdmission()
  let escaped!: AsyncResource
  await gate.run(() => { escaped = new AsyncResource('old-work') })
  gate.pause()
  assert.equal(escaped.runInAsyncScope(() => gate.tryRun(() => assert.fail('escaped claim'))), undefined)
  escaped.emitDestroy()
  assert.equal(gate.activeCount, 0)
})

void test('synchronous errors and asynchronous failures release every join waiter', async () => {
  const gate = new WorkAdmission()
  await assert.rejects(gate.run(() => { throw new Error('sync failure') }), /sync failure/)
  const release = deferred()
  const failed = gate.run(async () => { await release.promise; throw new Error('async failure') })
  const rejected = assert.rejects(failed, /async failure/)
  gate.pause()
  const one = gate.waitForIdle(1000)
  const two = gate.waitForIdle(1000)
  release.resolve()
  assert.deepEqual(await Promise.all([one, two]), [true, true])
  await rejected
  assert.equal(gate.activeCount, 0)
})

void test('a transport continuation permits only a still-active local operation', async () => {
  const gate = new WorkAdmission()
  const release = deferred()
  let continuation!: string
  const parent = gate.run(async () => {
    continuation = gate.captureContinuation()!
    assert.equal(gate.captureContinuation(), continuation)
    await release.promise
  })
  gate.pause()
  assert.equal(gate.tryRunContinuation('unknown', () => assert.fail('untrusted continuation')), undefined)
  assert.equal(await gate.tryRunContinuation(continuation, () => 'accepted child'), 'accepted child')
  assert.equal(await gate.waitForIdle(1), false)
  release.resolve()
  await parent
  assert.equal(gate.tryRunContinuation(continuation, () => assert.fail('expired continuation')), undefined)
  assert.equal(await gate.waitForIdle(0), true)
  assert.equal(gate.captureContinuation(), undefined)
})
