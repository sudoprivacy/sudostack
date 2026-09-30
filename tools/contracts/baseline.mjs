import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  REPO,
  parseJson,
  readLocalGitBlob,
  requireFullCommitSha,
  stableJson,
  verifyDigest,
} from './source.mjs'

function gitBlob(repository, revision, path) {
  requireFullCommitSha(revision, 'sudostack compatibility baseline revision')
  try {
    execFileSync('git', ['-C', repository, 'cat-file', '-e', `${revision}^{commit}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    return execFileSync('git', ['-C', repository, 'show', `${revision}:${path}`], {
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim() || error.message
    throw new Error(`cannot read sudostack@${revision}:${path}: ${detail}`)
  }
}

function zoneIdRuleData(spec) {
  return {
    length: { min: spec.length.min, max: spec.length.max },
    charset: { allowed: spec.charset.allowed },
    edges: {
      no_leading: spec.edges.no_leading,
      no_trailing: spec.edges.no_trailing,
    },
  }
}

function assertGeneratedRuleData(source, expected) {
  const declarations = {
    min: Number(source.match(/ZONE_ID_MIN_LEN\s*=\s*(\d+)/)?.[1]),
    max: Number(source.match(/ZONE_ID_MAX_LEN\s*=\s*(\d+)/)?.[1]),
    charset: JSON.parse(source.match(/ZONE_ID_CHARSET\s*=\s*("[^"]*")/)?.[1] ?? 'null'),
    leading: JSON.parse(source.match(/ZONE_ID_NO_LEADING\s*=\s*("[^"]*")/)?.[1] ?? 'null'),
    trailing: JSON.parse(source.match(/ZONE_ID_NO_TRAILING\s*=\s*("[^"]*")/)?.[1] ?? 'null'),
  }
  const actual = {
    length: { min: declarations.min, max: declarations.max },
    charset: { allowed: declarations.charset },
    edges: { no_leading: declarations.leading, no_trailing: declarations.trailing },
  }
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error('compatibility baseline rule_data does not match its immutable ZoneId artifact')
  }
}

export function verifyCompatibilityBaseline({
  baselinePath = join(REPO, 'compatibility', 'baselines', '0.1.0.json'),
  sourceLock,
  verifyOwnerObject = Boolean(process.env.SUDOSTACK_REPOS_ROOT),
} = {}) {
  const baseline = parseJson(readFileSync(baselinePath), baselinePath)
  const sudostackRevision = requireFullCommitSha(
    baseline.package.sudostack_revision,
    'sudostack compatibility baseline revision',
  )
  const g0Revision = requireFullCommitSha(
    sourceLock.sudostack_g0_revision,
    'sudostack G0 revision',
  )
  if (sudostackRevision !== g0Revision) {
    throw new Error(
      `compatibility baseline revision ${sudostackRevision} does not match G0 ${g0Revision}`,
    )
  }
  const ownerRevision = requireFullCommitSha(
    baseline.families.zone_id.owner_revision,
    'ZoneId compatibility owner revision',
  )
  const repository = process.env.SUDOSTACK_BASE_REPO ?? REPO
  const packageJson = parseJson(
    gitBlob(repository, sudostackRevision, 'package.json'),
    'immutable baseline package.json',
  )
  if (packageJson.name !== baseline.package.name || packageJson.version !== baseline.package.version) {
    throw new Error('compatibility baseline package identity does not match its immutable commit')
  }
  const expectedArtifacts = [
    'contracts/zone-id/EXAMPLES.gen.md',
    'contracts/zone-id/vectors.gen.json',
    'contracts/zone-id/zone-id.gen.ts',
  ]
  const artifactPaths = Object.keys(baseline.artifacts).sort()
  if (stableJson(artifactPaths) !== stableJson(expectedArtifacts)) {
    throw new Error('compatibility baseline must contain the complete ZoneId artifact set')
  }
  for (const [path, digest] of Object.entries(baseline.artifacts)) {
    verifyDigest(gitBlob(repository, sudostackRevision, path), digest, `baseline artifact ${path}`)
  }
  const pin = parseJson(
    gitBlob(repository, sudostackRevision, 'contracts/zone-id/pin.json'),
    'immutable baseline ZoneId pin',
  )
  if (pin['nexus-vfs'].rev !== ownerRevision) {
    throw new Error('compatibility baseline owner revision does not match its immutable ZoneId pin')
  }
  const generatedSource = gitBlob(
    repository,
    sudostackRevision,
    'contracts/zone-id/zone-id.gen.ts',
  ).toString('utf8')
  assertGeneratedRuleData(generatedSource, baseline.families.zone_id.rule_data)

  if (verifyOwnerObject) {
    const currentOwner = sourceLock.repositories['nexus-vfs']
    const oldOwner = { ...currentOwner, revision: ownerRevision }
    const ownerSpec = readLocalGitBlob(oldOwner, 'contracts/zone-id/spec.json')
    verifyDigest(
      ownerSpec,
      baseline.families.zone_id.owner_spec_sha256,
      'immutable baseline ZoneId owner spec',
    )
    const spec = parseJson(ownerSpec, 'immutable baseline ZoneId owner spec')
    if (stableJson(zoneIdRuleData(spec)) !== stableJson(baseline.families.zone_id.rule_data)) {
      throw new Error('compatibility baseline rule_data does not match its owner spec')
    }
  }
  return baseline
}
