import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  ADR_PATH,
  LEDGER_PATH,
  REPO,
  checkCoverage,
  checkGeneratedView,
  collectAdr005Clauses,
  renderMarkdown,
} from './adr005-coverage.mjs'

const adrText = readFileSync(join(REPO, ADR_PATH), 'utf8')
const ledger = JSON.parse(readFileSync(join(REPO, LEDGER_PATH), 'utf8'))
const clone = (value) => structuredClone(value)
const findings = (value) => checkCoverage({ adrText, ledger: value }).findings
const kinds = (value) => findings(value).map(({ kind }) => kind)

test('current ADR-005 ledger covers the parser-derived clause universe exactly', () => {
  const result = checkCoverage({ adrText, ledger })
  assert.deepEqual(result.findings, [])
  assert.equal(result.summary.clauses, 102)
  assert.equal(result.summary.named, 59)
  assert.equal(result.summary.unnamed, 43)
  assert.equal(result.summary.coverage.complete, 0)
  assert.equal(result.summary.confirmed_deployment, 0)
  assert.ok(result.clauses.some(({ key }) => key === 'ADR005-WIRE-01'))
  assert.ok(result.clauses.some(({ obligation }) => obligation.includes('non-empty valid')))
  assert.ok(result.clauses.some(({ obligation }) => obligation.includes('联合评审显式改为 `Accepted`')))
  assert.ok(result.clauses.every(({ enforcement_tags }) => enforcement_tags.length === 1 && enforcement_tags[0] === 'none'))
})

test('coverage checker rejects missing, duplicate, stale, invalid, broken, mutable, and overclaim rows', () => {
  const missing = clone(ledger)
  missing.rows.pop()
  assert.ok(kinds(missing).includes('missing-row'))

  const duplicate = clone(ledger)
  duplicate.rows.push(clone(duplicate.rows[0]))
  assert.ok(kinds(duplicate).includes('duplicate-row'))

  const stale = clone(ledger)
  stale.rows[0].source_fingerprint = '0'.repeat(64)
  assert.ok(kinds(stale).includes('stale-fingerprint'))

  const invalidStatus = clone(ledger)
  invalidStatus.rows[0].evidence_classification = 'Done'
  assert.ok(kinds(invalidStatus).includes('invalid-classification'))

  const broken = clone(ledger)
  broken.evidence_catalog.find(({ id }) => id === 'source-lock').path = 'missing/source-lock.json'
  assert.ok(kinds(broken).includes('broken-reference'))

  const mutable = clone(ledger)
  mutable.evidence_catalog.find(({ id }) => id === 'nexus-vfs-owner').revision = 'main'
  assert.ok(kinds(mutable).includes('mutable-reference'))

  const missingCommit = clone(ledger)
  missingCommit.evidence_catalog.find(({ id }) => id === 'content-c').revision = '0'.repeat(40)
  assert.ok(kinds(missingCommit).includes('broken-reference'))

  const missingExternalCommit = clone(ledger)
  missingExternalCommit.evidence_catalog.find(({ id }) => id === 'nexus-vfs-owner').revision = '0'.repeat(40)
  assert.ok(kinds(missingExternalCommit).includes('broken-reference'))

  const missingExternalPath = clone(ledger)
  missingExternalPath.evidence_catalog.find(({ id }) => id === 'moss-consumer').path = 'src/server/no-such-test.ts'
  assert.ok(kinds(missingExternalPath).includes('broken-reference'))

  const invalidRow = clone(ledger)
  invalidRow.rows[0] = null
  assert.ok(kinds(invalidRow).includes('invalid-row'))

  const wrongStatus = checkCoverage({
    adrText: adrText.replace('- 状态：Proposed', '- 状态：Accepted'),
    ledger,
  })
  assert.ok(wrongStatus.findings.some(({ kind }) => kind === 'source-status'))

  const invalidCi = clone(ledger)
  invalidCi.ci.fetch_depth = 1
  assert.ok(kinds(invalidCi).includes('invalid-ci'))

  const workflowPath = '.github/workflows/contracts.yml'
  const workflow = readFileSync(join(REPO, workflowPath), 'utf8')
  const shallowWorkflow = workflow.replace(
    /(  every-clause-names-what-enforces-it:[\s\S]*?uses: actions\/checkout@v4)\n        with:\n          fetch-depth: 0/,
    '$1',
  )
  assert.notEqual(shallowWorkflow, workflow)
  const shallowResult = checkCoverage({
    adrText,
    ledger,
    readLocal: (path) => Buffer.from(path === workflowPath ? shallowWorkflow : readFileSync(join(REPO, path))),
  })
  assert.ok(shallowResult.findings.some(({ kind }) => kind === 'broken-ci'))

  const unknownEvidence = clone(ledger)
  unknownEvidence.rows[0].evidence_ids.push('no-such-evidence')
  assert.ok(kinds(unknownEvidence).includes('unknown-evidence'))

  const overclaim = clone(ledger)
  overclaim.rows[0] = {
    ...overclaim.rows[0],
    evidence_classification: 'Confirmed-Code',
    coverage: 'complete',
    implemented_scope: 'partial manual evidence pending live confirmation',
    evidence_ids: ['source-loader', 'source-mutations', 'contracts-workflow', 'generated-drift'],
    remaining_work: '',
    dependency_classes: ['live-environment'],
  }
  assert.ok(kinds(overclaim).includes('coverage-overclaim'))
})

