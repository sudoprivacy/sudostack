#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { blocks, classifyBlock } from './enforced-by.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')
export const ADR_PATH = 'docs/adr/ADR-005-product-contract-versioning.md'
export const LEDGER_PATH = 'docs/adr/ADR-005-coverage.json'
export const VIEW_PATH = 'docs/adr/ADR-005-implementation-status.md'

const CLASSIFICATIONS = new Set([
  'Expected',
  'Confirmed-Code',
  'Confirmed-Deployment',
  'Inferred',
  'Conflicting',
  'Unknown',
  'Legacy-Declared',
])
const COVERAGE = new Set(['none', 'partial', 'complete'])
const DEPENDENCIES = new Set([
  'offline',
  'product-security-decision',
  'missing-real-consumer',
  'live-environment',
])
const EVIDENCE_TYPES = new Set([
  'code',
  'test',
  'workflow',
  'mutation',
  'document',
  'immutable-commit',
  'hosted-evidence',
  'live',
])
const LOCAL_EVIDENCE_TYPES = new Set(['code', 'test', 'workflow', 'mutation', 'document'])
const EXECUTABLE_EVIDENCE_TYPES = new Set([
  'code',
  'test',
  'workflow',
  'mutation',
  'immutable-commit',
  'hosted-evidence',
  'live',
])

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const safeRelativePath = (path) =>
  typeof path === 'string' &&
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.split('/').includes('..')

