import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')
export const SOURCE_LOCK_PATH = join(REPO, 'contracts', 'sources.lock.json')

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')
export const parseJson = (data, label) => {
  try {
    return JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : data)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}
export const stableJson = (value) => `${JSON.stringify(sortValue(value), null, 2)}\n`

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]))
  }
  return value
}

export function requireFullCommitSha(revision, label = 'revision') {
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new SourceUnavailableError(`${label} must be a full lowercase 40-character commit SHA`)
  }
  return revision
}

export function loadSourceLock() {
  const lock = parseJson(readFileSync(SOURCE_LOCK_PATH), SOURCE_LOCK_PATH)
  requireFullCommitSha(lock.repositories.nexus.revision, 'Nexus provenance revision')
  requireFullCommitSha(lock.repositories.nexus.definition_revision, 'Nexus definition revision')
  requireFullCommitSha(lock.repositories['nexus-vfs'].revision, 'nexus-vfs owner revision')
  return lock
}

function repositoryPath(entry) {
  const root = process.env.SUDOSTACK_REPOS_ROOT
  if (!root) {
    throw new SourceUnavailableError(
      'local owner objects require SUDOSTACK_REPOS_ROOT; the pinned commits are not published remotely',
    )
  }
  return join(resolve(root), entry.checkout)
}

const VERIFIED_LOCAL_SOURCES = new Set()

function normalizeRepositoryUrl(url) {
  return url
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
}

