#!/usr/bin/env node
/**
 * The gate for 总则 1: every normative clause in an ADR names what makes it
 * fail, and what it names has to be real.
 *
 * Without this, `enforced_by` is the thing it was invented to replace — a
 * sentence that reads like a rule and that nobody checks. A clause can claim
 * `test:moss@…#claims once` for a test that was renamed a month ago, and the
 * claim survives review by looking exactly like the true ones.
 *
 * What it does:
 *   1. walks docs/adr/ADR-*.md and splits each file into CLAUSE BLOCKS (one
 *      bullet or one paragraph — the unit a reader would call "a clause");
 *   2. flags every block containing a normative keyword (MUST / MUST NOT /
 *      SHOULD / SHALL / 必须 / 禁止 / 不得 / 应当);
 *   3. requires each flagged block to carry exactly one tag:
 *        `[enforced_by: <kind>:<target>]`   — names the artifact
 *        `[enforced_by: none]`              — nothing enforces it, on purpose
 *        `[not-normative]`                  — the keyword is prose, not a rule
 *   4. RESOLVES every artifact it can reach, and fails when one is missing.
 *
 * The three answers are all legal and all counted. `none` is not a failure —
 * it is the number 总则 1 exists to make countable, and it only means anything
 * because the OTHER two are verified. A tag that points at nothing would let
 * "enforced" drift back into prose, so that is the hard failure.
 *
 * Exit codes: 0 = clean, 1 = violations (or an unreadable baseline), 2 = usage.
 *
 *   node docs/adr/enforced-by.mjs              # check (what CI runs)
 *   node docs/adr/enforced-by.mjs --json       # same, machine-readable
 *   node docs/adr/enforced-by.mjs --strict     # also fail on unverifiable
 *   node docs/adr/enforced-by.mjs --update-baseline
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const BASELINE = join(HERE, 'enforced-by-baseline.json')

/**
 * Sibling repositories, for `<repo>@<path>` targets. sudostack is an assembly
 * repo: the artifacts most clauses point at live in moss / sudowork / nexus-vfs,
 * which are NOT checked out here. A target naming one of them is therefore
 * "unverifiable in this checkout" — reported and counted, never silently
 * treated as verified. Point this at a directory holding the sibling clones to
 * actually resolve them.
 */
const REPOS_ROOT = process.env.SUDOSTACK_REPOS_ROOT
  ? resolve(process.env.SUDOSTACK_REPOS_ROOT)
  : resolve(REPO, '..')

/**
 * A block containing one of these is a clause and owes an answer.
 *
 * The Chinese words are not optional: ADR-003 contains zero English MUST and
 * nineteen 必须. A keyword list that covered only RFC-2119 would report that
 * ADR as having no normative clauses at all — a green check that means nothing,
 * which is worse than no check.
 */
const NORMATIVE = [
  /\bMUST NOT\b/,
  /\bMUST\b/,
  /\bSHALL\b/,
  /\bSHOULD NOT\b/,
  /\bSHOULD\b/,
  /必须/,
  /禁止/,
  /不得/,
  /应当/,
]

const TAG_RE = /\[enforced_by:\s*([^\]]+)\]/g
const NOT_NORMATIVE_RE = /\[not-normative\]/

/** Every legal `enforced_by` kind, and how each one is resolved. */
const KINDS = {
  /** Nothing enforces this clause. Legal, and the point of the exercise. */
  none: null,
  /** The artifact is a whole file (a schema, a vector set, a workflow). */
  file: (path) => existsSync(path) && statSync(path).isFile(),
  /** A generated/exported constant: the shape is pinned by a value. */
  const: (path, symbol) => hasSymbol(path, symbol, ['const', 'let', 'var']),
  /** An exported type: the shape is pinned by the compiler. */
  type: (path, symbol) => hasSymbol(path, symbol, ['type', 'interface', 'enum', 'class']),
  /** A test: the behaviour is pinned by something that runs. */
  test: (path, name) => hasTest(path, name),
}

function hasSymbol(path, symbol, keywords) {
  if (!existsSync(path)) return false
  const src = readFileSync(path, 'utf8')
  if (!symbol) return true
  return keywords.some((kw) =>
    new RegExp(`(^|\\n)\\s*(export\\s+)?${kw}\\s+${escapeRe(symbol)}\\b`).test(src),
  )
}