function normalizedBlockText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function obligationText(text) {
  return normalizedBlockText(text)
    .replace(/`?\[enforced_by:\s*[^\]]+\]`?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function namedClauseId(text) {
  return normalizedBlockText(text)
    .match(/^(?:\*\*)?(ADR005-[A-Z0-9]+-\d+)(?:\*\*)?[：:]/)?.[1] ?? null
}

function headingsByLine(text) {
  const headings = new Map()
  let section = ''
  let subsection = ''
  text.replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    const h2 = line.match(/^##\s+(.+)$/)
    const h3 = line.match(/^###\s+(.+)$/)
    if (h2) {
      section = h2[1].trim()
      subsection = ''
    } else if (h3) {
      subsection = h3[1].trim()
    }
    headings.set(index + 1, subsection ? `${section} / ${subsection}` : section)
  })
  return headings
}

export function collectAdr005Clauses(text) {
  const headings = headingsByLine(text)
  const clauses = []
  const keys = new Set()
  for (const block of blocks(text)) {
    const classification = classifyBlock(block.text)
    if (!classification.included || classification.exempt) continue
    const namedId = namedClauseId(block.text)
    const obligation = obligationText(block.text)
    const key = namedId ?? `ADR005-UNNAMED-${sha256(obligation)}`
    if (keys.has(key)) throw new Error(`duplicate ADR-005 clause key: ${key}`)
    keys.add(key)
    clauses.push({
      key,
      named: Boolean(namedId),
      line: block.line,
      section: headings.get(block.line) ?? '',
      text: normalizedBlockText(block.text),
      obligation,
      source_fingerprint: sha256(normalizedBlockText(block.text)),
      enforcement_tags: classification.tags,
    })
  }
  return clauses
}

function finding(kind, message, key) {
  return { kind, message, ...(key ? { key } : {}) }
}

function workflowJobSource(source, job) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((line) => line === `  ${job}:`)
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function normalizeRepository(value) {
  return String(value ?? '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
}

function attestationBindsEvidence(evidence, attestation) {
  if (evidence.attestation_kind === 'owner-source-lock') {
    if (evidence.attestation_path !== 'contracts/sources.lock.json') return false
    const entries = Object.values(attestation.repositories ?? {})
    const owner = entries.find((entry) =>
      normalizeRepository(entry.repository) === normalizeRepository(evidence.repository),
    )
    if (!owner || owner.revision !== evidence.revision) return false
    return Object.values(owner.files ?? {}).some((file) => file.path === evidence.path)
  }
  if (evidence.attestation_kind === 'consumer-activation') {
    if (evidence.attestation_path !== 'manifests/operations/0.2.1-activation-support.json') {
      return false
    }
    const consumer = attestation.consumer_evidence
    if (!consumer || consumer.repository !== evidence.repository) return false
    if (consumer.feature_revision !== evidence.revision) return false
    if (evidence.url !== undefined && consumer.pull_request !== evidence.url) return false
    const paths = new Set([
      ...(consumer.changed_paths ?? []).map(({ path }) => path),
      ...(consumer.preserved_boundary_paths ?? []).map(({ path }) => path),
      consumer.package_binding?.package_json_path,
      consumer.package_binding?.lockfile_path,
      consumer.package_binding?.installed_package_test_path,
      consumer.default_runner?.runner_path,
      consumer.default_runner?.server_workflow_path,
      consumer.default_runner?.lint_workflow_path,
    ].filter(Boolean))
    return paths.has(evidence.path)
  }
  return false
}

function validateEvidenceCatalog(ledger, readLocal) {
  const findings = []
  const catalog = new Map()
  for (const evidence of ledger.evidence_catalog ?? []) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      findings.push(finding('invalid-evidence', 'evidence entry must be an object'))
      continue
    }
    if (typeof evidence.id !== 'string' || !evidence.id) {
      findings.push(finding('invalid-evidence', 'evidence id is required'))
      continue
    }
    if (catalog.has(evidence.id)) {
      findings.push(finding('duplicate-evidence', `duplicate evidence id ${evidence.id}`))
      continue
    }
    catalog.set(evidence.id, evidence)
    if (!EVIDENCE_TYPES.has(evidence.type)) {
      findings.push(finding('invalid-evidence', `${evidence.id} has invalid type ${evidence.type}`))
    }
    if (typeof evidence.claim !== 'string' || !evidence.claim.trim()) {
      findings.push(finding('invalid-evidence', `${evidence.id} requires a bounded claim`))
    }
    if (LOCAL_EVIDENCE_TYPES.has(evidence.type)) {
      if (!safeRelativePath(evidence.path)) {
        findings.push(finding('invalid-reference', `${evidence.id} has unsafe local path`))
        continue
      }
      let bytes
      try {
        bytes = readLocal(evidence.path)
      } catch {
        findings.push(finding('broken-reference', `${evidence.id} missing local path ${evidence.path}`))
        continue
      }
      const source = bytes.toString('utf8')
      if (['test', 'mutation'].includes(evidence.type)) {
        if (typeof evidence.test_name !== 'string' || !source.includes(evidence.test_name)) {
          findings.push(finding('broken-reference', `${evidence.id} missing test ${evidence.test_name ?? ''}`))
        }
      }
      if (evidence.type === 'workflow') {
        const workflowSource = evidence.job ? workflowJobSource(source, evidence.job) : source
        if (evidence.job && workflowSource === null) {
          findings.push(finding('broken-reference', `${evidence.id} missing workflow job ${evidence.job}`))
        }
        if (!Array.isArray(evidence.contains) || evidence.contains.length === 0) {
          findings.push(finding('invalid-evidence', `${evidence.id} workflow requires contains assertions`))
        } else {
          for (const value of evidence.contains) {
            if (typeof value !== 'string' || !workflowSource?.includes(value)) {
              findings.push(finding('broken-reference', `${evidence.id} workflow job missing ${value}`))
            }
          }
        }
      }
      for (const value of evidence.contains ?? []) {
        if (evidence.type !== 'workflow' && (typeof value !== 'string' || !source.includes(value))) {
          findings.push(finding('broken-reference', `${evidence.id} source missing ${value}`))
        }
      }
    }
    if (['immutable-commit', 'hosted-evidence'].includes(evidence.type)) {
      if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(evidence.repository ?? '')) {
        findings.push(finding('invalid-reference', `${evidence.id} requires owner/repository`))
      }
      if (!/^[0-9a-f]{40}$/.test(evidence.revision ?? '')) {
        findings.push(finding('mutable-reference', `${evidence.id} requires a full immutable revision`))
      } else if (evidence.repository === 'sudoprivacy/sudostack') {
        try {
          execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${evidence.revision}^{commit}`], {
            stdio: 'ignore',
          })
          if (evidence.path !== undefined) {
            execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${evidence.revision}:${evidence.path}`], {
              stdio: 'ignore',
            })
          }
        } catch {
          findings.push(finding('broken-reference', `${evidence.id} immutable SudoStack object is unavailable`))
        }
      }
      if (evidence.path !== undefined && !safeRelativePath(evidence.path)) {
        findings.push(finding('invalid-reference', `${evidence.id} has unsafe cross-repo path`))
      }
      if (evidence.repository !== 'sudoprivacy/sudostack') {
        if (!safeRelativePath(evidence.attestation_path)) {
          findings.push(finding('invalid-reference', `${evidence.id} requires a local attestation_path`))
        } else {
          try {
            const attestation = JSON.parse(readLocal(evidence.attestation_path).toString('utf8'))
            if (!attestationBindsEvidence(evidence, attestation)) {
              findings.push(finding(
                'broken-reference',
                `${evidence.id} is not a coherent tuple in ${evidence.attestation_path}`,
              ))
            }
          } catch {
            findings.push(finding('broken-reference', `${evidence.id} missing or invalid attestation ${evidence.attestation_path}`))
          }
        }
      }
      if (evidence.url !== undefined && !/^https:\/\//.test(evidence.url)) {
        findings.push(finding('invalid-reference', `${evidence.id} URL must use HTTPS`))
      }
    }
    if (evidence.type === 'live' && typeof evidence.evidence_ref !== 'string') {
      findings.push(finding('invalid-evidence', `${evidence.id} live evidence requires evidence_ref`))
    }
  }
  return { catalog, findings }
}

