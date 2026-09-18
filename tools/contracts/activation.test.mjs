import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  REPO,
  assertNoActivationSelfReference,
  readCommitBlob,
  verifyActivation,
  verifyActivationRecords,
} from './activation.mjs'

const activationPath = 'manifests/activations/0.2.0-candidate.json'
const activation = JSON.parse(readFileSync(join(REPO, activationPath), 'utf8'))
const manifestPath = activation.precursor_candidate_manifest.path
const precursorManifestBytes = readCommitBlob(
  REPO,
  activation.candidate_content_revision,
  manifestPath,
)
const currentManifest = JSON.parse(readFileSync(join(REPO, manifestPath), 'utf8'))
const candidateBytes = (path) => readCommitBlob(REPO, activation.candidate_content_revision, path)
const currentBytes = (path) => readFileSync(join(REPO, path))

const verify = (overrides = {}) =>
  verifyActivationRecords({
    activation,
    currentManifest,
    precursorManifestBytes,
    candidateBytes,
    currentBytes,
    ...overrides,
  })

test('activation verifies immutable candidate content across supported Git relations', () => {
  const result = verifyActivation({ repository: REPO })
  assert.equal(result.candidateRevision, activation.candidate_content_revision)
  assert.ok(
    ['content_head_before_activation_commit', 'immediate_parent', 'required_ancestor'].includes(
      result.relation,
    ),
    result.relation,
  )
  assert.ok(result.attributedPathCount > 40)
})

test('symbolic and malformed candidate revisions fail before object reads', () => {
  for (const revision of ['main', 'v0.2.0', 'claude/activation', '30da0ddd']) {
    const changed = structuredClone(activation)
    changed.candidate_content_revision = revision
    assert.throws(() => verify({ activation: changed }), /full lowercase 40-character commit SHA/)
  }
})

test('precursor manifest digest mutation fails activation', () => {
  const changed = structuredClone(activation)
  changed.precursor_candidate_manifest.sha256 = '0'.repeat(64)
  assert.throws(() => verify({ activation: changed }), /precursor candidate-manifest digest/)
})

test('changed current attributed bytes fail activation', () => {
  const changedPath = 'compatibility/current.gen.json'
  assert.throws(
    () =>
      verify({
        currentBytes: (path) =>
          path === changedPath ? Buffer.concat([currentBytes(path), Buffer.from(' ')]) : currentBytes(path),
      }),
    /differs from candidate content revision/,
  )
})

test('changed candidate blob or recorded artifact digest fails activation', () => {
  const changedPath = 'contracts/zone-id/zone-id.gen.js'
  assert.throws(
    () =>
      verify({
        candidateBytes: (path) =>
          path === changedPath ? Buffer.concat([candidateBytes(path), Buffer.from(' ')]) : candidateBytes(path),
      }),
    /differs from candidate content revision|Expected values to be strictly equal/,
  )

  const changedManifest = structuredClone(currentManifest)
  changedManifest.generated_artifacts.find((artifact) => artifact.path === changedPath).sha256 =
    '0'.repeat(64)
  assert.throws(
    () => verify({ currentManifest: changedManifest }),
    /Expected values to be strictly deep-equal/,
  )
})

test('activation metadata cannot embed its containing commit', () => {
  const futureHead = 'f'.repeat(40)
  assert.throws(
    () =>
      assertNoActivationSelfReference({
        head: futureHead,
        candidateRevision: activation.candidate_content_revision,
        text: JSON.stringify({ ...activation, activation_revision: futureHead }),
      }),
    /must not embed its containing commit SHA/,
  )
  assert.doesNotThrow(() =>
    assertNoActivationSelfReference({
      head: futureHead,
      candidateRevision: activation.candidate_content_revision,
      text: JSON.stringify(activation),
    }),
  )
})
