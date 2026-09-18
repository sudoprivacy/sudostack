#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { requireSupportedNode } from './node-version.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKAGE = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
requireSupportedNode(process.versions.node, PACKAGE.engines.node)
const NPM_CLI = process.env.npm_execpath
if (!NPM_CLI) throw new Error('package smoke must run through npm so npm_execpath is available')
const runNpm = (args, options = {}) =>
  execFileSync(process.execPath, [NPM_CLI, ...args], {
    cwd: options.cwd ?? REPO,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  })

const dryRun = JSON.parse(runNpm(['pack', '--dry-run', '--json', '--ignore-scripts']))[0]
const packedPaths = new Set(dryRun.files.map((entry) => entry.path))
const fixtureIndex = JSON.parse(
  readFileSync(join(REPO, 'contracts/common/v1/resource-ref/fixture-index.gen.json'), 'utf8'),
)
const candidatePath = `manifests/releases/${PACKAGE.version}-candidate.gen.json`
const candidate = JSON.parse(readFileSync(join(REPO, candidatePath), 'utf8'))
const expected = new Set([
  'package.json',
  'README.md',
  'contracts/zone-id/zone-id.gen.js',
  'contracts/zone-id/zone-id.gen.d.ts',
  'contracts/zone-id/schema.gen.json',
  'contracts/zone-id/vectors.source.gen.json',
  'contracts/zone-path/schema.gen.json',
  'contracts/zone-path/meta-schema.gen.json',
  'contracts/zone-path/cases.source.gen.json',
  'contracts/common/v1/resource-ref/resource-ref.gen.js',
  'contracts/common/v1/resource-ref/resource-ref.gen.d.ts',
  'contracts/common/v1/resource-ref/schema.gen.json',
  'contracts/common/v1/resource-ref/owner-manifest.source.gen.json',
  'contracts/common/v1/resource-ref/fixture-index.gen.json',
  'compatibility/current.gen.json',
  'manifests/source-closure.gen.json',
  candidatePath,
  ...fixtureIndex.resource_ref.cases.map((fixture) => fixture.distributed_path),
])
for (const path of expected) assert.ok(packedPaths.has(path), `package is missing ${path}`)
for (const path of packedPaths) assert.ok(expected.has(path), `package contains unexpected ${path}`)
const packageMetadataPaths = new Set(['package.json', 'README.md', candidatePath])
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

const forbidden = [
  /^tools\//,
  /(?:^|\/)sources\.lock\.json$/,
  /spec\.source\.gen\.json$/,
  /validator-lock\.source\.gen\.json$/,
  /owner-source-lock\.source\.gen\.json$/,
  /\.test\.mjs$/,
  /resource-ref\.gen\.ts$/,
  /zone-id\.gen\.ts$/,
]
for (const path of packedPaths) {
  assert.equal(forbidden.some((pattern) => pattern.test(path)), false, path)
}

const temporary = mkdtempSync(join(tmpdir(), 'sudo-contracts-smoke-'))
process.on('exit', () => rmSync(temporary, { recursive: true, force: true }))
const packResult = JSON.parse(
  runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary]),
)[0]
assert.deepEqual(new Set(packResult.files.map((entry) => entry.path)), packedPaths)
const tarball = join(temporary, basename(packResult.filename))
writeFileSync(
  join(temporary, 'package.json'),
  `${JSON.stringify({ private: true, type: 'module', dependencies: { '@sudo/contracts': `file:${tarball}` } }, null, 2)}\n`,
)
runNpm(['install', '--ignore-scripts'], { cwd: temporary })
const installedPackage = JSON.parse(
  readFileSync(join(temporary, 'node_modules', '@sudo', 'contracts', 'package.json'), 'utf8'),
)
assert.equal(installedPackage.engines.node, PACKAGE.engines.node)
writeFileSync(
  join(temporary, 'smoke.ts'),
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
  { cwd: temporary, stdio: 'pipe' },
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
  cwd: temporary,
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
  cwd: temporary,
  encoding: 'utf8',
})
process.stdout.write(
  `package smoke verified: ${packedPaths.size} files, ${packResult.size} bytes; ${output.trim()}; ${requireOutput}`,
)
