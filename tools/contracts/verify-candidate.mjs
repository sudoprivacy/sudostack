#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyActivation } from './activation.mjs'
import { verifyAvailability } from './availability.mjs'
import { verifyCompatibilityBaseline } from './baseline.mjs'
import { loadSourceLock } from './source.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(REPO, path))
const readJson = (path) => JSON.parse(read(path).toString('utf8'))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

const packageJson = readJson('package.json')
const sourceLock = loadSourceLock()
verifyCompatibilityBaseline({ sourceLock, verifyOwnerObject: false })
const manifestPath = `manifests/releases/${packageJson.version}-candidate.gen.json`
const manifestBytes = read(manifestPath)
const manifestText = manifestBytes.toString('utf8')
const manifest = JSON.parse(manifestText)
const activation = readJson(`manifests/activations/${packageJson.version}-candidate.json`)

assert.equal(manifest.lifecycle.adr_maturity, 'proposed')
assert.equal(manifest.lifecycle.contract_baseline, 'draft-frozen')
assert.equal(manifest.lifecycle.artifact_publication, 'candidate_unpublished')
assert.equal(manifest.lifecycle.deployment_evidence, 'not_deployed')
assert.equal(manifest.sudostack.candidate_revision, activation.candidate_content_revision)
assert.equal(manifest.sudostack.activation_state, activation.state)
assert.equal(
  sha256(read(manifest.sudostack.assembly_source_lock.path)),
  manifest.sudostack.assembly_source_lock.sha256,
)
assert.deepEqual(manifest.package.actual_producers, [])
assert.deepEqual(manifest.package.actual_consumers, [])
assert.equal(manifest.package.private, true)
assert.deepEqual(manifest.source_availability, readJson('contracts/sources.lock.json').source_availability)
assert.equal(manifest.compatibility.resource_ref, 'initial_baseline_no_backward_compatibility_claim')
assert.equal(manifest.compatibility.zone_id, 'compatible_behavior')
assert.equal(
  sha256(read(manifest.compatibility.prior_baseline_path)),
  manifest.compatibility.prior_baseline_sha256,
)

for (const forbidden of ['WORKTREE', '/Volumes/', 'released', 'deployed_at', 'created_at']) {
  assert.equal(manifestText.includes(forbidden), false, `candidate manifest contains ${forbidden}`)
}
assert.equal(
  manifest.generated_artifacts.some((artifact) => artifact.path === manifestPath),
  false,
  'candidate manifest must not hash itself',
)

for (const artifact of [
  ...manifest.generated_artifacts,
  ...manifest.internal_generation_artifacts,
]) {
  assert.equal(sha256(read(artifact.path)), artifact.sha256, artifact.path)
}
assert.equal(sha256(read('package.json')), manifest.package.package_json_sha256)
assert.equal(sha256(read('package-lock.json')), manifest.package.package_lock_sha256)
const packageLock = readJson('package-lock.json')
assert.equal(manifest.package.name, packageJson.name)
assert.equal(manifest.package.version, packageJson.version)
assert.equal(manifest.package.private, packageJson.private)
assert.equal(packageLock.packages[''].name, packageJson.name)
assert.equal(packageLock.packages[''].version, packageJson.version)
assert.equal(packageLock.packages[''].engines.node, packageJson.engines.node)
assert.equal(packageLock.packages[''].dependencies.ajv, packageJson.dependencies.ajv)
assert.equal(
  packageLock.packages[''].dependencies['jsonc-parser'],
  packageJson.dependencies['jsonc-parser'],
)
assert.equal(
  packageLock.packages[''].devDependencies.typescript,
  packageJson.devDependencies.typescript,
)
assert.equal(manifest.toolchain.node, packageJson.engines.node)
assert.equal(manifest.toolchain.runtime_validator, `ajv@${packageJson.dependencies.ajv}`)
assert.equal(
  manifest.toolchain.raw_json_parser,
  `jsonc-parser@${packageJson.dependencies['jsonc-parser']}`,
)
assert.equal(
  manifest.toolchain.typescript_checker,
  `typescript@${packageJson.devDependencies.typescript}`,
)
for (const tool of [
  manifest.toolchain.generator,
  manifest.toolchain.source_loader,
  manifest.toolchain.runtime_template,
  manifest.toolchain.compatibility_checker,
  manifest.toolchain.baseline_verifier,
  manifest.toolchain.node_version_gate,
  manifest.toolchain.activation_verifier,
  manifest.toolchain.availability_verifier,
]) {
  assert.equal(sha256(read(tool.path)), tool.sha256, tool.path)
}
assert.equal(
  sha256(read('contracts/common/v1/resource-ref/fixture-index.gen.json')),
  manifest.fixtures.aggregate_index_sha256,
)
assert.deepEqual(
  {
    resource_ref: manifest.fixtures.resource_ref,
    zone_id: manifest.fixtures.zone_id,
    zone_path: manifest.fixtures.zone_path,
  },
  { resource_ref: 25, zone_id: 12, zone_path: 23 },
)

const closure = readJson('manifests/source-closure.gen.json')
assert.equal(closure.repositories.nexus.revision, manifest.owners.nexus.provenance_revision)
assert.equal(closure.repositories.nexus.definition_revision, manifest.owners.nexus.definition_revision)
assert.equal(closure.repositories['nexus-vfs'].revision, manifest.owners['nexus-vfs'].revision)
assert.deepEqual(closure.owner_manifest.actual_consumers, [])
assert.equal(closure.owner_manifest.lifecycle.artifact_publication, 'unpublished')

const availabilityResult = verifyAvailability({ repository: REPO })
const activationResult = verifyActivation({ repository: REPO })

console.log(
  `candidate manifest verified: ${manifest.generated_artifacts.length} distribution artifacts, ` +
    `${manifest.internal_generation_artifacts.length} internal artifacts, ` +
    `${manifest.fixtures.resource_ref + manifest.fixtures.zone_id + manifest.fixtures.zone_path} fixtures; ` +
    `candidate ${activationResult.candidateRevision} (${activationResult.relation}); ` +
    `sources ${availabilityResult.relation}`,
)
