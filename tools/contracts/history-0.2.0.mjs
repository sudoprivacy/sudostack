#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BASELINE_PATH,
  HISTORICAL_REVISION,
  REPO,
  sha256,
  verifyPackageBaseline,
} from './content-candidate.mjs'
import { runNpm } from './npm-runner.mjs'

const text = (value) => Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')
const run = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: options.encoding ?? 'utf8',
      env: options.env ?? process.env,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const details = [text(error.stdout).trim(), text(error.stderr).trim()].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} failed${details ? `:\n${details}` : ''}`, { cause: error })
  }
}

function withHistoricalCheckout(repository, callback) {
  const temporary = mkdtempSync(join(tmpdir(), 'sudo-contracts-history-'))
  const checkout = join(temporary, 'repository')
  try {
    run('git', ['clone', '--quiet', '--shared', '--no-checkout', repository, checkout])
    run('git', ['checkout', '--quiet', '--detach', HISTORICAL_REVISION], { cwd: checkout })
    assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: checkout }).trim(), HISTORICAL_REVISION)
    assert.equal(run('git', ['status', '--porcelain'], { cwd: checkout }), '')
    return callback({ checkout, temporary })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function linkDependencies(checkout, repository) {
  const dependencies = join(repository, 'node_modules')
  if (!existsSync(dependencies)) {
    throw new Error('historical full verification requires current node_modules; run npm ci --ignore-scripts first')
  }
  symlinkSync(dependencies, join(checkout, 'node_modules'), 'dir')
}

function verifyHistoricalPackageInCheckout({ checkout, temporary, baseline }) {
  const destination = join(temporary, 'pack')
  mkdirSync(destination)
  const result = JSON.parse(
    runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
      cwd: checkout,
    }),
  )[0]
  const tarball = readFileSync(join(destination, basename(result.filename)))
  assert.equal(result.name, baseline.package.name)
  assert.equal(result.version, baseline.package.version)
  assert.equal(result.entryCount, baseline.package.file_count)
  assert.equal(result.size, baseline.package.size)
  assert.equal(result.unpackedSize, baseline.package.unpacked_size)
  assert.equal(result.shasum, baseline.package.sha1)
  assert.equal(result.integrity, baseline.package.integrity)
  assert.equal(sha256(tarball), baseline.package.sha256)
  assert.deepEqual(
    result.files.map(({ path, size, mode }) => ({ path, size, mode })),
    baseline.packed_files.map(({ path, size, mode }) => ({ path, size, mode })),
  )
  for (const entry of baseline.packed_files) {
    assert.equal(
      sha256(readFileSync(join(checkout, entry.path))),
      entry.sha256,
      `historical packed file changed: ${entry.path}`,
    )
  }
  return {
    fileCount: result.entryCount,
    size: result.size,
    sha1: result.shasum,
    sha256: sha256(tarball),
  }
}

export function verifyHistoricalPackage({ repository = REPO, baseline } = {}) {
  const verifiedBaseline = baseline ?? verifyPackageBaseline({
    baselineBytes: readFileSync(join(repository, BASELINE_PATH)),
  })
  return withHistoricalCheckout(repository, ({ checkout, temporary }) =>
    verifyHistoricalPackageInCheckout({ checkout, temporary, baseline: verifiedBaseline }),
  )
}

export function verifyHistoricalRelease({
  repository = REPO,
  remote = false,
  full = false,
  baseline: suppliedBaseline,
} = {}) {
  const baseline = suppliedBaseline ?? verifyPackageBaseline({
    baselineBytes: readFileSync(join(repository, BASELINE_PATH)),
  })
  return withHistoricalCheckout(repository, ({ checkout, temporary }) => {
    const packageResult = verifyHistoricalPackageInCheckout({ checkout, temporary, baseline })
    const runNode = (script, args = []) => run(process.execPath, [script, ...args], { cwd: checkout })

    if (full) {
      linkDependencies(checkout, repository)
      for (const script of ['generate:check-offline', 'test', 'typecheck', 'manifest:check', 'package:smoke']) {
        runNpm(['run', script], { cwd: checkout })
      }
      if (remote) runNode('tools/contracts/support.mjs', ['--remote'])
    } else {
      runNode('tools/contracts/verify-candidate.mjs')
      runNode('tools/contracts/support.mjs', remote ? ['--remote'] : [])
    }

    return { package: packageResult }
  })
}

export function runHistoricalTest(testPath, { repository = REPO } = {}) {
  const environment = { ...process.env }
  delete environment.NODE_TEST_CONTEXT
  return withHistoricalCheckout(repository, ({ checkout }) =>
    run(process.execPath, ['--test', testPath], { cwd: checkout, env: environment }),
  )
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const remote = args.delete('--remote')
  const full = args.delete('--full')
  if (args.size > 0) throw new Error(`unsupported arguments: ${[...args].join(' ')}`)
  const result = verifyHistoricalRelease({ remote, full })
  console.log(
    `historical 0.2.0 verified: ${result.package.fileCount} files, ${result.package.size} bytes, ` +
      `SHA-1 ${result.package.sha1}, SHA-256 ${result.package.sha256}`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error.stack ?? error.message)
    process.exit(1)
  }
}
