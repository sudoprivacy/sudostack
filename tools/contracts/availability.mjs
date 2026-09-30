import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { requireFullCommitSha, sha256 } from './source.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')
export const OPERATION_PATH = 'manifests/operations/source-availability.json'
export const SOURCE_LOCK_PATH = 'contracts/sources.lock.json'
export const SOURCE_CLOSURE_PATH = 'manifests/source-closure.gen.json'

const VERIFIED_AVAILABILITY_PROOFS = new WeakSet()

function verifiedAvailabilityProof(values) {
  const proof = Object.freeze(values)
  VERIFIED_AVAILABILITY_PROOFS.add(proof)
  return proof
}

export function requireVerifiedAvailabilityProof(proof) {
  assert.ok(
    proof && typeof proof === 'object' && VERIFIED_AVAILABILITY_PROOFS.has(proof),
    'operational override requires strict availability proof',
  )
  return proof
}

function readActivationBlob(repository, revision, path) {
  requireFullCommitSha(revision, 'activation revision')
  try {
    execFileSync('git', ['-C', repository, 'cat-file', '-e', `${revision}^{commit}`], {
      stdio: 'ignore',
    })
    return execFileSync('git', ['-C', repository, 'show', `${revision}:${path}`], {
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim() || error.message
    throw new Error(`cannot read activation baseline ${revision}:${path}: ${detail}`)
  }
}

const EXPECTED_AVAILABILITY_POINTERS = [
  '/source_availability/reason',
  '/source_availability/remote',
]

const escapePointer = (value) => String(value).replaceAll('~', '~0').replaceAll('/', '~1')

export function jsonDiffPointers(previous, current, path = '') {
  if (isDeepStrictEqual(previous, current)) return []
  if (
    previous === null ||
    current === null ||
    typeof previous !== 'object' ||
    typeof current !== 'object' ||
    Array.isArray(previous) !== Array.isArray(current)
  ) {
    return [path || '']
  }
  if (Array.isArray(previous)) {
    if (previous.length !== current.length) return [path || '']
    return previous.flatMap((value, index) =>
      jsonDiffPointers(value, current[index], `${path}/${index}`),
    )
  }
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  return [...keys].flatMap((key) => {
    if (Object.hasOwn(previous, key) !== Object.hasOwn(current, key)) {
      return [`${path}/${escapePointer(key)}`]
    }
    return jsonDiffPointers(previous[key], current[key], `${path}/${escapePointer(key)}`)
  })
}

function assertExactPointers(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label)
}

function mapArtifacts(manifest) {
  return new Map(
    [...manifest.generated_artifacts, ...manifest.internal_generation_artifacts]
      .map((artifact) => [artifact.path, artifact.sha256]),
  )
}

function relationToHead(repository, revision) {
  const head = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  if (head === revision) return { head, relation: 'activation_head_before_availability_commit' }
  execFileSync('git', ['-C', repository, 'merge-base', '--is-ancestor', revision, head], {
    stdio: 'ignore',
  })
  const parent = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD^'], {
    encoding: 'utf8',
  }).trim()
  return { head, relation: parent === revision ? 'immediate_parent' : 'required_ancestor' }
}