export function checkCoverage({ adrText, ledger, readLocal = (path) => readFileSync(join(REPO, path)) }) {
  const findings = []
  const clauses = collectAdr005Clauses(adrText)
  const clauseByKey = new Map(clauses.map((clause) => [clause.key, clause]))
  if (ledger.ledger_version !== 1) findings.push(finding('invalid-ledger', 'ledger_version must be 1'))
  if (ledger.source?.path !== ADR_PATH) findings.push(finding('invalid-ledger', `source.path must be ${ADR_PATH}`))
  const actualStatus = adrText.match(/^- 状态：([^\n]+)$/m)?.[1]?.trim()
  if (ledger.source?.status !== actualStatus || actualStatus !== 'Proposed') {
    findings.push(finding('source-status', `ADR-005 status must remain Proposed, got ${actualStatus ?? 'missing'}`))
  }
  if (ledger.policy !== 'accounting_only_no_enforcement_promotion') {
    findings.push(finding('invalid-ledger', 'ledger policy must forbid enforcement promotion'))
  }
  const expectedCi = {
    workflow_path: '.github/workflows/contracts.yml',
    job: 'every-clause-names-what-enforces-it',
    fetch_depth: 0,
    test_command: 'node --test docs/adr/adr005-coverage.test.mjs',
    check_command: 'node docs/adr/adr005-coverage.mjs --check',
  }
  if (JSON.stringify(ledger.ci) !== JSON.stringify(expectedCi)) {
    findings.push(finding('invalid-ci', 'ledger CI configuration changed'))
  }
  try {
    const workflow = readLocal(expectedCi.workflow_path).toString('utf8')
    const job = workflowJobSource(workflow, expectedCi.job)
    if (!job) findings.push(finding('broken-ci', `missing workflow job ${expectedCi.job}`))
    else {
      for (const value of [
        'uses: actions/checkout@v4',
        'fetch-depth: 0',
        expectedCi.test_command,
        expectedCi.check_command,
      ]) {
        if (!job.includes(value)) findings.push(finding('broken-ci', `${expectedCi.job} missing ${value}`))
      }
    }
  } catch {
    findings.push(finding('broken-ci', `missing workflow ${expectedCi.workflow_path}`))
  }

  const { catalog, findings: evidenceFindings } = validateEvidenceCatalog(ledger, readLocal)
  findings.push(...evidenceFindings)
  const rows = Array.isArray(ledger.rows) ? ledger.rows : []
  const validRows = []
  const rowByKey = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.key !== 'string') {
      findings.push(finding('invalid-row', 'every row requires a key'))
      continue
    }
    validRows.push(row)
    if (rowByKey.has(row.key)) {
      findings.push(finding('duplicate-row', `duplicate ledger row ${row.key}`, row.key))
      continue
    }
    rowByKey.set(row.key, row)
  }
  for (const clause of clauses) {
    if (!rowByKey.has(clause.key)) findings.push(finding('missing-row', 'clause missing from ledger', clause.key))
  }
  for (const row of validRows) {
    if (!clauseByKey.has(row.key)) findings.push(finding('stale-row', 'ledger row has no current clause', row.key))
  }
  if (validRows.map(({ key }) => key).join('\n') !== clauses.map(({ key }) => key).join('\n')) {
    findings.push(finding('row-order', 'ledger rows must follow source clause order'))
  }

  const usedEvidence = new Set()
  for (const row of validRows) {
    const clause = clauseByKey.get(row.key)
    if (!clause) continue
    if (row.source_fingerprint !== clause.source_fingerprint) {
      findings.push(finding('stale-fingerprint', 'source fingerprint changed', row.key))
    }
    if (row.section !== clause.section) findings.push(finding('stale-section', 'source section changed', row.key))
    const sourceTag = clause.enforcement_tags.length === 1 ? clause.enforcement_tags[0] : null
    if (clause.enforcement_tags.length !== 1) {
      findings.push(finding('invalid-source-tag', 'source clause must have exactly one enforcement tag', row.key))
    }
    if (row.enforcement_tag !== sourceTag) {
      findings.push(finding('stale-enforcement', 'enforcement tag changed', row.key))
    }
    if (!CLASSIFICATIONS.has(row.evidence_classification)) {
      findings.push(finding('invalid-classification', `invalid evidence classification ${row.evidence_classification}`, row.key))
    }
    if (!COVERAGE.has(row.coverage)) {
      findings.push(finding('invalid-coverage', `invalid coverage ${row.coverage}`, row.key))
    }
    if (typeof row.implemented_scope !== 'string' || !row.implemented_scope.trim()) {
      findings.push(finding('invalid-scope', 'implemented_scope is required', row.key))
    }
    if (!Array.isArray(row.evidence_ids) || new Set(row.evidence_ids).size !== row.evidence_ids.length) {
      findings.push(finding('invalid-evidence', 'evidence_ids must be a unique array', row.key))
    }
    const rowEvidence = []
    for (const id of row.evidence_ids ?? []) {
      if (!catalog.has(id)) findings.push(finding('unknown-evidence', `unknown evidence id ${id}`, row.key))
      else {
        usedEvidence.add(id)
        rowEvidence.push(catalog.get(id))
      }
    }
    if (!Array.isArray(row.dependency_classes) || new Set(row.dependency_classes).size !== row.dependency_classes.length) {
      findings.push(finding('invalid-dependencies', 'dependency_classes must be a unique array', row.key))
    }
    for (const dependency of row.dependency_classes ?? []) {
      if (!DEPENDENCIES.has(dependency)) {
        findings.push(finding('invalid-dependencies', `invalid dependency ${dependency}`, row.key))
      }
    }
    if (row.coverage === 'complete') {
      findings.push(finding(
        'coverage-overclaim',
        'accounting-only policy requires a separate whole-clause review before complete coverage',
        row.key,
      ))
      if ((row.dependency_classes ?? []).length > 0) {
        findings.push(finding('coverage-overclaim', 'complete coverage cannot have remaining dependencies', row.key))
      }
      if (!['Confirmed-Code', 'Confirmed-Deployment'].includes(row.evidence_classification)) {
        findings.push(finding('coverage-overclaim', 'complete coverage requires confirmed evidence', row.key))
      }
      const types = new Set(rowEvidence.map(({ type }) => type))
      for (const required of ['code', 'test', 'workflow', 'mutation']) {
        if (!types.has(required)) findings.push(finding('coverage-overclaim', `complete coverage missing ${required} evidence`, row.key))
      }
      if (/partial|manual|pending|unknown/i.test(row.implemented_scope)) {
        findings.push(finding('coverage-overclaim', 'complete coverage describes partial/manual/pending scope', row.key))
      }
    } else {
      if (typeof row.remaining_work !== 'string' || !row.remaining_work.trim()) {
        findings.push(finding('invalid-remaining-work', 'non-complete row requires remaining_work', row.key))
      }
      if ((row.dependency_classes ?? []).length === 0) {
        findings.push(finding('invalid-dependencies', 'non-complete row requires a dependency class', row.key))
      }
    }
    if (row.evidence_classification === 'Confirmed-Code') {
      if (!rowEvidence.some(({ type }) => EXECUTABLE_EVIDENCE_TYPES.has(type))) {
        findings.push(finding('evidence-overclaim', 'Confirmed-Code requires executable or immutable evidence', row.key))
      }
    }
    if (row.evidence_classification === 'Confirmed-Deployment') {
      if (!rowEvidence.some(({ type }) => type === 'live')) {
        findings.push(finding('evidence-overclaim', 'Confirmed-Deployment requires live evidence', row.key))
      }
    }
    if (row.evidence_classification === 'Unknown' && row.coverage !== 'none') {
      findings.push(finding('coverage-overclaim', 'Unknown evidence cannot claim partial or complete coverage', row.key))
    }
  }
  for (const id of catalog.keys()) {
    if (!usedEvidence.has(id)) findings.push(finding('unused-evidence', `unused evidence ${id}`))
  }

  const priorities = new Set()
  for (const item of ledger.offline_next ?? []) {
    if (!Number.isInteger(item.priority) || item.priority < 1 || priorities.has(item.priority)) {
      findings.push(finding('invalid-offline-next', 'offline_next priorities must be unique positive integers'))
    }
    priorities.add(item.priority)
    if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.scope !== 'string') {
      findings.push(finding('invalid-offline-next', 'offline_next requires id, title, and scope'))
    }
    if (!Array.isArray(item.clause_keys) || item.clause_keys.length === 0) {
      findings.push(finding('invalid-offline-next', `${item.id ?? 'offline item'} requires clause_keys`))
    }
    for (const key of item.clause_keys ?? []) {
      if (!clauseByKey.has(key)) findings.push(finding('invalid-offline-next', `${item.id} references unknown ${key}`))
    }
  }

  const summary = {
    clauses: clauses.length,
    named: clauses.filter(({ named }) => named).length,
    unnamed: clauses.filter(({ named }) => !named).length,
    coverage: Object.fromEntries([...COVERAGE].map((value) => [value, validRows.filter((row) => row.coverage === value).length])),
    classifications: Object.fromEntries([...CLASSIFICATIONS].map((value) => [value, validRows.filter((row) => row.evidence_classification === value).length])),
    dependencies: Object.fromEntries([...DEPENDENCIES].map((value) => [
      value,
      validRows.filter((row) => row.dependency_classes?.includes(value)).length,
    ])),
    confirmed_deployment: validRows.filter((row) => row.evidence_classification === 'Confirmed-Deployment').length,
  }
  return { clauses, rows, catalog, summary, findings }
}