function hasTest(path, name) {
  if (!existsSync(path)) return false
  if (!name) return true
  const src = readFileSync(path, 'utf8')
  // A test id is whatever the runner prints: `test('name')`, `it("name")`,
  // `#[test] fn name`, `def test_name`. Matching the literal is enough — the
  // point is that a rename breaks the claim, and any of these forms does.
  return src.includes(name)
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Resolve one target. Returns `verified`, `broken`, or `unverifiable` — three
 * states on purpose: "I checked and it is there", "I checked and it is not",
 * and "I could not check". Collapsing the third into either of the others is
 * the failure 总则 2 is about.
 */
export function resolveTarget(kind, target) {
  const [locator, symbol] = target.split('#')
  const at = locator.indexOf('@')
  if (at !== -1) {
    const repo = locator.slice(0, at)
    const rel = locator.slice(at + 1)
    const root = join(REPOS_ROOT, repo)
    if (!existsSync(root)) {
      return { state: 'unverifiable', why: `repository ${repo} is not in ${REPOS_ROOT}` }
    }
    return KINDS[kind](join(root, rel), symbol)
      ? { state: 'verified' }
      : { state: 'broken', why: `${repo}@${rel}${symbol ? `#${symbol}` : ''} not found` }
  }
  return KINDS[kind](join(REPO, locator), symbol)
    ? { state: 'verified' }
    : { state: 'broken', why: `${locator}${symbol ? `#${symbol}` : ''} not found` }
}

/**
 * Split a markdown file into clause blocks.
 *
 * Skipped, each for a reason:
 *   - fenced code — the ADRs are full of schema and path samples whose words
 *     are data, not rules;
 *   - headings — a heading is a name, not a clause;
 *   - table rows — the tables here are schemas, matrices and audit records
 *     that CITE clauses; the clause itself lives in the prose they cite, and
 *     flagging both would ask for the same answer twice.
 */
export function blocks(text) {
  const lines = text.split('\n')
  const out = []
  let current = null
  let fenced = false

  const flush = () => {
    if (current && current.text.trim()) out.push(current)
    current = null
  }

  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      flush()
      return
    }
    if (fenced) return
    if (/^\s*#/.test(line) || /^\s*\|/.test(line) || /^\s*-{3,}\s*$/.test(line)) {
      flush()
      return
    }
    if (!line.trim()) {
      flush()
      return
    }
    // A new list item starts a new clause; a continuation line joins the
    // current one, so a wrapped bullet stays ONE clause and needs ONE tag.
    const startsItem = /^\s*([-*+]|\d+\.)\s/.test(line)
    if (startsItem || !current) {
      flush()
      current = { line: i + 1, text: line }
    } else {
      current.text += '\n' + line
    }
  })
  flush()
  return out
}

function checkFile(path, name) {
  return checkText(readFileSync(path, 'utf8'), name)
}

/**
 * The whole check, over text rather than a path — so the tool's own tests can
 * hand it a three-line fixture instead of a repository.
 */
export function checkText(text, name) {
  const findings = []
  const counts = { verified: 0, none: 0, unverifiable: 0, notNormative: 0, untagged: 0 }

  for (const block of blocks(text)) {
    const normative = NORMATIVE.some((re) => re.test(block.text))
    const tags = [...block.text.matchAll(TAG_RE)].map((m) => m[1].trim())

    // Every tag is resolved, whether or not a keyword put it there. The
    // keyword list is a FLOOR, not a definition: §2.4's "长度 3–63" is as
    // normative as anything in these documents and contains no keyword at all.
    // So an author may tag any clause, and a tag that is ignored would be the
    // same lie this tool exists to catch — worse, a quiet one, since the
    // author believes it is checked.
    if (!normative && tags.length === 0) continue

    if (normative && NOT_NORMATIVE_RE.test(block.text)) {
      counts.notNormative++
      continue
    }

    if (tags.length === 0) {
      counts.untagged++
      findings.push({ file: name, line: block.line, kind: 'untagged', text: excerpt(block.text) })
      continue
    }
    if (tags.length > 1) {
      findings.push({
        file: name,
        line: block.line,
        kind: 'ambiguous',
        why: `${tags.length} enforced_by tags on one clause`,
        text: excerpt(block.text),
      })
      continue
    }

    const tag = tags[0]
    if (tag === 'none') {
      counts.none++
      continue
    }
    const colon = tag.indexOf(':')
    const kind = colon === -1 ? tag : tag.slice(0, colon)
    const target = colon === -1 ? '' : tag.slice(colon + 1).trim()
    if (!(kind in KINDS) || kind === 'none' || !target) {
      findings.push({
        file: name,
        line: block.line,
        kind: 'malformed',
        why: `expected none | ${Object.keys(KINDS).filter((k) => k !== 'none').join(' | ')}:<target>, got "${tag}"`,
        text: excerpt(block.text),
      })
      continue
    }

    const r = resolveTarget(kind, target)
    if (r.state === 'verified') counts.verified++
    else if (r.state === 'unverifiable') {
      counts.unverifiable++
      findings.push({ file: name, line: block.line, kind: 'unverifiable', why: r.why, text: excerpt(block.text) })
    } else {
      findings.push({ file: name, line: block.line, kind: 'broken', why: r.why, text: excerpt(block.text) })
    }
  }
  return { counts, findings }
}

const excerpt = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 90)

