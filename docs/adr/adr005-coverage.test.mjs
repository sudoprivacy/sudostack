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
  assert.equal(result.summary.coverage.complete, 3)
  assert.equal(result.summary.confirmed_deployment, 0)
  assert.ok(result.clauses.some(({ key }) => key === 'ADR005-WIRE-01'))
  assert.ok(result.clauses.some(({ obligation }) => obligation.includes('non-empty valid')))
  assert.ok(result.clauses.some(({ obligation }) => obligation.includes('联合评审显式改为 `Accepted`')))
  assert.ok(result.clauses.every(({ enforcement_tags }) => enforcement_tags.length === 1))
  assert.deepEqual(result.clauses.filter(({ enforcement_tags }) => enforcement_tags[0] !== 'none').map(({ key }) => key),
    ['ADR005-COMPAT-06', 'ADR005-DIST-01', 'ADR005-DIST-03'])
  assert.equal(result.summary.coverage.partial, 77)
  assert.equal(result.summary.coverage.none, 22)
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

test('reviewed clauses bind current obligations, targets and exact scope rather than ledger approval flags', () => {
  for (const original of ledger.rows.filter((row) => row.coverage === 'complete')) {
    const clause = collectAdr005Clauses(adrText).find((item) => item.key === original.key)
    const changedText = adrText.replace(clause.text, clause.text.replace(clause.obligation, `${clause.obligation} 另加未审核义务。`))
    assert.notEqual(changedText, adrText)
    const changed = clone(ledger)
    changed.rows.find((row) => row.key === original.key).source_fingerprint =
      collectAdr005Clauses(changedText).find((item) => item.key === original.key).source_fingerprint
    const result = checkCoverage({ adrText: changedText, ledger: changed })
    assert.ok(result.findings.some((item) => item.kind === 'review-binding' && item.key === original.key))
    assert.ok(!result.findings.some((item) => item.kind === 'stale-fingerprint' && item.key === original.key))

    const target = 'test:docs/adr/enforced-by.test.mjs'
    const retaggedText = adrText.replace(clause.text, clause.text.replace(original.enforcement_tag, target))
    const retagged = clone(ledger)
    const row = retagged.rows.find((item) => item.key === original.key)
    row.enforcement_tag = target
    row.source_fingerprint = collectAdr005Clauses(retaggedText).find((item) => item.key === original.key).source_fingerprint
    assert.ok(checkCoverage({ adrText: retaggedText, ledger: retagged }).findings.some((item) => item.kind === 'review-binding'))

    for (const mutate of [
      (value) => { value.implemented_scope = 'All consumers and all future releases are approved.' },
      (value) => { value.remaining_work = 'still missing a guard' },
      (value) => { value.dependency_classes = ['missing-real-consumer'] },
      (value) => { value.evidence_classification = 'Confirmed-Deployment' },
      (value) => { value.coverage = 'partial'; value.remaining_work = 'partial'; value.dependency_classes = ['offline'] },
    ]) {
      const forged = clone(ledger)
      mutate(forged.rows.find((item) => item.key === original.key))
      assert.ok(findings(forged).some((item) => ['review-binding', 'coverage-overclaim'].includes(item.kind)), original.key)
    }
  }
  const unaudited = clone(ledger)
  const other = unaudited.rows.find((row) => row.key === 'ADR005-SOURCE-02')
  Object.assign(other, { coverage: 'complete', remaining_work: '', dependency_classes: [], reviewed: true })
  assert.ok(kinds(unaudited).includes('coverage-overclaim'))
})