const md = (value) => String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

export function renderMarkdown({ ledger, result }) {
  const rowByKey = new Map(ledger.rows.map((row) => [row.key, row]))
  const lines = [
    '<!-- @generated by docs/adr/adr005-coverage.mjs; edit ADR-005-coverage.json, not this file. -->',
    '',
    '# ADR-005 implementation status',
    '',
    '> Accounting view only. ADR-005 remains `Proposed`; every source clause remains `[enforced_by: none]`.',
    '> A row can cite bounded code evidence without proving whole-clause enforcement, release, deployment, or acceptance.',
    '',
    '## Summary',
    '',
    `- Current parser-selected clauses: **${result.summary.clauses}** (${result.summary.named} named, ${result.summary.unnamed} unnamed).`,
    `- Coverage: **${result.summary.coverage.partial} partial**, **${result.summary.coverage.none} none**, **${result.summary.coverage.complete} complete**.`,
    `- Evidence classifications: **${result.summary.classifications['Confirmed-Code']} Confirmed-Code**, **${result.summary.classifications.Expected} Expected**, **${result.summary.classifications.Unknown} Unknown**, **${result.summary.classifications.Conflicting} Conflicting**.`,
    `- Remaining dependencies: **${result.summary.dependencies.offline} offline**, **${result.summary.dependencies['product-security-decision']} product/security decision**, **${result.summary.dependencies['missing-real-consumer']} missing real consumer**, **${result.summary.dependencies['live-environment']} live environment**.`,
    `- Confirmed-Deployment rows: **${result.summary.confirmed_deployment}**.`,
    '- Canonical machine-readable ledger: [`ADR-005-coverage.json`](./ADR-005-coverage.json).',
    '',
    '## Prioritized offline-next work',
    '',
  ]
  for (const item of [...ledger.offline_next].sort((a, b) => a.priority - b.priority)) {
    lines.push(`${item.priority}. **${md(item.title)}** (${md(item.id)}): ${md(item.scope)}`)
  }
  lines.push('', '## Clause ledger', '', '| Clause | Section | Evidence class | Evidence refs | Coverage | Dependencies | Implemented scope | Remaining work |', '|---|---|---|---|---|---|---|---|')
  for (const clause of result.clauses) {
    const row = rowByKey.get(clause.key)
    lines.push(
      `| \`${md(row.key)}\` | ${md(row.section)} | ${md(row.evidence_classification)} | ` +
      `${md(row.evidence_ids.map((id) => `\`${id}\``).join(', ') || 'none')} | ${md(row.coverage)} | ` +
      `${md(row.dependency_classes.join(', ') || 'none')} | ${md(row.implemented_scope)} | ${md(row.remaining_work)} |`,
    )
  }
  lines.push('', '## Evidence catalog', '', '| ID | Type | Reference | Bounded claim |', '|---|---|---|---|')
  for (const evidence of ledger.evidence_catalog) {
    const reference = evidence.repository
      ? `${evidence.repository}@${evidence.revision}${evidence.path ? `:${evidence.path}` : ''}` +
        `${evidence.attestation_path ? ` (attested by ${evidence.attestation_path})` : ''}`
      : evidence.path ?? evidence.evidence_ref
    lines.push(`| \`${md(evidence.id)}\` | ${md(evidence.type)} | \`${md(reference)}\` | ${md(evidence.claim)} |`)
  }
  return `${lines.join('\n')}\n`
}

