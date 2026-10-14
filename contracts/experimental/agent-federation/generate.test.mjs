import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { sha256 } from '../../../tools/contracts/source.mjs'
import { renderFederationFile, validateFederationLock } from './generate.mjs'

const root = new URL('./', import.meta.url)
const lock = JSON.parse(readFileSync(new URL('source.lock.json', root), 'utf8'))

test('federation lock requires an exact owner and fixed source/output closure', () => {
  validateFederationLock(lock)
  for (const changed of [
    { ...lock, revision: 'main' }, { ...lock, semanticOwner: 'sudostack' },
    { ...lock, repository: 'https://example.com/moss' }, { ...lock, maturity: 'stable' },
    { ...lock, files: { ...lock.files, '../escape': { output: '../escape', digest: `sha256:${'0'.repeat(64)}` } } },
  ]) assert.throws(() => validateFederationLock(changed))
})

test('installed experimental artifacts reproduce owner bytes and reject tampering', () => {
  for (const [path, entry] of Object.entries(lock.files)) {
    const artifact = readFileSync(new URL(entry.output, root), 'utf8')
    const source = path.endsWith('.ts') ? artifact.slice(artifact.indexOf('\n') + 1) : artifact
    assert.equal(`sha256:${sha256(source)}`, entry.digest)
    assert.equal(renderFederationFile(lock, path, source), artifact)
    assert.throws(() => renderFederationFile(lock, path, source + '\n'), /digest mismatch/)
  }
})
