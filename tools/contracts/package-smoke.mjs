#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CANDIDATE_PATH,
  HISTORICAL_CANDIDATE_PATH,
  expectedCurrentPackedPaths,
  sha256,
  verifyCandidateContent,
} from './content-candidate.mjs'
import { verifyHistoricalPackage } from './history-0.2.0.mjs'
import { requireSupportedNode } from './node-version.mjs'
import { runNpm } from './npm-runner.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKAGE = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
requireSupportedNode(process.versions.node, PACKAGE.engines.node)
const runPackageNpm = (args, options = {}) => runNpm(args, { cwd: options.cwd ?? REPO })

const { baseline } = verifyCandidateContent({ repository: REPO })
const historicalPackage = verifyHistoricalPackage({ repository: REPO, baseline })
const dryRun = JSON.parse(runPackageNpm(['pack', '--dry-run', '--json', '--ignore-scripts']))[0]
const packedPaths = new Set(dryRun.files.map((entry) => entry.path))
const expected = expectedCurrentPackedPaths(baseline)
assert.deepEqual([...packedPaths].sort(), [...expected].sort(), '0.2.1 packed path delta is not exact')

const candidate = JSON.parse(readFileSync(join(REPO, CANDIDATE_PATH), 'utf8'))
const packageMetadataPaths = new Set([
  'package.json',
  'README.md',
  HISTORICAL_CANDIDATE_PATH,
  CANDIDATE_PATH,
])
const packedDistributionPaths = [...packedPaths]
  .filter((path) => !packageMetadataPaths.has(path))
  .sort()
assert.deepEqual(
  packedDistributionPaths,
  candidate.generated_artifacts.map((artifact) => artifact.path).sort(),
)
for (const artifact of candidate.internal_generation_artifacts) {
  assert.equal(packedPaths.has(artifact.path), false, `package contains internal ${artifact.path}`)
}

const allowedChanged = new Set(baseline.successor_policy.changed_packed_paths)
const changed = []
for (const entry of baseline.packed_files) {
  const currentDigest = sha256(readFileSync(join(REPO, entry.path)))
  if (currentDigest === entry.sha256) continue
  changed.push(entry.path)
  assert.ok(allowedChanged.has(entry.path), `unexpected packed byte delta: ${entry.path}`)
}
assert.deepEqual(changed.sort(), [...allowedChanged].sort(), 'expected packed metadata deltas are missing')
assert.deepEqual(
  baseline.successor_policy.added_packed_paths,
  [CANDIDATE_PATH],
  'the staged candidate must be the only added packed path',
)

const forbidden = [
  /^tools\//,
  /(?:^|\/)sources\.lock\.json$/,
  /spec\.source\.gen\.json$/,
  /validator-lock\.source\.gen\.json$/,
  /owner-source-lock\.source\.gen\.json$/,
  /\.test\.mjs$/,
  /resource-ref\.gen\.ts$/,
  /zone-id\.gen\.ts$/,
  /^compatibility\/baselines\//,
  /^manifests\/candidates\//,
]
for (const path of packedPaths) {
  assert.equal(forbidden.some((pattern) => pattern.test(path)), false, path)
}

const temporary = mkdtempSync(join(tmpdir(), 'sudo-contracts-smoke-'))
process.on('exit', () => rmSync(temporary, { recursive: true, force: true }))
const packDestinations = [join(temporary, 'pack-a'), join(temporary, 'pack-b')]
for (const destination of packDestinations) mkdirSync(destination)
const packResults = packDestinations.map((destination) =>
  JSON.parse(runPackageNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination]))[0],
)
for (const result of packResults) {
  assert.deepEqual(new Set(result.files.map((entry) => entry.path)), packedPaths)
}
const tarballs = packResults.map((result, index) =>
  readFileSync(join(packDestinations[index], basename(result.filename))),
)
assert.equal(sha256(tarballs[0]), sha256(tarballs[1]), 'repeated npm pack output is not deterministic')
assert.equal(
  createHash('sha1').update(tarballs[0]).digest('hex'),
  packResults[0].shasum,
  'npm-reported SHA-1 differs from packed bytes',
)

