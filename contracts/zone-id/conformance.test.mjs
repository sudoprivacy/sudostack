/**
 * The TypeScript validator must agree with the vectors derived from the spec.
 *
 * Deriving both sides from one file makes the *rule data* impossible to drift.
 * It does not make the *logic* impossible to drift: two languages are two
 * implementations, and one of them can forget the leading-separator case while
 * still reading the same constants. These vectors are what catches that, which
 * is why they are generated from the spec rather than written here — a
 * hand-written case list can only test rules its author remembered.
 *
 * Run: node --test contracts/zone-id/conformance.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors.gen.json'), 'utf8'))

// The generated artifact is TypeScript for consumers; here only its runtime
// behaviour is under test, so the type annotations are stripped rather than
// compiled. Keeps this repository free of a TypeScript toolchain for one file.
const src = readFileSync(join(HERE, 'zone-id.gen.ts'), 'utf8')
const js = src
  .replace(/^export type ZoneIdRefusal[\s\S]*?\n\n/m, '')
  .replace(/: ZoneIdRefusal \| null/g, '')
  .replace(/\(id: string\)/g, '(id)')
  .replace(/\(r: ZoneIdRefusal\): string/g, '(r)')
const mod = await import(`data:text/javascript,${encodeURIComponent(js)}`)

test('the generated validator agrees with every vector', () => {
  assert.ok(vectors.length > 0, 'vectors.gen.json is empty — the generator produced nothing to check')
  for (const v of vectors) {
    const refusal = mod.validateZoneId(v.id)
    assert.equal(
      refusal === null,
      v.valid,
      `${v.why}: ${JSON.stringify(v.id)} should be ${v.valid ? 'accepted' : 'refused'}, ` +
        `got ${refusal ? mod.describeRefusal(refusal) : 'accepted'}`,
    )
  }
})

test('both outcomes are represented, so agreement means something', () => {
  // A vector set that is all-valid would be satisfied by a validator that never
  // refuses, and all-invalid by one that always does.
  assert.ok(vectors.some((v) => v.valid), 'no accepting vectors')
  assert.ok(vectors.some((v) => !v.valid), 'no refusing vectors')
})

test('a refusal says what to change', () => {
  const refusal = mod.validateZoneId('Has-Upper')
  assert.ok(refusal, 'uppercase must be refused')
  const msg = mod.describeRefusal(refusal)
  assert.match(msg, /position 0/, msg)
  assert.match(msg, /H/, msg)
})
