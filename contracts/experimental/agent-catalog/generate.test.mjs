import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { sha256 } from '../../../tools/contracts/source.mjs'
import { renderCatalogFile, validateCatalogLock } from './generate.mjs'

const root = new URL('./', import.meta.url)
const lock = JSON.parse(readFileSync(new URL('source.lock.json', root), 'utf8'))

test('catalog lock requires an exact owner and fixed source/output closure', () => {
  validateCatalogLock(lock)
  for (const changed of [
    { ...lock, revision: 'main' }, { ...lock, semanticOwner: 'sudostack' },
    { ...lock, repository: 'https://example.com/moss' }, { ...lock, maturity: 'stable' },
    { ...lock, files: { ...lock.files, '../escape': { output: '../escape', digest: `sha256:${'0'.repeat(64)}` } } },
  ]) assert.throws(() => validateCatalogLock(changed))
})

test('installed experimental artifacts reproduce owner bytes and reject tampering', () => {
  for (const [path, entry] of Object.entries(lock.files)) {
    const artifact = readFileSync(new URL(entry.output, root), 'utf8')
    const source = path.endsWith('.ts') ? artifact.slice(artifact.indexOf('\n') + 1) : artifact
    assert.equal(`sha256:${sha256(source)}`, entry.digest)
    assert.equal(renderCatalogFile(lock, path, source), artifact)
    assert.throws(() => renderCatalogFile(lock, path, source + '\n'), /digest mismatch/)
  }
})

test('catalog schema accepts partial provenance and rejects secrets or invented capability values', async () => {
  const { default: Ajv } = await import('ajv')
  const schema = JSON.parse(readFileSync(new URL('schema.gen.json', root), 'utf8'))
  const ajv = new Ajv({ strict: false }); ajv.addSchema(schema)
  const validate = ajv.compile({ $ref: schema.$id + '#/definitions/CatalogRun' })
  const run = { task_id: 'task-1', session_id: 'session-1', attempt_id: null, user_id: 'user-1', status: 'unknown', output_status: 'pending',
    error_code: 'PROVIDER_RESULT_UNKNOWN', created_at: 1, updated_at: 2, version: 'candidate-1', source_digest: `sha256:${'a'.repeat(64)}`,
    source_revision: null, adapter_version: null, protocol: null, capabilities: null, provider_run_id: null, provider_response_id: null,
    observability: null, version_evidence: 'source_snapshot_only' }
  assert.equal(validate(run), true, JSON.stringify(validate.errors))
  assert.equal(validate({ ...run, api_key: 'must-never-appear' }), false)
  const caps = { streaming: 'unsupported', cancel: 'unsupported', resume: 'unsupported', idempotency: 'unknown', trace_export: 'partial', version_pin: 'unsupported', human_approval: 'unsupported' }
  assert.equal(validate({ ...run, capabilities: caps }), true)
  assert.equal(validate({ ...run, capabilities: { ...caps, resume: 'guaranteed' } }), false)
})
