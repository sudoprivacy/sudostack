#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, readJson } from './schema-lib.mjs'

const failures = []
const fail = (msg) => failures.push(msg)

const pkg = readJson(join(REPO, 'package.json'))
if (pkg.name !== '@sudo/contracts') fail('package name must be @sudo/contracts')
if (pkg.private !== true) fail('package must stay private to avoid accidental registry publish')
if (pkg.exports?.['./zone-id'] !== './contracts/zone-id/zone-id.gen.ts') {
  fail('package must export ./zone-id from the generated artifact')
}
if (pkg.exports?.['./common/v1'] !== './contracts/common/v1/common.gen.ts') {
  fail('package must export ./common/v1 from the generated artifact')
}

const workflow = readFileSync(join(REPO, '.github/workflows/contracts.yml'), 'utf8')
for (const needle of [
  'contracts/generate.mjs --check',
  'tools/generate-common.mjs --check',
  'contracts/zone-id/conformance.test.mjs',
  'contracts/common/v1/conformance.test.mjs',
  'docs/adr/enforced-by.mjs',
  'tools/check-v0-distribution.mjs',
  'tools/check-schemas.mjs',
  'tools/compatibility-check.mjs',
  'tools/check-consumers.mjs',
  'tools/generate-release-manifest.mjs --check',
  'tools/contracts-tooling.test.mjs',
  'cargo test --manifest-path crates/rust/Cargo.toml',
]) {
  if (!workflow.includes(needle)) fail(`contracts workflow must run ${needle}`)
}

if (failures.length) {
  console.error(`v0 distribution check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('v0 distribution ok')