function main() {
  const args = new Set(process.argv.slice(2))
  const json = args.delete('--json')
  const strict = args.delete('--strict')
  const update = args.delete('--update-baseline')
  if (args.size) {
    console.error(`unknown argument: ${[...args].join(' ')}`)
    process.exit(2)
  }

  const files = readdirSync(HERE)
    .filter((f) => /^ADR-\d+.*\.md$/.test(f))
    .sort()
  if (files.length === 0) {
    console.error(`no ADR files under ${HERE} — the walker is looking in the wrong place`)
    process.exit(1)
  }

  const report = {}
  let findings = []
  for (const f of files) {
    const { counts, findings: fs } = checkFile(join(HERE, f), f)
    report[f] = counts
    findings = findings.concat(fs)
  }

  // The ratchet. Every clause written BEFORE this gate existed is untagged, and
  // tagging them means auditing what actually enforces each one — work only the
  // owner of that ADR can do honestly. So the baseline records today's untagged
  // count per file: it may fall, never rise. A new clause must answer for
  // itself on the day it is written, which is the only day the answer is cheap.
  const baseline = readBaseline()
  if (update) {
    const next = Object.fromEntries(files.map((f) => [f, report[f].untagged]))
    writeFileSync(BASELINE, JSON.stringify({ untagged: next }, null, 2) + '\n')
    console.log(`baseline updated: ${JSON.stringify(next)}`)
    return
  }

  const regressions = []
  for (const f of files) {
    const allowed = baseline.untagged[f] ?? 0
    if (report[f].untagged > allowed) {
      regressions.push(
        `${f}: ${report[f].untagged} untagged clauses, baseline allows ${allowed} ` +
          `(+${report[f].untagged - allowed} new)`,
      )
    }
  }

  const hard = findings.filter(
    (f) => f.kind === 'broken' || f.kind === 'malformed' || f.kind === 'ambiguous' || (strict && f.kind === 'unverifiable'),
  )

  if (json) {
    console.log(JSON.stringify({ report, findings, regressions }, null, 2))
  } else {
    print(report, findings, regressions, hard)
  }
  process.exit(hard.length || regressions.length ? 1 : 0)
}

function readBaseline() {
  if (!existsSync(BASELINE)) return { untagged: {} }
  try {
    const b = JSON.parse(readFileSync(BASELINE, 'utf8'))
    return { untagged: b.untagged ?? {} }
  } catch (e) {
    // A baseline that cannot be read is not an empty baseline: treating it as
    // one would silently forgive every untagged clause in the repo.
    console.error(`baseline ${BASELINE} is unreadable: ${e.message}`)
    process.exit(1)
  }
}

function print(report, findings, regressions, hard) {
  const total = { verified: 0, none: 0, unverifiable: 0, notNormative: 0, untagged: 0 }
  console.log('clause enforcement\n')
  for (const [file, c] of Object.entries(report)) {
    for (const k of Object.keys(total)) total[k] += c[k]
    console.log(
      `  ${file.padEnd(46)} verified ${String(c.verified).padStart(3)}  ` +
        `none ${String(c.none).padStart(3)}  unverifiable ${String(c.unverifiable).padStart(3)}  ` +
        `untagged ${String(c.untagged).padStart(3)}`,
    )
  }
  console.log(
    `\n  ${'TOTAL'.padEnd(46)} verified ${String(total.verified).padStart(3)}  ` +
      `none ${String(total.none).padStart(3)}  unverifiable ${String(total.unverifiable).padStart(3)}  ` +
      `untagged ${String(total.untagged).padStart(3)}`,
  )

  const soft = findings.filter((f) => f.kind === 'unverifiable' && !hard.includes(f))
  if (soft.length) {
    console.log(`\n  ${soft.length} clause(s) name an artifact this checkout cannot reach:`)
    for (const f of soft.slice(0, 10)) console.log(`    ${f.file}:${f.line}  ${f.why}`)
    if (soft.length > 10) console.log(`    … and ${soft.length - 10} more`)
    console.log('    (set SUDOSTACK_REPOS_ROOT to a directory holding the sibling clones to check them)')
  }

  if (hard.length) {
    console.log(`\nFAIL — ${hard.length} clause(s) name something that is not there:\n`)
    for (const f of hard) {
      console.log(`  ${f.file}:${f.line}  [${f.kind}] ${f.why ?? ''}`)
      console.log(`    ${f.text}`)
    }
  }
  if (regressions.length) {
    console.log('\nFAIL — new clauses without an enforced_by tag:\n')
    for (const r of regressions) console.log(`  ${r}`)
    console.log(
      '\n  Tag the new clause with [enforced_by: <kind>:<target>], [enforced_by: none],\n' +
        '  or [not-normative]. Lower the baseline by tagging old ones:\n' +
        '    node docs/adr/enforced-by.mjs --update-baseline',
    )
  }
  if (!hard.length && !regressions.length) console.log('\nOK')
}

// Importable (its own tests call `checkText` directly); runs when invoked.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