test('external attestations reject coherent-looking tuple swaps and unsupported attestations', () => {
  const nexusVfs = ledger.evidence_catalog.find(({ id }) => id === 'nexus-vfs-owner')
  const nexus = ledger.evidence_catalog.find(({ id }) => id === 'nexus-owner')
  const content = ledger.evidence_catalog.find(({ id }) => id === 'content-c')

  const assertTupleFailure = (id, mutate) => {
    const changed = clone(ledger)
    const evidence = changed.evidence_catalog.find((entry) => entry.id === id)
    mutate(evidence)
    const expected = `${id} is not a coherent tuple in ${evidence.attestation_path}`
    const matches = findings(changed).filter((item) =>
      item.kind === 'broken-reference' && item.message === expected,
    )
    assert.equal(matches.length, 1, `${id}: ${expected}`)
  }

  assertTupleFailure('nexus-vfs-owner', (evidence) => {
    evidence.revision = nexus.revision
  })
  assertTupleFailure('nexus-vfs-owner', (evidence) => {
    evidence.path = nexus.path
  })
  assertTupleFailure('nexus-vfs-owner', (evidence) => {
    evidence.repository = nexus.repository
  })
  assertTupleFailure('moss-consumer', (evidence) => {
    evidence.revision = content.revision
  })
  assertTupleFailure('nexus-vfs-owner', (evidence) => {
    evidence.attestation_path = 'docs/adr/ADR-005-coverage.json'
  })
  assertTupleFailure('nexus-vfs-owner', (evidence) => {
    evidence.attestation_kind = 'free-text-presence'
  })

  assert.equal(nexusVfs.revision, '24f6730ec90fab8a035b2f5400ed313bda343fbe')
})

test('clause keys survive reflow while named text changes invalidate fingerprints', () => {
  const wrapped = collectAdr005Clauses('- x 必须 y，\n  并且 z。`[enforced_by: none]`')[0]
  const reflowed = collectAdr005Clauses('- x 必须 y， 并且 z。`[enforced_by: none]`')[0]
  assert.equal(wrapped.key, reflowed.key)
  assert.equal(wrapped.source_fingerprint, reflowed.source_fingerprint)

  const changedText = adrText.replace('每个跨仓定义的 canonical editable source', '每一个跨仓定义的 canonical editable source')
  const before = collectAdr005Clauses(adrText).find(({ key }) => key === 'ADR005-SOURCE-01')
  const after = collectAdr005Clauses(changedText).find(({ key }) => key === 'ADR005-SOURCE-01')
  assert.equal(before.key, after.key)
  assert.notEqual(before.source_fingerprint, after.source_fingerprint)
})

test('duplicate unnamed canonical obligations fail instead of gaining ordinal identities', () => {
  const text = [
    '- x 必须 y。`[enforced_by: none]`',
    '- x 必须 y。`[enforced_by: none]`',
  ].join('\n')
  assert.throws(() => collectAdr005Clauses(text), /duplicate ADR-005 clause key/)
})

test('generated Markdown view is deterministic and byte-checkable', () => {
  const result = checkCoverage({ adrText, ledger })
  assert.deepEqual(result.findings, [])
  const first = renderMarkdown({ ledger, result })
  const second = renderMarkdown({ ledger, result })
  assert.equal(first, second)
  assert.equal(first.endsWith('\n'), true)
  assert.equal(first.endsWith('\n\n'), false)
  assert.equal(checkGeneratedView(first, Buffer.from(first)), true)
  assert.equal(checkGeneratedView(first, Buffer.from(`${first}stale\n`)), false)
})
