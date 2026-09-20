#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BASELINE_PATH,
  CANDIDATE_PATH,
  CANDIDATE_VERSION,
  HISTORICAL_CANDIDATE_PATH,
  STAGE_PATH,
  verifyCandidateContent,
} from './content-candidate.mjs'
import { verifyHistoricalRelease } from './history-0.2.0.mjs'
import { loadSourceLock } from './source.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(REPO, path))
const readJson = (path) => JSON.parse(read(path).toString('utf8'))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const sourceLock = loadSourceLock()
const manifestBytes = read(CANDIDATE_PATH)
const manifestText = manifestBytes.toString('utf8')
const manifest = JSON.parse(manifestText)
const compatibility = readJson('compatibility/current.gen.json')
const { baseline, stage } = verifyCandidateContent({ repository: REPO })
const expectedGeneratedPaths = baseline.packed_files
  .map(({ path }) => path)
  .filter((path) => !['README.md', 'package.json', HISTORICAL_CANDIDATE_PATH].includes(path))
  .sort()
const expectedInternalPaths = baseline.protected_files
  .filter(({ purpose }) => purpose === 'internal_generation_artifact')
  .map(({ path }) => path)
  .sort()

assert.equal(packageJson.version, CANDIDATE_VERSION)
assert.equal(manifest.manifest_version, 2)
assert.deepEqual(Object.keys(manifest).sort(), [
  'choreography',
  'compatibility',
  'deferred',
  'fixtures',
  'generated_artifacts',
  'internal_generation_artifacts',
  'lifecycle',
  'manifest_version',
  'owners',
  'package',
  'source_availability',
  'sudostack',
  'support_evidence',
  'toolchain',
])
assert.deepEqual(manifest.lifecycle, stage.lifecycle)
assert.equal(manifest.lifecycle.content_stage, 'staged')
assert.equal(manifest.lifecycle.contract_baseline, 'unfrozen')
assert.equal(manifest.lifecycle.artifact_publication, 'candidate_unpublished')
assert.equal(manifest.lifecycle.deployment_evidence, 'not_deployed')
assert.equal(manifest.sudostack.candidate_revision, null)
assert.deepEqual(Object.keys(manifest.sudostack).sort(), [
  'activation_state',
  'assembly_source_lock',
  'candidate_revision',
  'content_stage',
  'g0_revision',
  'predecessor',
])
assert.equal(manifest.sudostack.activation_state, 'pending_future_commit')
assert.equal(manifest.sudostack.g0_revision, sourceLock.sudostack_g0_revision)
assert.deepEqual(manifest.sudostack.content_stage, {
  state: stage.lifecycle.content_stage,
  metadata_path: STAGE_PATH,
  metadata_sha256: sha256(read(STAGE_PATH)),
  exact_pin_target: stage.content_identity.exact_pin_target,
  revision_source: stage.content_identity.revision_source,
})
assert.deepEqual(manifest.sudostack.assembly_source_lock, {
  path: 'contracts/sources.lock.json',
  sha256: sha256(read('contracts/sources.lock.json')),
})
assert.deepEqual(manifest.sudostack.predecessor, {
  package_version: stage.package.previous_version,
  baseline_path: BASELINE_PATH,
  baseline_sha256: sha256(read(BASELINE_PATH)),
  baseline_source_revision: baseline.source_revision,
  candidate_content_revision: stage.historical_0_2_0.candidate_content_revision,
  activation_revision: stage.historical_0_2_0.activation_revision,
  source_availability_revision: stage.historical_0_2_0.source_availability_revision,
  support_evidence_revision: stage.historical_0_2_0.support_evidence_revision,
})
assert.deepEqual(manifest.package, {
  name: packageJson.name,
  version: packageJson.version,
  private: packageJson.private,
  package_json_sha256: sha256(read('package.json')),
  package_lock_sha256: sha256(read('package-lock.json')),
  actual_producers: [],
  actual_consumers: [],
  support_state: 'pending_moss_repin',
})
assert.deepEqual(manifest.support_evidence, {
  current_candidate: 'none_pending_moss_repin',
  prior_version: stage.package.previous_version,
  prior_operation_path: stage.historical_0_2_0.support_operation_path,
  prior_classification: stage.historical_0_2_0.support_classification,
})
assert.deepEqual(manifest.choreography, stage.choreography)
assert.deepEqual(manifest.deferred, [
  'Moss 0.2.1 exact-pin and production-boundary evidence',
  'C-03 decision until package-external activation A binds C and M',
  'runtime writer and canonical runtime store changes',
  'ResourceRef authorization and routing resolver',
  'runtime ZonePath adoption',
  'artifact release and remote publication',
  'deployment and migration',
  'unrequested language packages',
])
assert.equal(manifest.package.private, true)
assert.deepEqual(manifest.source_availability, sourceLock.source_availability)
assert.deepEqual(manifest.compatibility, {
  prior_baseline_path: BASELINE_PATH,
  prior_baseline_sha256: sha256(read(BASELINE_PATH)),
  runtime_contract: 'byte_identical',
  zone_id: 'compatible_behavior',
  resource_ref: 'byte_identical_behavior',
})

