#!/usr/bin/env node
/**
 * Derives the non-Rust artifacts from the upstream contract owners.
 *
 * sudostack assembles; it does not define. Specs and schemas live with
 * whoever owns the concept, and this fetches them at the revisions named in
 * the pin.json files — a pin rather than a copy, because a copy is a second
 * truth and starts drifting the day it is made.
 *
 * Two derivations live here:
 *
 *   zone-id  — the original single-contract line (nexus-vfs zone-id spec ->
 *              TS validator + vectors + examples), byte-for-byte unchanged.
 *   zone-v1  — the product contract family: nexus auth/common v1 schemas,
 *              the nexus-vfs projections they $ref, and the nexus fixture
 *              corpus. Produces standalone validators (ajv standalone output
 *              — consumers need no ajv at runtime), type declarations, the
 *              schema bundle, provenance and materialized fixtures. moss's
 *              iam/v1 is pinned for provenance only: no cross-repo consumer
 *              exists yet, so no public iam/v1 export is derived.
 *
 *   node contracts/generate.mjs          derive, write, report
 *   node contracts/generate.mjs --check  derive and fail if anything differs
 *
 * Rust needs nothing from here for zone-id: `nexus-vfs` generates its
 * validator from the same spec at compile time into OUT_DIR, so nothing is
 * committed there to go stale. crates/sudo-contracts reads the vendored
 * projections through its own build.rs the same way. TypeScript has no
 * equivalent hook, so its artifacts are committed — and held honest by CI
 * running this script and failing on any diff.
 *
 * Generated files carry `.gen.` in the name and say where they came from,
 * but that is a courtesy, not the enforcement. The enforcement is the CI diff.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Node's built-in fetch is undici, and undici does NOT read HTTP_PROXY /
// HTTPS_PROXY the way curl and most other clients do. A machine that reaches
// the network only through a proxy therefore fails here with a bare `fetch
// failed`, which reads as "the pinned revision is unreachable" rather than
// "the request never left the host".
//
// Deliberately not solved by depending on undici's ProxyAgent: the runtime
// dependency footprint of this generator stays zero — `--use-env-proxy`
// (Node >=22.14) turns it on — so the fix is a flag, and the error below
// says so rather than leaving the reader to discover it.
const PROXY = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const CHECK = process.argv.includes('--check')

const RAW = 'https://raw.githubusercontent.com'

async function fetchJson(owner, repo, rev, path) {
  const url = `${RAW}/${owner}/${repo}/${rev}/${path}`
  let res
  try {
    res = await fetch(url)
  } catch (cause) {
    const hint =
      PROXY && !process.execArgv.some((a) => a.startsWith('--use-env-proxy'))
        ? `\n  HTTPS_PROXY is set but Node's fetch ignores it by default.` +
          `\n  Re-run as: node --use-env-proxy contracts/generate.mjs`
        : ''
    throw new Error(`cannot reach ${url}: ${cause.message}${hint}`)
  }
  if (!res.ok) {
    throw new Error(
      `cannot read ${path} at ${rev.slice(0, 9)} (HTTP ${res.status}).\n` +
        `  Pinned revisions are immutable, so this is a network or access problem,\n` +
        `  not a stale pin — retry rather than bumping the pin to work around it.`,
    )
  }
  return JSON.parse(await res.text())
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** Write (or in --check mode, compare) one derived artifact. Returns incremented stale count. */
function emit(relPath, content, stale) {
  const path = join(HERE, relPath)
  let existing = null
  try {
    existing = readFileSync(path, 'utf8')
  } catch {
    /* first run */
  }
  if (existing === content) return stale
  if (CHECK) {
    console.error(`stale: ${relPath}`)
    return stale + 1
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  console.log(`wrote  ${relPath}`)
  return stale + 1
}

// ═══════════════════ zone-id (behavior unchanged) ═══════════════════

const pin = JSON.parse(readFileSync(join(HERE, 'zone-id/pin.json'), 'utf8'))
const { rev, specs } = pin['nexus-vfs']

const fetchSpec = (path) => fetchJson('nexi-lab', 'nexus-vfs', rev, path)

/** Cases derived from the spec, so they cannot describe a rule the spec does not have. */
function vectors(spec) {
  const { min, max } = spec.length
  const ok = 'a'
  const bad = spec.charset.allowed.includes('_') ? '!' : '_'
  const lead = spec.edges.no_leading
  const trail = spec.edges.no_trailing
  return [
    { id: ok.repeat(min), valid: true, why: 'shortest permitted' },
    { id: ok.repeat(max), valid: true, why: 'longest permitted' },
    { id: 'cloud-user-1001', valid: true, why: 'canonical shape' },
    { id: '550e8400-e29b-41d4-a716-446655440000', valid: true, why: 'a bare UUID is usable as-is' },
    { id: ok.repeat(min - 1), valid: false, why: 'shorter than the minimum' },
    { id: ok.repeat(max + 1), valid: false, why: 'longer than the maximum' },
    { id: `${lead}leading`, valid: false, why: 'leading separator' },
    { id: `trailing${trail}`, valid: false, why: 'trailing separator' },
    { id: 'Has-Upper', valid: false, why: 'uppercase is excluded, not folded' },
    { id: `has${bad}char`, valid: false, why: 'character outside the set' },
    { id: 'org:550e8400-e29b-41d4-a716-446655440000', valid: false, why: 'a colon is not in the set' },
  ]
}

function renderTs(spec) {
  const { min, max } = spec.length
  return `// @generated by contracts/generate.mjs from nexus-vfs ${rev.slice(0, 9)}
// ${specs['zone-id']} — do not edit. Run \`node contracts/generate.mjs\` instead;
// CI fails on any hand edit.
//
// The rule belongs to nexus-vfs, which generates its own validator from this
// same spec at compile time. This file exists because TypeScript has no
// equivalent build hook — the two are derived from one source, not written twice.

/** Shortest permitted zone id. */
export const ZONE_ID_MIN_LEN = ${min}
/** Longest permitted zone id. */
export const ZONE_ID_MAX_LEN = ${max}
/** Every character a zone id may contain. */
export const ZONE_ID_CHARSET = ${JSON.stringify(spec.charset.allowed)}
/** Character a zone id may not start with. */
export const ZONE_ID_NO_LEADING = ${JSON.stringify(spec.edges.no_leading)}
/** Character a zone id may not end with. */
export const ZONE_ID_NO_TRAILING = ${JSON.stringify(spec.edges.no_trailing)}

/** Why a zone id was refused; \`null\` when it is acceptable. */
export type ZoneIdRefusal =
  | { kind: 'length'; got: number }
  | { kind: 'character'; got: string; at: number }
  | { kind: 'leading' }
  | { kind: 'trailing' }

/**
 * Checks a zone id against the format, returning the first violation.
 *
 * Reserved ids are NOT checked here. They are kernel-owned strings whose SSOT is
 * nexus-vfs's own constants, and a consumer that restated them would be carrying
 * a copy that goes stale on a rename. Reserved ids are refused by the daemon.
 */
export function validateZoneId(id: string): ZoneIdRefusal | null {
  const len = [...id].length
  if (len < ZONE_ID_MIN_LEN || len > ZONE_ID_MAX_LEN) return { kind: 'length', got: len }
  if (id.startsWith(ZONE_ID_NO_LEADING)) return { kind: 'leading' }
  if (id.endsWith(ZONE_ID_NO_TRAILING)) return { kind: 'trailing' }
  const chars = [...id]
  for (let at = 0; at < chars.length; at++) {
    if (!ZONE_ID_CHARSET.includes(chars[at])) return { kind: 'character', got: chars[at], at }
  }
  return null
}

/** Human-readable refusal, phrased so the reader knows what to change. */
export function describeRefusal(r: ZoneIdRefusal): string {
  switch (r.kind) {
    case 'length':
      return \`zone id must be \${ZONE_ID_MIN_LEN}–\${ZONE_ID_MAX_LEN} characters, got \${r.got}\`
    case 'character':
      return \`zone id contains ${'${JSON.stringify(r.got)}'} at position \${r.at}; permitted characters are \${ZONE_ID_CHARSET}\`
    case 'leading':
      return \`zone id must not start with ${'${JSON.stringify(ZONE_ID_NO_LEADING)}'}\`
    case 'trailing':
      return \`zone id must not end with ${'${JSON.stringify(ZONE_ID_NO_TRAILING)}'}\`
  }
}
`
}

function renderExamples(spec, vecs) {
  const rows = vecs
    .map((v) => {
      const shown = v.id.length > 44 ? `${v.id.slice(0, 41)}…` : v.id
      return `| \`${shown}\` | ${v.valid ? '✅' : '❌'} | ${v.why} |`
    })
    .join('\n')
  return `<!-- @generated by contracts/generate.mjs from nexus-vfs ${rev.slice(0, 9)} — do not edit. -->

# zone-id — what is and is not accepted

Derived from the spec, not written by hand, so these cannot describe a rule the
spec does not have. That is the point: examples written separately drift from the
rule they illustrate, and a wrong example is worse than none.

**The rule**: ${spec.length.min}–${spec.length.max} characters, from \`${spec.charset.allowed}\`,
not starting with \`${spec.edges.no_leading}\` or ending with \`${spec.edges.no_trailing}\`.
Reserved ids are refused by the daemon.

| id | | why |
|---|---|---|
${rows}

**It cannot be changed after creation.** ${spec.mutability.why}
`
}

// ═══════════════════ zone-v1 (product family) ═══════════════════

const zoneV1Pin = JSON.parse(readFileSync(join(HERE, 'zone-v1/pin.json'), 'utf8'))

/** export name for a schema's standalone validator, e.g. ZoneGrant -> validateZoneGrant. */
function validatorName(schema) {
  const Pascal = schema.title
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
  return `validate${Pascal}`
}

/** schema property -> TS type annotation for the .d.ts layer. */
function propToTs(prop, ownSchemasByFile) {
  if (prop.const !== undefined) return JSON.stringify(prop.const)
  if (Array.isArray(prop.enum)) return prop.enum.map((v) => JSON.stringify(v)).join(' | ')
  if (prop.type === 'integer' || prop.type === 'number') return 'number'
  if (prop.type === 'boolean') return 'boolean'
  if (prop.type === 'array') return `Array<${propToTs(prop.items, ownSchemasByFile)}>`
  if (prop.type === 'object') {
    if (prop.additionalProperties && typeof prop.additionalProperties === 'object') {
      return `{ [key: string]: ${propToTs(prop.additionalProperties, ownSchemasByFile)} }`
    }
    return 'Record<string, unknown>'
  }
  if (prop.$ref) {
    // A $ref to a schema we also emit becomes its interface name; a $ref into
    // the nexus-vfs projections stays a plain string — the standalone
    // validator owns those rules, the type layer only carries the value.
    const target = Object.values(ownSchemasByFile).find((s) => s.$id === prop.$ref)
    return target ? target.title : 'string'
  }
  return 'string'
}

function renderInterface(schema, ownSchemasByFile) {
  const required = new Set(schema.required ?? [])
  const lines = Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const opt = required.has(name) ? '' : '?'
    return `  ${name}${opt}: ${propToTs(prop, ownSchemasByFile)}`
  })
  return `export interface ${schema.title} {\n${lines.join('\n')}\n}`
}