export function verifyAvailabilityRecords({
  operation,
  previousSourceLockBytes,
  previousSourceClosureBytes,
  previousCandidateManifestBytes,
  currentSourceLockBytes,
  currentSourceClosureBytes,
  currentCandidateManifest,
  operationBytes,
  currentToolBytes,
}) {
  const candidateRevision = requireFullCommitSha(
    operation.candidate_content_revision,
    'candidate content revision',
  )
  const activationRevision = requireFullCommitSha(
    operation.activation_revision,
    'activation revision',
  )
  assert.equal(operation.override_version, 1)
  assert.equal(operation.state, 'owner_sources_remotely_available')
  assert.equal(sha256(previousSourceLockBytes), operation.previous.source_lock_sha256)
  assert.equal(sha256(previousSourceClosureBytes), operation.previous.source_closure_sha256)
  assert.equal(
    sha256(previousCandidateManifestBytes),
    operation.previous.candidate_manifest_sha256,
  )

  const previousSourceLock = JSON.parse(previousSourceLockBytes.toString('utf8'))
  const previousSourceClosure = JSON.parse(previousSourceClosureBytes.toString('utf8'))
  const previousCandidateManifest = JSON.parse(previousCandidateManifestBytes.toString('utf8'))
  const currentSourceLock = JSON.parse(currentSourceLockBytes.toString('utf8'))
  const currentSourceClosure = JSON.parse(currentSourceClosureBytes.toString('utf8'))

  assert.equal(
    candidateRevision,
    previousCandidateManifest.sudostack.candidate_revision,
    'operation candidate content revision does not match activation-era candidate manifest',
  )
  assert.equal(
    candidateRevision,
    currentCandidateManifest.sudostack.candidate_revision,
    'operation candidate content revision does not match current candidate manifest',
  )

  assert.deepEqual(operation.previous.source_availability, previousSourceLock.source_availability)
  assert.deepEqual(operation.current.source_availability, currentSourceLock.source_availability)
  assert.equal(currentSourceLock.source_availability.remote, 'available')
  assertExactPointers(
    jsonDiffPointers(previousSourceLock, currentSourceLock),
    EXPECTED_AVAILABILITY_POINTERS,
    'source lock changed outside source_availability override',
  )
  assertExactPointers(
    jsonDiffPointers(previousSourceClosure, currentSourceClosure),
    EXPECTED_AVAILABILITY_POINTERS,
    'source closure changed outside source_availability override',
  )

  for (const key of [
    'manifest_version',
    'lifecycle',
    'owners',
    'package',
    'fixtures',
    'compatibility',
    'deferred',
    'internal_generation_artifacts',
  ]) {
    assert.deepEqual(
      currentCandidateManifest[key],
      previousCandidateManifest[key],
      `${key} changed during source availability transition`,
    )
  }
  assert.equal(currentCandidateManifest.sudostack.g0_revision, previousCandidateManifest.sudostack.g0_revision)
  assert.equal(
    currentCandidateManifest.sudostack.candidate_revision,
    previousCandidateManifest.sudostack.candidate_revision,
  )
  assert.equal(
    currentCandidateManifest.sudostack.activation_state,
    previousCandidateManifest.sudostack.activation_state,
  )
  assert.deepEqual(
    currentCandidateManifest.sudostack.activation,
    previousCandidateManifest.sudostack.activation,
  )
  assert.equal(
    currentCandidateManifest.sudostack.assembly_source_lock.path,
    previousCandidateManifest.sudostack.assembly_source_lock.path,
  )
  assert.equal(
    currentCandidateManifest.sudostack.assembly_source_lock.sha256,
    sha256(currentSourceLockBytes),
  )
  assert.deepEqual(
    currentCandidateManifest.source_availability,
    operation.current.source_availability,
  )

  const previousArtifacts = mapArtifacts(previousCandidateManifest)
  const currentArtifacts = mapArtifacts(currentCandidateManifest)
  assert.deepEqual([...currentArtifacts.keys()], [...previousArtifacts.keys()])
  for (const [path, digest] of previousArtifacts) {
    if (path === SOURCE_CLOSURE_PATH) {
      assert.equal(currentArtifacts.get(path), sha256(currentSourceClosureBytes))
    } else {
      assert.equal(currentArtifacts.get(path), digest, `${path} changed during availability transition`)
    }
  }

  const override = currentCandidateManifest.sudostack.source_availability_override
  assert.equal(override.state, operation.state)
  assert.equal(override.metadata_path, OPERATION_PATH)
  assert.equal(override.metadata_sha256, sha256(operationBytes))
  assert.equal(override.activation_revision, activationRevision)
  assert.equal(override.previous_candidate_manifest_sha256, operation.previous.candidate_manifest_sha256)
  assert.equal(override.source_lock_sha256, sha256(currentSourceLockBytes))
  assert.equal(override.source_closure_sha256, sha256(currentSourceClosureBytes))

  const allowedToolChanges = new Set(['generator', 'activation_verifier', 'availability_verifier'])
  for (const [key, value] of Object.entries(previousCandidateManifest.toolchain)) {
    if (allowedToolChanges.has(key)) continue
    assert.deepEqual(currentCandidateManifest.toolchain[key], value, `${key} changed`)
  }
  assert.equal(
    currentCandidateManifest.toolchain.availability_verifier.sha256,
    sha256(currentToolBytes),
  )

  const vfsEvidence = operation.published_owner_evidence['nexus-vfs']
  const nexusEvidence = operation.published_owner_evidence.nexus
  assert.equal(vfsEvidence.revision, currentSourceLock.repositories['nexus-vfs'].revision)
  assert.equal(
    vfsEvidence.probe_sha256,
    currentSourceLock.repositories['nexus-vfs'].files.zone_id_spec.sha256,
  )
  assert.equal(nexusEvidence.definition_revision, currentSourceLock.repositories.nexus.definition_revision)
  assert.equal(nexusEvidence.provenance_revision, currentSourceLock.repositories.nexus.revision)
  assert.equal(nexusEvidence.probe_sha256, currentSourceLock.repositories.nexus.files.schema.sha256)

  return verifiedAvailabilityProof({
    candidateRevision,
    activationRevision,
    sourceAvailability: Object.freeze(structuredClone(operation.current.source_availability)),
    sourceLockSha256: sha256(currentSourceLockBytes),
    sourceClosureSha256: sha256(currentSourceClosureBytes),
  })
}

