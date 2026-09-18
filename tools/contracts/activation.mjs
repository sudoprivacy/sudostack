import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { requireFullCommitSha } from './source.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

function gitOutput(repository, args) {
  return execFileSync('git', ['-C', repository, ...args], {
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function readCommitBlob(repository, revision, path) {
  requireFullCommitSha(revision, 'candidate content revision')
  try {
    gitOutput(repository, ['cat-file', '-e', `${revision}^{commit}`])
    return gitOutput(repository, ['show', `${revision}:${path}`])
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim() || error.message
    throw new Error(`cannot read candidate content ${revision}:${path}: ${detail}`)
  }
}

function relationToHead(repository, candidateRevision) {
  const head = gitOutput(repository, ['rev-parse', 'HEAD']).toString('utf8').trim()
  if (head === candidateRevision) return { head, relation: 'content_head_before_activation_commit' }
  const parent = gitOutput(repository, ['rev-parse', 'HEAD^']).toString('utf8').trim()
  if (parent === candidateRevision) return { head, relation: 'immediate_parent' }
  const ancestor = execFileSync(
    'git',
    ['-C', repository, 'merge-base', '--is-ancestor', candidateRevision, head],
    { stdio: 'ignore' },
  )
  void ancestor
  return { head, relation: 'required_ancestor' }
}

function expectedAdditionalPaths() {
  return [
    'README.md',
    'compatibility/baselines/0.1.0.json',
    'contracts/sources.lock.json',
    'package-lock.json',
    'package.json',
  ]
}

export function verifyActivationRecords({
  activation,
  activationBytes,
  activationPath,
  currentManifest,
  precursorManifestBytes,
  currentBytes,
  candidateBytes,
}) {
  const candidateRevision = requireFullCommitSha(
    activation.candidate_content_revision,
    'candidate content revision',
  )
  assert.equal(activation.activation_version, 1)
  assert.equal(activation.state, 'candidate_content_revision_recorded')
  assert.equal(activation.commit_binding, 'activated_by_containing_commit')
  assert.deepEqual(activation.additional_attributed_paths, expectedAdditionalPaths())
  assert.equal(
    sha256(precursorManifestBytes),
    activation.precursor_candidate_manifest.sha256,
    'precursor candidate-manifest digest',
  )
  const precursorManifest = JSON.parse(precursorManifestBytes.toString('utf8'))
  assert.equal(precursorManifest.sudostack.candidate_revision, null)
  assert.equal(precursorManifest.sudostack.activation_state, 'pending_future_commit')
  assert.equal(currentManifest.sudostack.candidate_revision, candidateRevision)
  assert.equal(currentManifest.sudostack.activation_state, activation.state)
  assert.equal(currentManifest.sudostack.activation.commit_binding, activation.commit_binding)
  if (activationBytes && activationPath) {
    assert.equal(currentManifest.sudostack.activation.metadata_path, activationPath)
    assert.equal(currentManifest.sudostack.activation.metadata_sha256, sha256(activationBytes))
  }
  assert.deepEqual(
    currentManifest.sudostack.activation.precursor_candidate_manifest,
    activation.precursor_candidate_manifest,
  )
  for (const [key, value] of Object.entries(activation.lifecycle_constraints)) {
    if (key === 'actual_producers' || key === 'actual_consumers') {
      assert.deepEqual(currentManifest.package[key], value, key)
    } else {
      assert.equal(currentManifest.lifecycle[key], value, key)
    }
  }
  for (const key of [
    'lifecycle',
    'owners',
    'package',
    'fixtures',
    'compatibility',
    'source_availability',
    'deferred',
  ]) {
    assert.deepEqual(currentManifest[key], precursorManifest[key], `${key} changed during activation`)
  }
  assert.equal(currentManifest.manifest_version, precursorManifest.manifest_version)
  assert.equal(currentManifest.sudostack.g0_revision, precursorManifest.sudostack.g0_revision)
  assert.deepEqual(
    currentManifest.sudostack.assembly_source_lock,
    precursorManifest.sudostack.assembly_source_lock,
  )
  for (const key of [
    'source_loader',
    'runtime_template',
    'compatibility_checker',
    'baseline_verifier',
    'node_version_gate',
    'node',
    'runtime_validator',
    'raw_json_parser',
    'typescript_checker',
  ]) {
    assert.deepEqual(currentManifest.toolchain[key], precursorManifest.toolchain[key], `${key} changed`)
  }
  assert.deepEqual(currentManifest.generated_artifacts, precursorManifest.generated_artifacts)
  assert.deepEqual(
    currentManifest.internal_generation_artifacts,
    precursorManifest.internal_generation_artifacts,
  )

  const attributed = new Set([
    ...precursorManifest.generated_artifacts.map((artifact) => artifact.path),
    ...precursorManifest.internal_generation_artifacts.map((artifact) => artifact.path),
    ...activation.additional_attributed_paths,
  ])
  const precursorDigests = new Map(
    [...precursorManifest.generated_artifacts, ...precursorManifest.internal_generation_artifacts]
      .map((artifact) => [artifact.path, artifact.sha256]),
  )
  for (const path of attributed) {
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`unsafe attributed path: ${path}`)
    }
    const fromCommit = candidateBytes(path)
    const current = currentBytes(path)
    assert.deepEqual(current, fromCommit, `${path} differs from candidate content revision`)
    const recordedDigest = precursorDigests.get(path)
    if (recordedDigest) assert.equal(sha256(fromCommit), recordedDigest, path)
  }
  assert.equal(
    sha256(candidateBytes('package.json')),
    precursorManifest.package.package_json_sha256,
  )
  assert.equal(
    sha256(candidateBytes('package-lock.json')),
    precursorManifest.package.package_lock_sha256,
  )
  assert.equal(
    sha256(candidateBytes('contracts/sources.lock.json')),
    precursorManifest.sudostack.assembly_source_lock.sha256,
  )
  assert.equal(
    sha256(candidateBytes(precursorManifest.compatibility.prior_baseline_path)),
    precursorManifest.compatibility.prior_baseline_sha256,
  )
  return {
    candidateRevision,
    attributedPathCount: attributed.size,
    precursorManifest,
  }
}

export function assertNoActivationSelfReference({ head, candidateRevision, text }) {
  if (head !== candidateRevision) {
    assert.equal(text.includes(head), false, 'activation metadata must not embed its containing commit SHA')
  }
}

export function verifyActivation({
  repository = REPO,
  activationPath = 'manifests/activations/0.2.0-candidate.json',
} = {}) {
  const activationBytes = readFileSync(join(repository, activationPath))
  const activation = JSON.parse(activationBytes.toString('utf8'))
  const candidateRevision = requireFullCommitSha(
    activation.candidate_content_revision,
    'candidate content revision',
  )
  const manifestPath = activation.precursor_candidate_manifest.path
  const precursorManifestBytes = readCommitBlob(repository, candidateRevision, manifestPath)
  const currentManifest = JSON.parse(readFileSync(join(repository, manifestPath), 'utf8'))
  const result = verifyActivationRecords({
    activation,
    activationBytes,
    activationPath,
    currentManifest,
    precursorManifestBytes,
    currentBytes: (path) => readFileSync(join(repository, path)),
    candidateBytes: (path) => readCommitBlob(repository, candidateRevision, path),
  })
  const relation = relationToHead(repository, candidateRevision)
  assertNoActivationSelfReference({
    head: relation.head,
    candidateRevision,
    text: `${activationBytes.toString('utf8')}\n${JSON.stringify(currentManifest)}`,
  })
  return { ...result, ...relation }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = verifyActivation()
  console.log(
    `activation verified: ${result.candidateRevision}, ${result.attributedPathCount} attributed paths, ${result.relation}`,
  )
}
