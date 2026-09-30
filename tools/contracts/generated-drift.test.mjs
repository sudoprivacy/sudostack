import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('offline gates catch contradictory provenance and generated hand edits', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'sudo-generated-drift-'))
  try {
    for (const path of ['contracts', 'tools/contracts', 'compatibility', 'manifests']) {
      cpSync(join(REPO, path), join(temporary, path), { recursive: true })
    }
    for (const path of ['README.md', 'package.json', 'package-lock.json']) {
      cpSync(join(REPO, path), join(temporary, path))
    }
    mkdirSync(join(temporary, 'node_modules'))
    cpSync(join(REPO, 'node_modules', 'typescript'), join(temporary, 'node_modules', 'typescript'), {
      recursive: true,
    })
    const generatorEnv = { ...process.env, SUDOSTACK_BASE_REPO: REPO }
    const clean = spawnSync(process.execPath, ['contracts/generate.mjs', '--check', '--offline'], {
      cwd: temporary,
      encoding: 'utf8',
      env: generatorEnv,
    })
    assert.equal(clean.status, 0, clean.stderr)

    const candidatePath = join(temporary, 'manifests/releases/0.2.1-candidate.gen.json')
    const originalCandidate = readFileSync(candidatePath, 'utf8')
    const candidateMutations = [
      (value) => { value.sudostack.assembly_source_lock.sha256 = '0'.repeat(64) },
      (value) => { value.owners.nexus.schema_sha256 = '0'.repeat(64) },
      (value) => { value.generated_artifacts.pop() },
      (value) => { value.internal_generation_artifacts.pop() },
      (value) => { value.choreography.activation_A.binds = [] },
    ]
    for (const mutate of candidateMutations) {
      const changed = JSON.parse(originalCandidate)
      mutate(changed)
      writeFileSync(candidatePath, `${JSON.stringify(changed, null, 2)}\n`)
      const result = spawnSync(process.execPath, ['tools/contracts/verify-candidate.mjs'], {
        cwd: temporary,
        encoding: 'utf8',
        env: generatorEnv,
      })
      assert.notEqual(result.status, 0, 'manifest verifier accepted incomplete or forged metadata')
    }
    writeFileSync(candidatePath, originalCandidate)

    const baselinePath = join(temporary, 'compatibility/baselines/0.1.0.json')
    const originalBaseline = readFileSync(baselinePath, 'utf8')
    const symbolicBaseline = JSON.parse(originalBaseline)
    symbolicBaseline.package.sudostack_revision = 'main'
    writeFileSync(baselinePath, `${JSON.stringify(symbolicBaseline, null, 2)}\n`)
    const symbolicBaselineResult = spawnSync(
      process.execPath,
      ['contracts/generate.mjs', '--check', '--offline'],
      { cwd: temporary, encoding: 'utf8', env: generatorEnv },
    )
    assert.notEqual(symbolicBaselineResult.status, 0)
    assert.match(symbolicBaselineResult.stderr, /must be a full lowercase 40-character commit SHA/)

    const forgedBaseline = JSON.parse(originalBaseline)
    forgedBaseline.artifacts['contracts/zone-id/zone-id.gen.ts'] = '0'.repeat(64)
    writeFileSync(baselinePath, `${JSON.stringify(forgedBaseline, null, 2)}\n`)
    const forgedBaselineResult = spawnSync(
      process.execPath,
      ['contracts/generate.mjs', '--check', '--offline'],
      { cwd: temporary, encoding: 'utf8', env: generatorEnv },
    )
    assert.notEqual(forgedBaselineResult.status, 0)
    assert.match(forgedBaselineResult.stderr, /baseline artifact .* digest mismatch/)
    writeFileSync(baselinePath, originalBaseline)

    const lockPath = join(temporary, 'contracts/sources.lock.json')
    const originalLock = readFileSync(lockPath, 'utf8')
    const symbolicLock = JSON.parse(originalLock)
    symbolicLock.repositories['nexus-vfs'].revision = 'main'
    writeFileSync(lockPath, `${JSON.stringify(symbolicLock, null, 2)}\n`)
    const symbolic = spawnSync(
      process.execPath,
      ['contracts/generate.mjs', '--check', '--offline'],
      { cwd: temporary, encoding: 'utf8', env: generatorEnv },
    )
    assert.notEqual(symbolic.status, 0)
    assert.match(symbolic.stderr, /must be a full lowercase 40-character commit SHA/)

    const contradictoryLock = JSON.parse(originalLock)
    contradictoryLock.repositories['nexus-vfs'].revision = '0'.repeat(40)
    writeFileSync(lockPath, `${JSON.stringify(contradictoryLock, null, 2)}\n`)
    const contradictory = spawnSync(
      process.execPath,
      ['contracts/generate.mjs', '--check', '--offline'],
      { cwd: temporary, encoding: 'utf8', env: generatorEnv },
    )
    assert.notEqual(contradictory.status, 0)
    assert.match(contradictory.stderr, /transitive nexus-vfs revision/)
    writeFileSync(lockPath, originalLock)

    const pinPath = join(temporary, 'contracts/zone-id/pin.json')
    const originalPin = readFileSync(pinPath, 'utf8')
    const stalePin = JSON.parse(originalPin)
    stalePin['nexus-vfs'].rev = '0'.repeat(40)
    writeFileSync(pinPath, `${JSON.stringify(stalePin, null, 2)}\n`)
    const pinDrift = spawnSync(
      process.execPath,
      ['contracts/generate.mjs', '--check', '--offline'],
      { cwd: temporary, encoding: 'utf8', env: generatorEnv },
    )
    assert.notEqual(pinDrift.status, 0)
    assert.match(pinDrift.stderr, /stale: contracts\/zone-id\/pin\.json/)
    writeFileSync(pinPath, originalPin)

    appendFileSync(join(temporary, 'contracts/zone-id/zone-id.gen.ts'), '// hand edit\n')
    const dirty = spawnSync(process.execPath, ['contracts/generate.mjs', '--check', '--offline'], {
      cwd: temporary,
      encoding: 'utf8',
      env: generatorEnv,
    })
    assert.notEqual(dirty.status, 0)
    assert.match(dirty.stderr, /stale: contracts\/zone-id\/zone-id\.gen\.ts/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