const installDirectory = join(temporary, 'install-current')
mkdirSync(installDirectory)
const tarball = join(packDestinations[0], basename(packResults[0].filename))
writeFileSync(
  join(installDirectory, 'package.json'),
  `${JSON.stringify({ private: true, type: 'module', dependencies: { '@sudo/contracts': `file:${tarball}` } }, null, 2)}\n`,
)
runPackageNpm(['install', '--ignore-scripts'], { cwd: installDirectory })
const installedPackage = JSON.parse(
  readFileSync(join(installDirectory, 'node_modules', '@sudo', 'contracts', 'package.json'), 'utf8'),
)
assert.equal(installedPackage.version, PACKAGE.version)
assert.equal(installedPackage.engines.node, PACKAGE.engines.node)
writeFileSync(
  join(installDirectory, 'smoke.ts'),
  `import { validateZoneId, ZONE_ID_MAX_LEN, ZONE_ID_NO_LEADING } from '@sudo/contracts/zone-id'\n` +
    `import { isResourceRef, RESOURCE_REF_API_VERSION, RESOURCE_REF_KIND, type ResourceRef } from '@sudo/contracts/common/v1/resource-ref'\n` +
    `const max: 63 = ZONE_ID_MAX_LEN\n` +
    `const separator: '-' = ZONE_ID_NO_LEADING\n` +
    `const apiVersion: 'common.sudo.dev/v1' = RESOURCE_REF_API_VERSION\n` +
    `const kind: 'ResourceRef' = RESOURCE_REF_KIND\n` +
    `const ref: ResourceRef = { api_version: apiVersion, kind, zone_id: 'workspace-main', path: '/file' }\n` +
    `validateZoneId(ref.zone_id)\n` +
    `isResourceRef(ref)\n`,
)
execFileSync(
  process.execPath,
  [
    join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', 'smoke.ts'],
  { cwd: installDirectory, stdio: 'pipe' },
)
const smoke = `
import assert from 'node:assert/strict'
import { validateZoneId } from '@sudo/contracts/zone-id'
import {
  isResourceRef,
  parseResourceRefJson,
  serializeResourceRef,
} from '@sudo/contracts/common/v1/resource-ref'
assert.equal(validateZoneId('workspace-main'), null)
const source = JSON.stringify({
  api_version: 'common.sudo.dev/v1',
  kind: 'ResourceRef',
  zone_id: 'workspace-main',
  path: '/reports/file.txt',
  future_metadata: { note: null },
})
const parsed = parseResourceRefJson(source)
assert.equal(isResourceRef(parsed), true)
assert.deepEqual(JSON.parse(serializeResourceRef(parsed)), JSON.parse(source))
console.log('installed package imports and validates')
`
const output = execFileSync(process.execPath, ['--input-type=module', '--eval', smoke], {
  cwd: installDirectory,
  encoding: 'utf8',
})
const requireSmoke = `
const assert = require('node:assert/strict')
const { validateZoneId } = require('@sudo/contracts/zone-id')
const { isResourceRef } = require('@sudo/contracts/common/v1/resource-ref')
assert.equal(validateZoneId('workspace-main'), null)
assert.equal(isResourceRef({ api_version: 'common.sudo.dev/v1', kind: 'ResourceRef', zone_id: 'workspace-main', path: '/file' }), true)
console.log('CommonJS require resolves')
`
const requireOutput = execFileSync(process.execPath, ['--input-type=commonjs', '--eval', requireSmoke], {
  cwd: installDirectory,
  encoding: 'utf8',
})
process.stdout.write(
  `package smoke verified: historical ${historicalPackage.fileCount} files/${historicalPackage.size} bytes/${historicalPackage.sha256}; ` +
    `candidate ${packedPaths.size} files/${packResults[0].size} bytes/${sha256(tarballs[0])}; ` +
    `exact deltas changed=${changed.join(',')} added=${CANDIDATE_PATH}; deterministic pack; ` +
    `${output.trim()}; ${requireOutput}`,
)