test('reviewed complete claims reject missing, unrelated or changed code test workflow and mutation evidence', () => {
  const reviewed = ledger.rows.find((row) => row.key === 'ADR005-COMPAT-06')
  for (const type of ['code', 'test', 'workflow', 'mutation']) {
    const changed = clone(ledger)
    const row = changed.rows.find((item) => item.key === reviewed.key)
    row.evidence_ids = row.evidence_ids.filter((id) => changed.evidence_catalog.find((item) => item.id === id).type !== type)
    assert.ok(findings(changed).some((item) => item.kind === 'coverage-overclaim' && item.message.includes(`missing ${type}`)))
  }
  for (const mutate of [
    (value) => { value.evidence_catalog.find((entry) => entry.id === 'successor-preflight').path = 'tools/contracts/compatibility.mjs' },
    (value) => { value.evidence_catalog.find((entry) => entry.id === 'moss-default-ci').revision = 'main' },
    (value) => { value.evidence_catalog.find((entry) => entry.id === 'moss-binding-test').claim = 'Unrelated future behavior' },
    (value) => { value.rows.find((row) => row.key === 'ADR005-DIST-01').evidence_ids.push('source-loader') },
  ]) {
    const changed = clone(ledger)
    mutate(changed)
    assert.ok(kinds(changed).includes('review-binding'))
  }
  for (const path of ['package.json', 'tools/contracts/successor-compatibility.mjs',
    'tools/contracts/successor-compatibility.test.mjs', 'tools/contracts/activation-0.2.1.mjs', 'tools/contracts/activation-0.2.1.test.mjs']) {
    for (const missing of [true, false]) {
      const result = checkCoverage({ adrText, ledger, readLocal: (name) => {
        if (name === path && missing) throw new Error('missing reviewed artifact')
        const bytes = readFileSync(join(REPO, name))
        return name === path ? Buffer.concat([bytes, Buffer.from('\n')]) : bytes
      } })
      assert.ok(result.findings.some((item) => item.kind === 'review-binding'), path)
    }
  }
})

for (const step of ['Exact Candidate2 and Moss repin evidence are remotely verified', 'The enforcement checker catches what it claims to']) {
  test(`quoted if cannot disable reviewed step: ${step}`, () => {
    const path = '.github/workflows/contracts.yml'
    const workflow = readFileSync(join(REPO, path), 'utf8')
    const changed = workflow.replace(`      - name: ${step}\n`, `      - name: ${step}\n        "if": false\n`)
    assert.notEqual(changed, workflow)
    const result = checkCoverage({ adrText, ledger, readLocal: (name) =>
      name === path ? Buffer.from(changed) : readFileSync(join(REPO, name)) })
    assert.ok(result.findings.some((item) => item.kind === 'broken-ci'))
  })
}

