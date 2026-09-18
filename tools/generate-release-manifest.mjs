#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { REPO, listFiles, readJson, schemaFiles, stableJson } from './schema-lib.mjs'

const CHECK = process.argv.includes('--check')
const OUT = join(REPO, 'manifests/releases/0.1.0.gen.json')
const pkg = readJson(join(REPO, 'package.json'))
const schemaPaths = schemaFiles()
const artifactPaths = listFiles(join(REPO, 'contracts'), (p) => /\.gen\.(ts|json)$/.test(p))
const schemaDigestsById = new Map(schemaPaths.map((path) => [readJson(path).$id, digestFile(path)]))
const schemaManifests = listFiles(join(REPO, 'manifests/schemas'), (p) => p.endsWith('.manifest.json')).map((path) => {
  const manifest = readJson(path)
  const schemaDigest = schemaDigestsById.get(manifest.schema_id)
  if (!schemaDigest) throw new Error(`${relative(REPO, path)} points at unknown schema_id ${manifest.schema_id}`)
  return { ...manifest, schema_digest: schemaDigest }
})

const manifest = {
  package_version: pkg.version,
  git_commit: 'WORKTREE',
  schema_bundle_digest: digestMany(schemaPaths),
  schemas: schemaManifests,
  generated_artifacts: artifactPaths.map((path) => ({
    language: path.endsWith('.ts') ? 'typescript' : 'json',
    package: pkg.name,
    version: pkg.version,
    path: relative(REPO, path),
    digest: digestFile(path),
  })),
  created_at: '1970-01-01T00:00:00Z'
}

const content = stableJson(manifest)
let existing = null
try {
  existing = readFileSync(OUT, 'utf8')
} catch {}

if (existing !== content) {
  if (CHECK) {
    console.error('stale: manifests/releases/0.1.0.gen.json')
    process.exit(1)
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, content)
  console.log('wrote  manifests/releases/0.1.0.gen.json')
} else {
  console.log('release manifest up to date')
}

function digestFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

function digestMany(paths) {
  const h = createHash('sha256')
  for (const path of paths.sort()) {
    h.update(relative(REPO, path))
    h.update('\0')
    h.update(readFileSync(path))
    h.update('\0')
  }
  return `sha256:${h.digest('hex')}`
}