assert.deepEqual(compatibility, {
  compatibility_version: 2,
  package: {
    previous: stage.package.previous_version,
    candidate: stage.package.candidate_version,
    semver_change: 'patch',
  },
  baseline: {
    path: BASELINE_PATH,
    sha256: sha256(read(BASELINE_PATH)),
    source_revision: baseline.source_revision,
    runtime_contract: 'byte_identical',
  },
  families: {
    zone_id: {
      state: 'compatible_behavior',
      previous_owner_revision: sourceLock.repositories['nexus-vfs'].revision,
      current_owner_revision: sourceLock.repositories['nexus-vfs'].revision,
      repository_revision_skew: false,
      owner_spec_digest_changed: false,
      lexical_rule_data_equal: true,
      runtime_bytes: 'byte_identical_to_0.2.0',
      evidence: ['immutable 0.2.0 package baseline', '12 exact owner vectors'],
    },
    resource_ref: {
      state: 'byte_identical_behavior',
      backward_compatibility_claim: false,
      owner_revision: sourceLock.repositories.nexus.definition_revision,
      provenance_revision: sourceLock.repositories.nexus.revision,
      semantic_uncertainty: 'unchanged_manual_review',
      runtime_bytes: 'byte_identical_to_0.2.0',
      adoption_claim: 'none',
    },
  },
  support_matrix: {
    actual_producers: [],
    actual_consumers: [],
    state: stage.support.state,
    prior_evidence: {
      package_version: stage.package.previous_version,
      operation_path: stage.historical_0_2_0.support_operation_path,
      classification: stage.historical_0_2_0.support_classification,
    },
    note: 'The 0.2.1 candidate remains unfrozen until Moss exact-pins content commit C and later package-external activation A verifies C and M.',
  },
})

for (const forbidden of ['WORKTREE', '/Volumes/', 'released', 'deployed_at', 'created_at']) {
  assert.equal(manifestText.includes(forbidden), false, `candidate manifest contains ${forbidden}`)
}
assert.equal(
  manifest.generated_artifacts.some((artifact) => artifact.path === CANDIDATE_PATH),
  false,
  'candidate manifest must not hash itself',
)
assert.equal(
  manifest.generated_artifacts.some((artifact) => artifact.path === HISTORICAL_CANDIDATE_PATH),
  false,
  'historical candidate is immutable metadata, not a regenerated 0.2.1 artifact',
)