export function verifyAvailability({ repository = REPO, operationPath = OPERATION_PATH } = {}) {
  const operationBytes = readFileSync(join(repository, operationPath))
  const operation = JSON.parse(operationBytes.toString('utf8'))
  const activationRevision = requireFullCommitSha(operation.activation_revision, 'activation revision')
  const result = verifyAvailabilityRecords({
    operation,
    previousSourceLockBytes: readActivationBlob(repository, activationRevision, SOURCE_LOCK_PATH),
    previousSourceClosureBytes: readActivationBlob(repository, activationRevision, SOURCE_CLOSURE_PATH),
    previousCandidateManifestBytes: readActivationBlob(
      repository,
      activationRevision,
      'manifests/releases/0.2.0-candidate.gen.json',
    ),
    currentSourceLockBytes: readFileSync(join(repository, SOURCE_LOCK_PATH)),
    currentSourceClosureBytes: readFileSync(join(repository, SOURCE_CLOSURE_PATH)),
    currentCandidateManifest: JSON.parse(
      readFileSync(join(repository, 'manifests/releases/0.2.0-candidate.gen.json'), 'utf8'),
    ),
    operationBytes,
    currentToolBytes: readFileSync(join(repository, 'tools/contracts/availability.mjs')),
  })
  const relation = relationToHead(repository, activationRevision)
  if (relation.head !== activationRevision) {
    const text = `${operationBytes.toString('utf8')}\n${JSON.stringify(
      JSON.parse(readFileSync(join(repository, 'manifests/releases/0.2.0-candidate.gen.json'), 'utf8')),
    )}`
    assert.equal(text.includes(relation.head), false, 'availability metadata must not embed its containing commit SHA')
  }
  return verifiedAvailabilityProof({ ...result, ...relation })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = verifyAvailability()
  console.log(
    `source availability verified: ${result.activationRevision}, ${result.relation}, ` +
      `lock ${result.sourceLockSha256}, closure ${result.sourceClosureSha256}`,
  )
}