export function checkGeneratedView(expected, actual) {
  return Buffer.from(expected).equals(Buffer.isBuffer(actual) ? actual : Buffer.from(actual))
}

function main() {
  const args = new Set(process.argv.slice(2))
  const write = args.delete('--write')
  const json = args.delete('--json')
  args.delete('--check')
  if (args.size > 0 || (write && json)) {
    console.error(`unsupported arguments: ${[...args].join(' ')}`)
    process.exit(2)
  }
  const adrText = readFileSync(join(REPO, ADR_PATH), 'utf8')
  const ledger = JSON.parse(readFileSync(join(REPO, LEDGER_PATH), 'utf8'))
  const result = checkCoverage({ adrText, ledger })
  if (result.findings.length > 0) {
    if (json) console.log(JSON.stringify({ summary: result.summary, findings: result.findings }, null, 2))
    else {
      console.error(`ADR-005 coverage FAIL — ${result.findings.length} finding(s)`)
      for (const item of result.findings) console.error(`  [${item.kind}] ${item.key ?? ''} ${item.message}`.trim())
    }
    process.exit(1)
  }
  const view = renderMarkdown({ ledger, result })
  if (write) {
    writeFileSync(join(REPO, VIEW_PATH), view)
    console.log(`wrote ${VIEW_PATH}: ${result.summary.clauses} clauses`)
    return
  }
  const actual = existsSync(join(REPO, VIEW_PATH)) ? readFileSync(join(REPO, VIEW_PATH)) : Buffer.alloc(0)
  if (!checkGeneratedView(view, actual)) {
    console.error(`ADR-005 coverage FAIL — stale generated view ${VIEW_PATH}`)
    process.exit(1)
  }
  if (json) console.log(JSON.stringify({ summary: result.summary, findings: [] }, null, 2))
  else console.log(`ADR-005 coverage OK: ${result.summary.clauses} clauses, ${result.summary.coverage.partial} partial, ${result.summary.coverage.none} none, ${result.summary.confirmed_deployment} deployed`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
