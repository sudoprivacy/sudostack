#!/usr/bin/env node
/** Verify the release bundle without network or registry access. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..', '..')
const release = join(repo, 'releases', 'zone-v1')
const bundle = join(release, 'bundle')

for (const line of readFileSync(join(release, 'checksums.gen.txt'), 'utf8').trim().split('\n')) {
  const [expected, relativePath] = line.trim().split(/\s+/, 2)
  const actual = createHash('sha256').update(readFileSync(join(bundle, relativePath))).digest('hex')
  if (actual !== expected) throw new Error(`checksum mismatch: ${relativePath}`)
}

const scratch = mkdtempSync(join(tmpdir(), 'sudo-contracts-offline-'))
try {
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies: { '@sudo/contracts': `file:${bundle}` } }),
  )
  const npmCommand = ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']
  const executable = process.platform === 'win32' ? process.env.ComSpec : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${npmCommand.join(' ')}`]
    : npmCommand
  const install = spawnSync(executable, args, {
    cwd: scratch,
    encoding: 'utf8',
  })
  if (install.status !== 0) {
    throw new Error(`offline npm install failed: ${install.error ?? ''}\n${install.stdout}\n${install.stderr}`)
  }
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      "await import('@sudo/contracts/zone-id'); await import('@sudo/contracts/common/v1'); await import('@sudo/contracts/auth/v1')",
    ],
    { cwd: scratch, encoding: 'utf8' },
  )
  if (probe.status !== 0) {
    throw new Error(`offline package import failed:\n${probe.stdout}\n${probe.stderr}`)
  }
  console.log('offline bundle checksums and package imports verified')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