const familyOf = (doc) => {
  if (doc.$id.includes('/schemas/common/')) return 'common/v1'
  if (doc.$id.includes('/schemas/runtime/')) return 'runtime/v2'
  return 'auth/v1'
}

async function deriveZoneV1(stale) {
  const vfs = zoneV1Pin['nexus-vfs']
  const nx = zoneV1Pin['nexus']
  const moss = zoneV1Pin['moss']

  // -- fetch everything the family needs, at the pinned revisions ------------
  const projections = {}
  for (const p of vfs.projections) {
    projections[p] = await fetchJson('nexi-lab', 'nexus-vfs', vfs.rev, p)
  }
  const schemasByFile = {}
  for (const p of nx.schemas) {
    schemasByFile[p] = await fetchJson('nexi-lab', 'nexus', nx.rev, p)
  }
  const errorCodes = await fetchJson('nexi-lab', 'nexus', nx.rev, nx.error_codes)
  const mossSchemas = {}
  for (const p of moss.schemas) {
    mossSchemas[p] = await fetchJson('sudoprivacy', 'moss', moss.rev, p)
  }
  const fixtureFiles = [
    'valid/cases.json',
    'invalid/cases.json',
    'roundtrip/cases.json',
    'compatibility/previous-minor.json',
    'secret-negative/cases.json',
    'path-traversal/cases.json',
  ]
  const fixtures = {}
  for (const f of fixtureFiles) {
    fixtures[f] = await fetchJson('nexi-lab', 'nexus', nx.rev, `${nx.fixtures_dir}${f}`)
  }

  // -- standalone validators via ajv (devDependency, generate-time only) -----
  const { default: Ajv2020 } = await import('ajv/dist/2020.js')
  const { default: standaloneCode } = await import('ajv/dist/standalone/index.js')
  const ownPackage = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const ajvVersion = ownPackage.devDependencies.ajv
  const ajv = new Ajv2020({ code: { source: true, esm: true } })
  for (const doc of [...Object.values(projections), ...Object.values(schemasByFile)]) {
    ajv.addSchema(doc)
  }
  const named = {}
  for (const doc of Object.values(schemasByFile)) {
    named[validatorName(doc)] = doc.$id
  }
  let standalone = standaloneCode(ajv, named)
  // ajv's standalone output references small runtime helpers by require/import
  // (e.g. ucs2length for patterns it deems unicode-sensitive). Inline them so
  // the artifact truly has zero runtime dependencies — consumers need no ajv
  // at all. ucs2length is the JSON-Schema-spec string-length definition (RFC
  // 4627 §3 semantics), not a copied owner rule.
  const ucs2lengthDef =
    'function ucs2length(s) {\n' +
    '  // JSON Schema string length: Unicode code points per RFC 4627 §3\n' +
    '  let length = 0\n' +
    '  for (let i = 0; i < s.length; i++) {\n' +
    '    const charCode = s.charCodeAt(i)\n' +
    '    if (charCode >= 0xd800 && charCode <= 0xdbff && i + 1 < s.length) {\n' +
    '      const next = s.charCodeAt(i + 1)\n' +
    '      if (next >= 0xdc00 && next <= 0xdfff) i++\n' +
    '    }\n' +
    '    length++\n' +
    '  }\n' +
    '  return length\n' +
    '}\n'
  standalone = standalone
    .replace(
      /^(import\s+.*from\s+"ajv\/dist\/runtime\/ucs2length(\.js)?";?\s*)$/m,
      '',
    )
    .replace(/const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g, 'const $1 = ucs2length;')
    .replace(/^("use strict";)?/, (m) => `${m ?? ''}\n${ucs2lengthDef}`)
  if (/require\(|from "ajv\//.test(standalone)) {
    throw new Error('standalone output still references ajv runtime — add an inline mapping for it')
  }

  const header = `// @generated by contracts/generate.mjs — do not edit. Run \`node contracts/generate.mjs\` instead; CI fails on any hand edit.
// Owners at pinned revisions: nexus-vfs ${vfs.rev.slice(0, 9)} (projections), nexus ${nx.rev.slice(0, 9)} (schemas/fixtures).
// Validators are ajv ${ajvVersion} standalone output (2020-12): self-contained, consumers need no ajv at runtime.
`

  // -- shared standalone validator module + auth codes ------------------------
  stale = emit('zone-v1/validators.gen.js', header + '\n' + standalone + '\n', stale)

  const codes =
    header +
    `\n/** Open registry: unknown codes are legal wire values within the same major. */\n` +
    `export const KNOWN_ERROR_CODES = /** @type {readonly string[]} */ (${JSON.stringify(
      errorCodes.codes.map((c) => c.code),
    )})\n` +
    `export const CAPABILITY_PATTERN = /^zone\\.[a-z-]+\\.[a-z-]+$/\n`
  stale = emit('zone-v1/codes.gen.js', codes, stale)

  // -- per-family entry points (index.gen.js pairs with index.gen.d.ts) -------
  for (const family of ['common/v1', 'auth/v1', 'runtime/v2']) {
    const members = Object.entries(schemasByFile).filter(([, doc]) => familyOf(doc) === family)
    const fnNames = members.map(([, doc]) => validatorName(doc)).join(', ')

    const js =
      header +
      `\nexport { ${fnNames} } from '../../validators.gen.js'\n` +
      (family === 'auth/v1' ? `export { KNOWN_ERROR_CODES, CAPABILITY_PATTERN } from '../../codes.gen.js'\n` : '')
    stale = emit(`zone-v1/${family}/index.gen.js`, js, stale)

    // Cross-family referenced interfaces (auth -> common's PrincipalRef/ResourceRef).
    const ownTitles = new Set(members.map(([, doc]) => doc.title))
    const crossTitlesByFamily = new Map()
    for (const [, doc] of members) {
      for (const prop of Object.values(doc.properties ?? {})) {
        const target = prop.$ref
          ? Object.values(schemasByFile).find((s) => s.$id === prop.$ref)
          : prop.items?.$ref
            ? Object.values(schemasByFile).find((s) => s.$id === prop.items.$ref)
            : null
        if (target && !ownTitles.has(target.title)) {
          const targetFamily = familyOf(target)
          const titles = crossTitlesByFamily.get(targetFamily) ?? new Set()
          titles.add(target.title)
          crossTitlesByFamily.set(targetFamily, titles)
        }
      }
    }
    const importLine = [...crossTitlesByFamily.entries()]
      .map(([targetFamily, titles]) =>
        `import type { ${[...titles].join(', ')} } from '../../${targetFamily}/index.gen.js'`)
      .join('\n') + (crossTitlesByFamily.size ? '\n\n' : '')
    const interfaces = members.map(([, doc]) => renderInterface(doc, schemasByFile)).join('\n\n')
    const fnDecls = members
      .map(([, doc]) => `export declare function ${validatorName(doc)}(data: unknown): data is ${doc.title}`)
      .join('\n')
    const dts =
      header +
      `\n` +
      importLine +
      interfaces +
      `\n\n` +
      fnDecls +
      `\n` +
      (family === 'auth/v1'
        ? `\nexport declare const KNOWN_ERROR_CODES: readonly string[]\nexport declare const CAPABILITY_PATTERN: RegExp\n`
        : '')
    stale = emit(`zone-v1/${family}/index.gen.d.ts`, dts, stale)
  }

  // -- materialized fixtures -----------------------------------------------------
  for (const [f, doc] of Object.entries(fixtures)) {
    stale = emit(`zone-v1/fixtures/${f.split('/')[0]}.gen.json`, JSON.stringify(doc, null, 2) + '\n', stale)
  }

  // -- materialized owner specs + projections ------------------------------------
  // The structured specs (charset/length/edges/reserved) are what the Rust
  // crate's build.rs reads; the projections are the compiled wire schemas the
  // bundle references. Materialized, digest-locked in the bundle, never edited.
  const zoneIdSpec = await fetchJson('nexi-lab', 'nexus-vfs', vfs.rev, vfs.specs['zone-id'])
  const zonePathSpec = await fetchJson('nexi-lab', 'nexus-vfs', vfs.rev, vfs.specs['zone-path'])
  stale = emit('zone-v1/projections.gen/zone-id-spec.json', JSON.stringify(zoneIdSpec, null, 2) + '\n', stale)
  stale = emit('zone-v1/projections.gen/zone-path-spec.json', JSON.stringify(zonePathSpec, null, 2) + '\n', stale)
  for (const [p, doc] of Object.entries(projections)) {
    stale = emit(`zone-v1/projections.gen/${p.split('/').pop()}`, JSON.stringify(doc, null, 2) + '\n', stale)
  }

  // -- schema bundle ----------------------------------------------------------------
  const bundle = {
    $comment: 'Generated by contracts/generate.mjs from the pin.json revisions — do not edit.',
    pin: {
      'nexus-vfs': vfs.rev,
      nexus: nx.rev,
      moss: moss.rev,
    },
    schemas: [...Object.values(schemasByFile), ...Object.values(projections)].map((doc) => ({
      $id: doc.$id,
      title: doc.title,
      sha256: sha256(JSON.stringify(doc)),
    })),
    error_codes: { $id: errorCodes.$id, sha256: sha256(JSON.stringify(errorCodes)) },
    moss_metadata_only: Object.fromEntries(
      Object.entries(mossSchemas).map(([p, doc]) => [p, { $id: doc.$id, sha256: sha256(JSON.stringify(doc)) }]),
    ),
  }
  stale = emit('zone-v1/schema-bundle.gen.json', JSON.stringify(bundle, null, 2) + '\n', stale)

  // -- provenance ----------------------------------------------------------------------
  const provenance = {
    $comment: 'Generated by contracts/generate.mjs — do not edit.',
    regenerate: 'node --use-env-proxy contracts/generate.mjs',
    generator: 'contracts/generate.mjs',
    owners: [
      {
        repo: 'https://github.com/nexi-lab/nexus-vfs',
        rev: vfs.rev,
        role: 'zone-id/zone-path projections (referenced by $id; rules never restated)',
        paths: vfs.projections,
      },
      {
        repo: 'https://github.com/nexi-lab/nexus',
        rev: nx.rev,
        role: 'product schemas + error codes + shared fixtures',
        paths: [...nx.schemas, nx.error_codes, `${nx.fixtures_dir}**`],
      },
      {
        repo: 'https://github.com/sudoprivacy/moss',
        rev: moss.rev,
        role: 'iam/v1 source metadata only — no public export derived (no cross-repo consumer)',
        paths: moss.schemas,
      },
    ],
    tools: { ajv: ajvVersion },
  }
  stale = emit('zone-v1/provenance.gen.json', JSON.stringify(provenance, null, 2) + '\n', stale)

  return stale
}

// ═══════════════════════════════ main ═══════════════════════════════

const spec = await fetchSpec(specs['zone-id'])
const vecs = vectors(spec)

let stale = 0
stale = emit('zone-id/zone-id.gen.ts', renderTs(spec), stale)
stale = emit('zone-id/vectors.gen.json', `${JSON.stringify(vecs, null, 2)}\n`, stale)
stale = emit('zone-id/EXAMPLES.gen.md', renderExamples(spec, vecs), stale)
stale = await deriveZoneV1(stale)

if (CHECK && stale > 0) {
  console.error(
    `\n${stale} derived file(s) do not match the pinned owner revisions.` +
      `\nRun \`node contracts/generate.mjs\` and commit the result.`,
  )
  process.exit(1)
}
console.log(stale === 0 ? 'up to date' : `${stale} file(s) regenerated`)