assert.deepEqual(
  manifest.generated_artifacts.map(({ path }) => path).sort(),
  expectedGeneratedPaths,
  'candidate generated artifact inventory is incomplete or contains extras',
)
assert.deepEqual(
  manifest.internal_generation_artifacts.map(({ path }) => path).sort(),
  expectedInternalPaths,
  'candidate internal artifact inventory is incomplete or contains extras',
)
for (const artifact of [
  ...manifest.generated_artifacts,
  ...manifest.internal_generation_artifacts,
]) {
  assert.equal(sha256(read(artifact.path)), artifact.sha256, artifact.path)
}
assert.equal(sha256(read('package.json')), manifest.package.package_json_sha256)
assert.equal(sha256(read('package-lock.json')), manifest.package.package_lock_sha256)
assert.equal(manifest.package.name, packageJson.name)
assert.equal(manifest.package.version, packageJson.version)
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
assert.deepEqual(Object.keys(manifest.toolchain).sort(), [
  'baseline_verifier',
  'candidate_verifier',
  'compatibility_checker',
  'content_candidate_verifier',
  'generator',
  'historical_activation_verifier',
  'historical_availability_verifier',
  'historical_release_verifier',
  'historical_support_verifier',
  'node',
  'node_version_gate',
  'npm_runner',
  'raw_json_parser',
  'runtime_template',
  'runtime_validator',
  'source_loader',
  'typescript_checker',
])
const expectedToolPaths = {
  generator: 'contracts/generate.mjs',
  candidate_verifier: 'tools/contracts/verify-candidate.mjs',
  content_candidate_verifier: 'tools/contracts/content-candidate.mjs',
  historical_release_verifier: 'tools/contracts/history-0.2.0.mjs',
  npm_runner: 'tools/contracts/npm-runner.mjs',
  source_loader: 'tools/contracts/source.mjs',
  runtime_template: 'tools/contracts/runtime-template.mjs',
  compatibility_checker: 'tools/contracts/compatibility.mjs',
  baseline_verifier: 'tools/contracts/baseline.mjs',
  node_version_gate: 'tools/contracts/node-version.mjs',
  historical_activation_verifier: 'tools/contracts/activation.mjs',
  historical_availability_verifier: 'tools/contracts/availability.mjs',
  historical_support_verifier: 'tools/contracts/support.mjs',
}
assert.equal(manifest.toolchain.generator.id, 'contracts/generate.mjs@2')
for (const [name, path] of Object.entries(expectedToolPaths)) {
  assert.equal(manifest.toolchain[name].path, path, `tool path changed: ${name}`)
}
for (const tool of [
  manifest.toolchain.generator,
  manifest.toolchain.candidate_verifier,
  manifest.toolchain.content_candidate_verifier,
  manifest.toolchain.historical_release_verifier,
  manifest.toolchain.npm_runner,
  manifest.toolchain.source_loader,
  manifest.toolchain.runtime_template,
  manifest.toolchain.compatibility_checker,
  manifest.toolchain.baseline_verifier,
  manifest.toolchain.node_version_gate,
  manifest.toolchain.historical_activation_verifier,
  manifest.toolchain.historical_availability_verifier,
  manifest.toolchain.historical_support_verifier,
]) {
  assert.equal(sha256(read(tool.path)), tool.sha256, tool.path)
}
assert.deepEqual(manifest.fixtures, {
  resource_ref: 25,
  zone_id: 12,
  zone_path: 23,
  aggregate_index_sha256: sha256(read('contracts/common/v1/resource-ref/fixture-index.gen.json')),
})

assert.deepEqual(manifest.owners.nexus, {
  provenance_revision: sourceLock.repositories.nexus.revision,
  definition_revision: sourceLock.repositories.nexus.definition_revision,
  definition_revision_verification:
    'schema_source_lock_and_fixtures_byte_identical_to_provenance_revision',
  schema_path: sourceLock.repositories.nexus.files.schema.path,
  schema_sha256: sourceLock.repositories.nexus.files.schema.sha256,
  manifest_path: sourceLock.repositories.nexus.files.manifest.path,
  manifest_sha256: sourceLock.repositories.nexus.files.manifest.sha256,
  source_lock_path: sourceLock.repositories.nexus.files.source_lock.path,
  source_lock_sha256: sourceLock.repositories.nexus.files.source_lock.sha256,
})
assert.deepEqual(manifest.owners['nexus-vfs'], {
  revision: sourceLock.repositories['nexus-vfs'].revision,
  files: sourceLock.repositories['nexus-vfs'].files,
})

const closure = readJson('manifests/source-closure.gen.json')
assert.equal(closure.repositories.nexus.revision, manifest.owners.nexus.provenance_revision)
assert.equal(closure.repositories.nexus.definition_revision, manifest.owners.nexus.definition_revision)
assert.equal(closure.repositories['nexus-vfs'].revision, manifest.owners['nexus-vfs'].revision)
assert.deepEqual(closure.owner_manifest.actual_consumers, [])
assert.equal(closure.owner_manifest.lifecycle.artifact_publication, 'unpublished')

const historical = verifyHistoricalRelease({
  repository: process.env.SUDOSTACK_BASE_REPO ?? REPO,
  baseline,
})
console.log(
  `staged candidate verified: ${manifest.generated_artifacts.length} distribution artifacts, ` +
    `${manifest.internal_generation_artifacts.length} internal artifacts, ` +
    `${manifest.fixtures.resource_ref + manifest.fixtures.zone_id + manifest.fixtures.zone_path} fixtures; ` +
    `candidate revision pending at content commit C; runtime bytes identical to ${baseline.package.version}; ` +
    `historical ${historical.package.fileCount}-file package ${historical.package.sha256}`,
)
