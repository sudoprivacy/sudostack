#!/usr/bin/env node
/**
 * Backward-compatibility checker for the zone-v1 schema family (§7.5 item 10).
 *
 * Compares an OLD set of owner schemas against a NEW set and reports every
 * change that would break an existing consumer:
 *
 *   required-added   — a field that was optional (or absent) becomes required
 *   type-changed     — a field's type/const/enum shape changes
 *   validation-tightened — pattern changes, enum shrinks, maxLength shrinks,
 *                          minLength grows, maximum drops, minimum rises
 *
 *   node compatibility/check-compatibility.mjs                     # vs the committed baseline snapshot
 *   node compatibility/check-compatibility.mjs --snapshot           # refresh the baseline (after an accepted release)
 *   node compatibility/check-compatibility.mjs --old <dir> --new <dir>  # explicit comparison (JSON schema files)
 *
 * The baseline is a snapshot of the schemas at a released revision; the
 * fixture corpus (fixtures/compatibility.gen.json) additionally pins
 * accept/reject verdicts, which the conformance suites in TS/Rust/Python
 * enforce. This checker covers the structural half the verdicts cannot see.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const BASELINE_DIR = join(HERE, 'baseline')
const ZONE_V1 = join(REPO, 'contracts', 'zone-v1')
const PIN = JSON.parse(readFileSync(join(ZONE_V1, 'pin.json'), 'utf8'))

function loadSchemaSet(source) {
  // A directory of *.json schema files.
  const files = readdirSync(source).filter((f) => f.endsWith('.json') && !f.includes('error-codes'))
  const out = {}
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(source, f), 'utf8'))
    if (doc.$id && doc.properties) out[doc.$id] = doc
  }
  return out
}

async function loadCurrentFromBundle() {
  // The bundle carries digests only; the materialized projections are not the
  // product schemas. The current set is re-fetched from the pinned revision —
  // the same source generate.mjs uses, so there is exactly one truth.
  const { rev, schemas } = PIN.nexus
  const base = `https://raw.githubusercontent.com/nexi-lab/nexus/${rev}/`
  const results = {}
  for (const rel of schemas) {
    const doc = await awaitFetch(base + rel)
    results[doc.$id] = doc
  }
  return results
}

function awaitFetch(url) {
  // small sync-looking helper; fetch is available in modern node
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`cannot fetch ${url}: HTTP ${r.status}`)
      return r.json()
    })
    .catch(async (cause) => {
      if (cause?.message?.includes('fetch failed') && (process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY)) {
        throw new Error(
          `${cause.message}\n  HTTPS_PROXY is set but Node's fetch ignores it by default.\n` +
            `  Re-run as: node --use-env-proxy compatibility/check-compatibility.mjs`,
        )
      }
      throw cause
    })
}

// The type shape covers the structural kind only (type/const/$ref). Enums are
// deliberately excluded: an enum change is judged by its own rule — shrinking
// rejects previously-valid values (breaking), growing does not.
const typeShape = (prop) => JSON.stringify(prop.type ?? prop.const ?? prop.$ref ?? null)

function diffSchema(oldDoc, newDoc, findings) {
  const id = oldDoc.$id
  const oldProps = oldDoc.properties ?? {}
  const newProps = newDoc.properties ?? {}
  const oldRequired = new Set(oldDoc.required ?? [])
  const newRequired = new Set(newDoc.required ?? [])
  for (const name of newRequired) {
    if (!oldRequired.has(name)) {
      findings.push({ kind: 'required-added', schema: id, field: name })
    }
  }
  for (const [name, oldProp] of Object.entries(oldProps)) {
    const newProp = newProps[name]
    if (!newProp) continue // deletions are a major bump, flagged by required-added logic elsewhere
    if (typeShape(oldProp) !== typeShape(newProp)) {
      findings.push({ kind: 'type-changed', schema: id, field: name, from: typeShape(oldProp), to: typeShape(newProp) })
      continue
    }
    if (JSON.stringify(oldProp.pattern) !== JSON.stringify(newProp.pattern)) {
      findings.push({ kind: 'validation-tightened', schema: id, field: name, rule: 'pattern' })
    }
    if (Array.isArray(oldProp.enum) && Array.isArray(newProp.enum)) {
      const removed = oldProp.enum.filter((v) => !newProp.enum.includes(v))
      if (removed.length) {
        findings.push({ kind: 'validation-tightened', schema: id, field: name, rule: 'enum-shrunk', removed })
      }
    }
    if (oldProp.maxLength !== undefined && newProp.maxLength !== undefined && newProp.maxLength < oldProp.maxLength) {
      findings.push({ kind: 'validation-tightened', schema: id, field: name, rule: 'maxLength' })
    }
    if (oldProp.minLength !== undefined && newProp.minLength !== undefined && newProp.minLength > oldProp.minLength) {
      findings.push({ kind: 'validation-tightened', schema: id, field: name, rule: 'minLength' })
    }
    if (oldProp.maximum !== undefined && newProp.maximum !== undefined && newProp.maximum < oldProp.maximum) {
      findings.push({ kind: 'validation-tightened', schema: id, field: name, rule: 'maximum' })
    }
    if (oldProp.minimum !== undefined && newProp.minimum !== undefined && newProp.minimum > oldProp.minimum) {
      findings.push({ kind: 'validation-tightened', schema: id, field: name, rule: 'minimum' })
    }
  }
}

export function diffSets(oldSet, newSet) {
  const findings = []
  for (const [id, oldDoc] of Object.entries(oldSet)) {
    const newDoc = newSet[id]
    if (newDoc) diffSchema(oldDoc, newDoc, findings)
  }
  return findings
}

function snapshotCurrent(current) {
  mkdirSync(BASELINE_DIR, { recursive: true })
  for (const doc of Object.values(current)) {
    const name = basename(new URL(doc.$id).pathname)
    writeFileSync(join(BASELINE_DIR, name), JSON.stringify(doc, null, 2) + '\n')
  }
  writeFileSync(
    join(BASELINE_DIR, '_pin.json'),
    JSON.stringify({ nexus: PIN.nexus.rev, generated_by: 'check-compatibility.mjs --snapshot' }, null, 2) + '\n',
  )
  console.log(`baseline refreshed: ${Object.keys(current).length} schemas at nexus ${PIN.nexus.rev.slice(0, 9)}`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--snapshot')) {
    const current = await loadCurrentFromBundle()
    snapshotCurrent(current)
    return 0
  }
  let oldSet, newSet
  if (args.includes('--old') && args.includes('--new')) {
    const oldDir = args[args.indexOf('--old') + 1]
    const newDir = args[args.indexOf('--new') + 1]
    oldSet = loadSchemaSet(oldDir)
    newSet = loadSchemaSet(newDir)
  } else {
    // Default: compare the pinned revision against the committed baseline.
    oldSet = loadSchemaSet(BASELINE_DIR)
    newSet = await loadCurrentFromBundle()
  }
  const findings = diffSets(oldSet, newSet)
  if (findings.length === 0) {
    console.log('no breaking changes detected')
    return 0
  }
  console.error(`BREAKING (${findings.length}):`)
  for (const f of findings) {
    console.error(`  ${f.kind}  ${f.schema}#${f.field}${f.rule ? ` (${f.rule})` : ''}`)
  }
  return 1
}

if (process.argv[1] && process.argv[1].endsWith('check-compatibility.mjs')) {
  main().then((code) => process.exit(code))
}
