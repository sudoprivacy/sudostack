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
 * Run: node --experimental-strip-types --test contracts/zone-id/conformance.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors.gen.json'), 'utf8'))

// Imported as TypeScript directly. Node strips the types (>=22.6 with
// --experimental-strip-types, on by default from 23), so the artifact under test
// is the very file consumers import — not a copy this test transformed.
//
// An earlier version stripped the annotations with regexes to avoid needing a
// flag. That was the wrong trade: the regexes broke the moment the package
// gained "type": "module", and a test that mangles its subject before checking
// it is testing something nobody ships.
const mod = await import('./zone-id.gen.ts')

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
