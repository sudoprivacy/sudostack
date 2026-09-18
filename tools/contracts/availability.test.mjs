import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { readCommitBlob, sha256 } from './activation.mjs'
import {
  OPERATION_PATH,
  REPO,
  SOURCE_CLOSURE_PATH,
  SOURCE_LOCK_PATH,
  verifyAvailability,
  verifyAvailabilityRecords,
} from './availability.mjs'

const operationBytes = readFileSync(join(REPO, OPERATION_PATH))
const operation = JSON.parse(operationBytes.toString('utf8'))
const activationRevision = operation.activation_revision
const previousSourceLockBytes = readCommitBlob(REPO, activationRevision, SOURCE_LOCK_PATH)
const previousSourceClosureBytes = readCommitBlob(REPO, activationRevision, SOURCE_CLOSURE_PATH)
const previousCandidateManifestBytes = readCommitBlob(
  REPO,
  activationRevision,
  'manifests/releases/0.2.0-candidate.gen.json',
)
const currentSourceLockBytes = readFileSync(join(REPO, SOURCE_LOCK_PATH))
const currentSourceClosureBytes = readFileSync(join(REPO, SOURCE_CLOSURE_PATH))
const currentCandidateManifest = JSON.parse(
  readFileSync(join(REPO, 'manifests/releases/0.2.0-candidate.gen.json'), 'utf8'),
)
const currentToolBytes = readFileSync(join(REPO, 'tools/contracts/availability.mjs'))

const verify = (overrides = {}) =>
  verifyAvailabilityRecords({
    operation,
    previousSourceLockBytes,
    previousSourceClosureBytes,
    previousCandidateManifestBytes,
    currentSourceLockBytes,
    currentSourceClosureBytes,
    currentCandidateManifest,
    operationBytes,
    currentToolBytes,
    ...overrides,
  })

function withOwnProperty(bytes, key, value) {
  const record = JSON.parse(bytes.toString('utf8'))
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
}

test('published source availability is a bounded post-activation override', () => {
  const result = verifyAvailability({ repository: REPO })
  assert.equal(result.activationRevision, activationRevision)
  assert.ok(
    ['activation_head_before_availability_commit', 'immediate_parent', 'required_ancestor'].includes(
      result.relation,
    ),
  )
  assert.equal(JSON.parse(currentSourceLockBytes).source_availability.remote, 'available')
})

test('availability operation candidate revision is bound to both candidate manifests', () => {
  const bogusCandidateRevision = '0'.repeat(40)
  const changedOperation = structuredClone(operation)
  changedOperation.candidate_content_revision = bogusCandidateRevision
  assert.throws(
    () => verify({ operation: changedOperation }),
    /does not match activation-era candidate manifest/,
  )

  const changedPreviousCandidateManifest = JSON.parse(
    previousCandidateManifestBytes.toString('utf8'),
  )
  changedPreviousCandidateManifest.sudostack.candidate_revision = bogusCandidateRevision
  const changedPreviousCandidateManifestBytes = Buffer.from(
    `${JSON.stringify(changedPreviousCandidateManifest, null, 2)}\n`,
  )
  changedOperation.previous.candidate_manifest_sha256 = sha256(
    changedPreviousCandidateManifestBytes,
  )
  assert.throws(
    () =>
      verify({
        operation: changedOperation,
        previousCandidateManifestBytes: changedPreviousCandidateManifestBytes,
      }),
    /does not match current candidate manifest/,
  )
})

test('availability transition rejects unrelated source-lock changes', () => {
  const changed = JSON.parse(currentSourceLockBytes)
  changed.repositories.nexus.revision = '0'.repeat(40)
  assert.throws(
    () =>
      verify({
        currentSourceLockBytes: Buffer.from(`${JSON.stringify(changed, null, 2)}\n`),
      }),
    /source lock changed outside source_availability override/,
  )
})

test('availability transition rejects prototype-collision own-property additions', () => {
  const changedSourceLockBytes = withOwnProperty(currentSourceLockBytes, '__proto__', {})
  assert.throws(
    () => verify({ currentSourceLockBytes: changedSourceLockBytes }),
    /source lock changed outside source_availability override/,
  )
})

test('availability transition rejects prototype-collision own-property deletions', () => {
  const changedPreviousSourceLockBytes = withOwnProperty(previousSourceLockBytes, '__proto__', {})
  const changedOperation = structuredClone(operation)
  changedOperation.previous.source_lock_sha256 = sha256(changedPreviousSourceLockBytes)
  assert.throws(
    () =>
      verify({
        operation: changedOperation,
        previousSourceLockBytes: changedPreviousSourceLockBytes,
      }),
    /source lock changed outside source_availability override/,
  )
})

test('availability transition rejects unrelated source-closure changes', () => {
  const changed = JSON.parse(currentSourceClosureBytes)
  changed.lifecycle.deployment_evidence = 'deployed'
  assert.throws(
    () =>
      verify({
        currentSourceClosureBytes: Buffer.from(`${JSON.stringify(changed, null, 2)}\n`),
      }),
    /source closure changed outside source_availability override/,
  )
})

test('availability transition rejects semantic candidate-manifest changes', () => {
  const changed = structuredClone(currentCandidateManifest)
  changed.package.actual_consumers = ['not-allowed']
  assert.throws(
    () => verify({ currentCandidateManifest: changed }),
    /package changed during source availability transition/,
  )
})

test('availability state and previous digests cannot be forged', () => {
  const wrongState = structuredClone(operation)
  wrongState.current.source_availability.remote = 'blocked_unpublished'
  assert.throws(() => verify({ operation: wrongState }))

  const wrongDigest = structuredClone(operation)
  wrongDigest.previous.source_lock_sha256 = '0'.repeat(64)
  assert.throws(() => verify({ operation: wrongDigest }), /Expected values to be strictly equal/)
})

test('non-operational artifact hash changes remain forbidden', () => {
  const changed = structuredClone(currentCandidateManifest)
  changed.generated_artifacts.find(
    (artifact) => artifact.path === 'contracts/zone-id/zone-id.gen.js',
  ).sha256 = '0'.repeat(64)
  assert.throws(
    () => verify({ currentCandidateManifest: changed }),
    /changed during availability transition|Expected values to be strictly equal/,
  )
})