export function readLocalGitBlob(entry, path) {
  requireFullCommitSha(entry.revision, `${entry.checkout} revision`)
  const repo = repositoryPath(entry)
  const verificationKey = JSON.stringify([
    repo,
    entry.revision,
    normalizeRepositoryUrl(entry.repository),
  ])
  try {
    if (!VERIFIED_LOCAL_SOURCES.has(verificationKey)) {
      const actualRemote = execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (normalizeRepositoryUrl(actualRemote) !== normalizeRepositoryUrl(entry.repository)) {
        throw new Error(
          `repository identity mismatch: expected ${entry.repository}, got ${actualRemote.trim()}`,
        )
      }
      execFileSync('git', ['-C', repo, 'cat-file', '-e', `${entry.revision}^{commit}`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      VERIFIED_LOCAL_SOURCES.add(verificationKey)
    }
    return execFileSync('git', ['-C', repo, 'show', `${entry.revision}:${path}`], {
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = error.stderr?.toString('utf8').trim()
    const detail = stderr || error.message
    throw new SourceUnavailableError(
      `cannot read ${entry.checkout}@${entry.revision}:${path}${detail ? `: ${detail}` : ''}`,
    )
  }
}

export function requireRemoteSourceAvailability(lock) {
  if (lock.source_availability.remote !== 'available') {
    throw new SourceUnavailableError(
      `remote owner source is ${lock.source_availability.remote}: ${lock.source_availability.reason}`,
    )
  }
}

async function remoteBlob(lock, entry, path) {
  requireRemoteSourceAvailability(lock)
  requireFullCommitSha(entry.revision, `${entry.checkout} revision`)
  const match = entry.repository.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (!match) throw new Error(`unsupported owner repository URL: ${entry.repository}`)
  const url = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${entry.revision}/${path}`
  const token = process.env.SUDOSTACK_OWNER_TOKEN ?? process.env.GITHUB_TOKEN
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  let response
  try {
    response = await fetch(url, { headers })
  } catch (error) {
    const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY
    const proxyHint =
      proxy &&
      !process.execArgv.some((argument) => argument === '--use-env-proxy') &&
      process.env.NODE_USE_ENV_PROXY !== '1'
        ? '; retry with node --use-env-proxy or NODE_USE_ENV_PROXY=1'
        : ''
    throw new SourceUnavailableError(`cannot reach ${url}: ${error.message}${proxyHint}`)
  }
  if (!response.ok) throw new SourceUnavailableError(`${url} returned HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function readBlob(lock, entry, path, mode) {
  if (mode === 'local') return readLocalGitBlob(entry, path)
  if (mode === 'remote') return remoteBlob(lock, entry, path)
  throw new Error(`unsupported source mode: ${mode}`)
}

export function verifyDigest(data, expected, label) {
  const actual = sha256(data)
  if (actual !== expected) {
    throw new Error(`${label} digest mismatch: expected ${expected}, got ${actual}`)
  }
  if (data.includes(13)) throw new Error(`${label} contains CR bytes; owner artifacts must be LF-stable`)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}

export class SourceUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SourceUnavailableError'
  }
}

const SOURCE_LOCK_ROLES = {
  zone_id: {
    canonical_source: 'zone_id_spec',
    projection: 'zone_id_schema',
    fixtures: 'zone_id_vectors',
  },
  zone_path: {
    canonical_source: 'zone_path_spec',
    projection: 'zone_path_schema',
    fixtures: 'zone_path_cases',
    meta_schema: 'zone_path_meta_schema',
    validator_lock: 'zone_path_package_lock',
  },
}

export function validateOwnerClosure({ lock, nexus, vfs, fixtures, definition }) {
  const nexusEntry = lock.repositories.nexus
  const vfsEntry = lock.repositories['nexus-vfs']
  for (const [name, file] of Object.entries(nexusEntry.files)) {
    verifyDigest(nexus[name], file.sha256, `nexus ${name}`)
  }
  for (const [name, file] of Object.entries(vfsEntry.files)) {
    verifyDigest(vfs[name], file.sha256, `nexus-vfs ${name}`)
  }

  const resourceSchema = parseJson(nexus.schema, 'Nexus ResourceRef schema')
  const ownerManifest = parseJson(nexus.manifest, 'Nexus ResourceRef manifest')
  const ownerSourceLock = parseJson(nexus.source_lock, 'Nexus nexus-vfs source lock')
  assertEqual(ownerManifest.definition.owner_revision, nexusEntry.definition_revision, 'definition revision')
  assertEqual(ownerManifest.definition.source_sha256, nexusEntry.files.schema.sha256, 'definition digest')
  assertEqual(ownerManifest.definition.source_lock.sha256, nexusEntry.files.source_lock.sha256, 'source-lock digest')
  assertEqual(ownerManifest.lifecycle.contract_baseline, 'draft-frozen', 'owner baseline state')
  assertEqual(ownerManifest.lifecycle.artifact_publication, 'unpublished', 'owner publication state')
  assertEqual(ownerManifest.lifecycle.deployment_evidence, 'not_deployed', 'owner deployment state')
  assertEqual(ownerSourceLock.owner_revision, vfsEntry.revision, 'transitive nexus-vfs revision')
  assertEqual(resourceSchema.$schema, 'https://json-schema.org/draft/2020-12/schema', 'ResourceRef dialect')
  assertEqual(resourceSchema.properties.zone_id.$ref, 'urn:sudo:nexus-vfs:zone-id:v1', 'ZoneId ref')
  assertEqual(resourceSchema.properties.path.$ref, 'urn:sudo:nexus-vfs:zone-path:v1', 'ZonePath ref')

  for (const [contract, roles] of Object.entries(SOURCE_LOCK_ROLES)) {
    for (const [role, vfsName] of Object.entries(roles)) {
      const item = ownerSourceLock.contracts[contract][role]
      assertEqual(item.owner_path, vfsEntry.files[vfsName].path, `${contract}.${role} path`)
      assertEqual(item.sha256, vfsEntry.files[vfsName].sha256, `${contract}.${role} digest`)
    }
  }

  const fixtureCases = ownerManifest.fixtures.cases
  if (!Array.isArray(fixtureCases) || fixtureCases.length === 0) {
    throw new Error('ResourceRef fixture family is empty')
  }
  assertEqual(fixtures.size, fixtureCases.length, 'ResourceRef fixture count')
  for (const fixture of fixtureCases) {
    const entry = fixtures.get(fixture.case_id)
    if (!entry) throw new Error(`ResourceRef fixture ${fixture.case_id} is missing`)
    assertEqual(entry.ownerPath, `${nexusEntry.root}/${fixture.path}`, `${fixture.case_id} path`)
    verifyDigest(entry.data, fixture.sha256, `Nexus fixture ${fixture.case_id}`)
    if (definition) {
      const definitionFixture = definition.fixtures.get(fixture.case_id)
      if (!definitionFixture || !definitionFixture.equals(entry.data)) {
        throw new Error(`ResourceRef fixture ${fixture.case_id} differs from definition revision`)
      }
    }
  }
  if (definition) {
    verifyDigest(definition.schema, nexusEntry.files.schema.sha256, 'definition-revision schema')
    verifyDigest(
      definition.source_lock,
      nexusEntry.files.source_lock.sha256,
      'definition-revision source lock',
    )
    if (!definition.schema.equals(nexus.schema) || !definition.source_lock.equals(nexus.source_lock)) {
      throw new Error('provenance activation changed immutable ResourceRef definition inputs')
    }
  }
  const fixtureIndexBytes = Buffer.from(JSON.stringify(sortValue(fixtureCases)))
  verifyDigest(fixtureIndexBytes, ownerManifest.fixtures.index_sha256, 'fixture index')

  const zoneIdSchema = parseJson(vfs.zone_id_schema, 'ZoneId schema')
  const zoneIdFixtures = parseJson(vfs.zone_id_vectors, 'ZoneId fixtures')
  const zonePathSchema = parseJson(vfs.zone_path_schema, 'ZonePath schema')
  const zonePathMetaSchema = parseJson(vfs.zone_path_meta_schema, 'ZonePath meta-schema')
  const zonePathFixtures = parseJson(vfs.zone_path_cases, 'ZonePath fixtures')
  for (const [label, bundle, expectedCount] of [
    ['ZoneId', zoneIdFixtures, ownerManifest.fixtures.primitive_cases.zone_id_case_count],
    ['ZonePath', zonePathFixtures, ownerManifest.fixtures.primitive_cases.zone_path_case_count],
  ]) {
    if (!Array.isArray(bundle.cases) || bundle.cases.length === 0) {
      throw new Error(`${label} fixture family is empty`)
    }
    assertEqual(bundle.cases.length, expectedCount, `${label} fixture count`)
    const outcomes = new Set(bundle.cases.map((item) => item.expected))
    if (!outcomes.has('accept') || !outcomes.has('reject')) {
      throw new Error(`${label} fixtures must include accepting and rejecting cases`)
    }
  }
  assertEqual(zoneIdSchema.$id, 'urn:sudo:nexus-vfs:zone-id:v1', 'ZoneId schema id')
  assertEqual(zonePathSchema.$id, 'urn:sudo:nexus-vfs:zone-path:v1', 'ZonePath schema id')
  assertEqual(zonePathSchema.$schema, zonePathMetaSchema.$id, 'ZonePath dialect')
  assertEqual(
    zonePathMetaSchema.$vocabulary['urn:sudo:nexus-vfs:vocab:zone-path:v1'],
    true,
    'ZonePath required vocabulary',
  )
  if (!Object.hasOwn(zonePathSchema, 'sudoZonePath')) {
    throw new Error('ZonePath schema is missing required sudoZonePath assertion')
  }

  nexus.schemaJson = resourceSchema
  nexus.manifestJson = ownerManifest
  nexus.sourceLockJson = ownerSourceLock
  return { lock, nexus, vfs, fixtures }
}

export async function loadOwnerClosure({ mode = 'local' } = {}) {
  const lock = loadSourceLock()
  const nexusEntry = lock.repositories.nexus
  const vfsEntry = lock.repositories['nexus-vfs']
  const nexus = {}
  for (const [name, file] of Object.entries(nexusEntry.files)) {
    const data = await readBlob(lock, nexusEntry, file.path, mode)
    verifyDigest(data, file.sha256, `nexus ${name}`)
    nexus[name] = data
  }
  const ownerManifest = parseJson(nexus.manifest, 'Nexus ResourceRef manifest')
  const ownerSourceLock = parseJson(nexus.source_lock, 'Nexus nexus-vfs source lock')

  const vfs = {}
  for (const [name, file] of Object.entries(vfsEntry.files)) {
    const data = await readBlob(lock, vfsEntry, file.path, mode)
    verifyDigest(data, file.sha256, `nexus-vfs ${name}`)
    vfs[name] = data
  }

  for (const [contract, roles] of Object.entries(SOURCE_LOCK_ROLES)) {
    for (const [role, vfsName] of Object.entries(roles)) {
      const item = ownerSourceLock.contracts[contract][role]
      const vendorPath = `${nexusEntry.root}/${item.vendored_path}`
      const vendored = await readBlob(lock, nexusEntry, vendorPath, mode)
      verifyDigest(vendored, item.sha256, `Nexus vendored ${contract}.${role}`)
      if (!vendored.equals(vfs[vfsName])) {
        throw new Error(`Nexus vendored ${contract}.${role} differs from nexus-vfs owner bytes`)
      }
    }
  }

  const fixtures = new Map()
  for (const fixture of ownerManifest.fixtures.cases) {
    const ownerPath = `${nexusEntry.root}/${fixture.path}`
    const data = await readBlob(lock, nexusEntry, ownerPath, mode)
    verifyDigest(data, fixture.sha256, `Nexus fixture ${fixture.case_id}`)
    fixtures.set(fixture.case_id, {
      metadata: fixture,
      data,
      ownerPath,
    })
  }
  const definitionEntry = { ...nexusEntry, revision: nexusEntry.definition_revision }
  const definition = {
    schema: await readBlob(lock, definitionEntry, nexusEntry.files.schema.path, mode),
    source_lock: await readBlob(lock, definitionEntry, nexusEntry.files.source_lock.path, mode),
    fixtures: new Map(),
  }
  for (const fixture of ownerManifest.fixtures.cases) {
    const ownerPath = `${nexusEntry.root}/${fixture.path}`
    definition.fixtures.set(
      fixture.case_id,
      await readBlob(lock, definitionEntry, ownerPath, mode),
    )
  }
  return validateOwnerClosure({ lock, nexus, vfs, fixtures, definition })
}
