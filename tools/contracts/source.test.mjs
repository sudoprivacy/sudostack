import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  SourceUnavailableError,
  readLocalGitBlob,
  requireFullCommitSha,
  requireRemoteSourceAvailability,
  sha256,
  verifyDigest,
} from './source.mjs'

test('owner revisions must be full immutable commit SHAs', () => {
  assert.equal(
    requireFullCommitSha('24f6730ec90fab8a035b2f5400ed313bda343fbe'),
    '24f6730ec90fab8a035b2f5400ed313bda343fbe',
  )
  for (const symbolic of ['main', 'v1.0.0', 'claude/zealous-spence-a6e3c5', '24f6730']) {
    assert.throws(() => requireFullCommitSha(symbolic, 'owner revision'), SourceUnavailableError)
  }
})

test('source digest verification catches a one-byte mutation', () => {
  const original = Buffer.from('{"value":1}\n')
  verifyDigest(original, sha256(original), 'fixture')
  const mutated = Buffer.from(original)
  mutated[10] = 0x32
  assert.throws(() => verifyDigest(mutated, sha256(original), 'fixture'), /digest mismatch/)
})

test('local Git source loading fails on a missing immutable object', () => {
  const root = mkdtempSync(join(tmpdir(), 'sudo-source-lock-'))
  const owner = join(root, 'owner')
  mkdirSync(owner)
  execFileSync('git', ['init', '-q'], { cwd: owner })
  execFileSync('git', ['config', 'user.name', 'Contract Test'], { cwd: owner })
  execFileSync('git', ['config', 'user.email', 'contract-test@example.invalid'], { cwd: owner })
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/owner.git'], { cwd: owner })
  writeFileSync(join(owner, 'source.json'), '{"value":1}\n')
  execFileSync('git', ['add', 'source.json'], { cwd: owner })
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: owner })
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: owner, encoding: 'utf8' }).trim()
  const previous = process.env.SUDOSTACK_REPOS_ROOT
  process.env.SUDOSTACK_REPOS_ROOT = root
  try {
    assert.equal(
      readLocalGitBlob({ checkout: 'owner', repository: 'https://github.com/example/owner.git', revision }, 'source.json').toString('utf8'),
      '{"value":1}\n',
    )
    assert.throws(
      () =>
        readLocalGitBlob(
          { checkout: 'owner', repository: 'https://github.com/example/wrong.git', revision },
          'source.json',
        ),
      SourceUnavailableError,
    )
    assert.throws(
      () => readLocalGitBlob({ checkout: 'owner', repository: 'https://github.com/example/owner.git', revision }, 'missing.json'),
      SourceUnavailableError,
    )
    assert.throws(
      () =>
        readLocalGitBlob(
          {
            checkout: 'owner',
            repository: 'https://github.com/example/owner.git',
            revision: '0'.repeat(40),
          },
          'source.json',
        ),
      SourceUnavailableError,
    )
  } finally {
    if (previous === undefined) delete process.env.SUDOSTACK_REPOS_ROOT
    else process.env.SUDOSTACK_REPOS_ROOT = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('remote verification state transitions from blocked to available', () => {
  assert.throws(
    () =>
      requireRemoteSourceAvailability({
        source_availability: { remote: 'blocked_unpublished', reason: 'owner commit is local' },
      }),
    SourceUnavailableError,
  )
  assert.doesNotThrow(() =>
    requireRemoteSourceAvailability({
      source_availability: { remote: 'available', reason: 'owner commit is published' },
    }),
  )
})
