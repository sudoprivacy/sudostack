/**
 * The linter has to be able to fail, for the same reason the clauses do.
 *
 * A checker that passes everything is the most expensive kind of green: it
 * costs a CI minute and buys the belief that someone is watching. These
 * fixtures are the shapes it exists to catch — a clause with no answer, an
 * answer pointing at nothing, an answer nobody can check here — plus the ones
 * it must NOT catch, because a linter that cries wolf gets deleted.
 *
 * Run: node --test docs/adr/enforced-by.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { blocks, checkText, resolveTarget } from './enforced-by.mjs'

const kinds = (text) => checkText(text, 'FIXTURE.md').findings.map((f) => f.kind)
const counts = (text) => checkText(text, 'FIXTURE.md').counts

test('a normative clause with no answer is caught', () => {
  assert.deepEqual(kinds('- Session 必须有不可变 home_zone_id。'), ['untagged'])
  assert.deepEqual(kinds('- A consumer MUST NOT parse the id.'), ['untagged'])
})

test('an answer that points at nothing is a hard failure', () => {
  const findings = checkText(
    '- Zone id 必须 3–63 字符。`[enforced_by: const:contracts/zone-id/zone-id.gen.ts#NO_SUCH_CONST]`',
    'FIXTURE.md',
  ).findings
  assert.equal(findings.length, 1)
  assert.equal(findings[0].kind, 'broken')
  assert.match(findings[0].why, /NO_SUCH_CONST/)
})

test('a real artifact in this repo resolves', () => {
  const text =
    '- Zone id 必须 3–63 字符。`[enforced_by: const:contracts/zone-id/zone-id.gen.ts#ZONE_ID_MAX_LEN]`'
  assert.deepEqual(kinds(text), [])
  assert.equal(counts(text).verified, 1)
})

test('`none` is a legal answer and is counted, not waved through', () => {
  const text = '- 任何例外必须另写 ADR。`[enforced_by: none]`'
  assert.deepEqual(kinds(text), [])
  assert.equal(counts(text).none, 1)
})

test('an unreachable repository is "could not check", never "checked"', () => {
  const r = resolveTarget('test', 'no-such-repo-xyz@src/a.test.ts#name')
  assert.equal(r.state, 'unverifiable')
  // The distinction is the whole point: it must not read as verified...
  assert.notEqual(r.state, 'verified')
  // ...and it must not read as broken either, which would punish a checkout
  // for not containing another repository.
  assert.notEqual(r.state, 'broken')
})

test('a tag is resolved even where no keyword put it there', () => {
  // "长度 3–63" is as normative as anything in these documents and contains no
  // keyword. If a voluntary tag were ignored, its author would believe it was
  // checked — the exact failure this tool exists to prevent.
  const text = '- 长度 3–63；`[enforced_by: const:contracts/zone-id/zone-id.gen.ts#NOPE]`'
  assert.deepEqual(kinds(text), ['broken'])
})

test('a malformed or doubled answer is caught', () => {
  assert.deepEqual(kinds('- x 必须 y。`[enforced_by: probably-the-thing]`'), ['malformed'])
  assert.deepEqual(kinds('- x 必须 y。`[enforced_by: none]` `[enforced_by: file:package.json]`'), [
    'ambiguous',
  ])
})

test('prose that merely uses a keyword can say so', () => {
  const text = '这条不是风格偏好：失败必须与合法返回值可区分，是实测代价。`[not-normative]`'
  assert.deepEqual(kinds(text), [])
  assert.equal(counts(text).notNormative, 1)
})

test('code fences, headings and table rows are not clauses', () => {
  const text = [
    '## 2.4 Zone ID 必须稳定',
    '',
    '```yaml',
    'note: 必须 lives in this sample',
    '```',
    '',
    '| 条款 | 强制物 |',
    '|---|---|',
    '| §2.3 平台 pid MUST 不可解析 | none |',
  ].join('\n')
  assert.deepEqual(kinds(text), [])
})

test('a wrapped bullet is one clause, not two', () => {
  const text = [
    '- 每个 Attempt 必须固化 execution_zone_id，',
    '  并在恢复时沿用同一个 zone。',
    '  `[enforced_by: none]`',
  ].join('\n')
  assert.deepEqual(kinds(text), [])
  assert.equal(counts(text).none, 1, 'one bullet, one answer')
})

test('two bullets are two clauses and each owes an answer', () => {
  const text = ['- 第一条必须成立。`[enforced_by: none]`', '- 第二条必须成立。'].join('\n')
  assert.deepEqual(kinds(text), ['untagged'])
  assert.equal(blocks(text).length, 2)
})
