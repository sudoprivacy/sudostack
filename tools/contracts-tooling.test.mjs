/**
 * The ADR-005 tooling gates are useful only if they run together and publish
 * auditable outputs. These tests exercise the local scripts that CI wires into
 * the contracts workflow.
 *
 * Run: node --test tools/contracts-tooling.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './schema-lib.mjs'
import { breakingChanges } from './compatibility-check.mjs'

test('v0 distribution is exact-pinned and CI-gated', () => {
  run('node', ['tools/check-v0-distribution.mjs'])
})

test('schema lint checks schema ids, api_version, kind, manifests, and fixtures', () => {
  run('node', ['tools/check-schemas.mjs'])
})

test('compatibility checker has a baseline for every schema', () => {
  run('node', ['tools/compatibility-check.mjs'])
})

test('compatibility checker rejects representative narrowing changes', () => {
  const baseline = {
    type: 'object',
    properties: {
      code: { type: 'string', enum: ['A', 'B'] },
      message: { type: 'string' },
      records: { type: 'array', items: { type: 'string' } },
    },
  }
  const narrowed = {
    type: 'object',
    properties: {
      code: { type: 'string', enum: ['A'] },
      message: { type: 'string', maxLength: 20, format: 'date-time' },
      records: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
  }
  const changes = breakingChanges(baseline, narrowed).join('\n')
  assert.match(changes, /enum value removed/)
  assert.match(changes, /maxLength tightened/)
  assert.match(changes, /format changed/)
  assert.match(changes, /minLength tightened/)
})

test('consumer matrix records supported families and exact pins', () => {
  run('node', ['tools/check-consumers.mjs'])
})

test('release manifest pins schema and artifact digests', () => {
  run('node', ['tools/generate-release-manifest.mjs', '--check'])
  const manifest = JSON.parse(readFileSync(join(REPO, 'manifests/releases/0.1.0.gen.json'), 'utf8'))
  assert.ok(manifest.schema_bundle_digest?.startsWith('sha256:'))
  assert.ok(manifest.schemas.length > 0)
  assert.ok(manifest.schemas.every((schema) => schema.schema_digest?.startsWith('sha256:')))
  assert.ok(manifest.generated_artifacts.length > 0)
  assert.ok(manifest.generated_artifacts.every((artifact) => artifact.digest?.startsWith('sha256:')))
})

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
}