test('reviewed workflow snapshot binds Moss checkout, commands and shared environment', () => {
  const path = '.github/workflows/contracts.yml'
  const workflow = readFileSync(join(REPO, path), 'utf8')
  const moss = '      - name: Check out exact Moss enforcement targets\n' +
    '        uses: actions/checkout@v4\n        with:\n' +
    '          repository: sudoprivacy/moss\n' +
    '          ref: e9660ed1483cf01f96fe06c45ba7e070e0223ec3\n' +
    '          path: .enforcement/moss\n          persist-credentials: false\n'
  assert.ok(workflow.includes(moss))
  const command = '        run: node --test docs/adr/enforced-by.test.mjs'
  const sharedEnv = '    env:\n      SUDOSTACK_REPOS_ROOT: ${{ github.workspace }}/.enforcement\n'
  const brokenVariants = [
    workflow.replace(moss, ''),
    workflow.replace(moss, moss.replace('ref: e9660ed1483cf01f96fe06c45ba7e070e0223ec3', 'ref: main')),
    workflow.replace(moss, moss.replace('repository: sudoprivacy/moss', 'repository: sudoprivacy/sudostack') + '      # repository: sudoprivacy/moss\n'),
    workflow.replace(moss, moss.replace('path: .enforcement/moss', 'path: .enforcement/wrong') + '      # path: .enforcement/moss\n'),
    workflow.replace(moss, moss.replace('ref: e9660ed1483cf01f96fe06c45ba7e070e0223ec3', 'ref: main') +
      moss.replace('repository: sudoprivacy/moss', 'repository: sudoprivacy/sudostack').replace('path: .enforcement/moss', 'path: .enforcement/wrong')),
    workflow.replace(moss, moss + moss),
    workflow.replace(moss, moss.replace('        with:', '        if: false\n        with:')),
    workflow.replace(moss, moss.replace('persist-credentials: false', 'persist-credentials: true')),
    workflow.replace(sharedEnv, ''),
    workflow.replace(sharedEnv, sharedEnv.replace('/.enforcement', '/wrong')),
    workflow.replace(command, '        env:\n          SUDOSTACK_REPOS_ROOT: /wrong\n' + command),
    workflow.replace(command, '        env: {SUDOSTACK_REPOS_ROOT: /wrong}\n' + command),
    workflow.replace(command, '        env:\n          <<: *wrong-environment\n' + command),
    workflow.replace(command, '        if: false\n' + command),
    workflow.replace(command, '        continue-on-error: true\n' + command),
    workflow.replace(command, command.replace('run: node', 'run: echo node')),
    workflow.replace(moss, '') + moss,
    workflow.replace('      - name: Exact Candidate2 and Moss repin evidence are remotely verified\n',
      '      - name: Exact Candidate2 and Moss repin evidence are remotely verified\n        if: false\n'),
    workflow.replace('  pull_request:', '  workflow_dispatch:'),
    workflow.replace('  owner-source-availability:\n', '  owner-source-availability:\n    "if": false\n'),
    `${workflow}# Even a formatting-only change requires renewed review.\n`,
  ]
  for (const variant of brokenVariants) {
    assert.notEqual(variant, workflow)
    const result = checkCoverage({ adrText, ledger, readLocal: (name) =>
      name === path ? Buffer.from(variant) : readFileSync(join(REPO, name)) })
    assert.ok(result.findings.some((item) => item.kind === 'broken-ci'), variant)
  }
  const missing = checkCoverage({ adrText, ledger, readLocal: (name) => {
    if (name === path) throw new Error('missing workflow')
    return readFileSync(join(REPO, name))
  } })
  assert.ok(missing.findings.some((item) => item.kind === 'broken-ci'))
})

test('historical audit records all original mappings, manual rules and guide-block subobligations', () => {
  assert.ok(adrText.includes('822be533f82f9ee16e208e92730aebd709799b94'))
  const expectedLines = [96,153,157,208,209,211,215,233,259,267,268,269,270,271,272,273,277,278,279,280,281,282,300,339,347,383,412,449,450,489,598,615,620,686,705,711,798,866,868]
  const original = [...adrText.matchAll(/^\| O(\d{2}) \| (\d+) \//gm)].map((match) => [match[1], Number(match[2])])
  assert.deepEqual(original, expectedLines.map((line, index) => [String(index + 1).padStart(2, '0'), line]))
  assert.deepEqual([...adrText.matchAll(/^\| ([A-L]) \//gm)].map((match) => match[1]), [...'ABCDEFGHIJKL'])
  assert.deepEqual([...adrText.matchAll(/^\| K(\d{2}) \/ (\d+) \|/gm)].map((match) => [match[1], Number(match[2])]),
    Array.from({ length: 14 }, (_, index) => [String(index + 1).padStart(2, '0'), 831 + index]))
  assert.deepEqual([...adrText.matchAll(/^\| O(\d{2}) \//gm)].map((match) => match[1]), ['03','08','24','25','26','27','31','32','34','36'])
  assert.ok(adrText.includes('未决/未强制'))
  assert.ok(adrText.includes('digest 未被绕过'))
  assert.equal(ledger.rows.find((row) => row.key === 'ADR005-SOURCE-02').enforcement_tag, 'none')
  const offline = ledger.offline_next.find((item) => item.id === 'ADR005-OFFLINE-NETWORK-DENIED-SMOKE')
  assert.ok(!offline.clause_keys.includes('ADR005-DIST-03'))
  assert.ok(offline.clause_keys.includes('ADR005-DIST-06'))
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
