#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REPO, readJson, schemaFiles, stableJson } from './schema-lib.mjs'

const BASELINE_ROOT = join(REPO, 'compatibility/baseline-schemas')
const UPDATE = process.argv.includes('--update-baseline')
const failures = []

for (const currentPath of schemaFiles()) {
  const rel = currentPath.slice(join(REPO, 'schemas').length + 1)
  const baselinePath = join(BASELINE_ROOT, rel)
  const current = readJson(currentPath)
  if (!existsSync(baselinePath)) {
    if (UPDATE) {
      mkdirSync(dirname(baselinePath), { recursive: true })
      writeFileSync(baselinePath, stableJson(current))
      continue
    }
    failures.push(`${rel}: missing compatibility baseline`)
    continue
  }
  const previous = JSON.parse(readFileSync(baselinePath, 'utf8'))
  failures.push(...breakingChanges(previous, current).map((msg) => `${rel}: ${msg}`))
}

if (failures.length) {
  console.error(`compatibility check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('compatibility ok')

function breakingChanges(previous, current, path = '$') {
  const out = []
  if (previous.type !== current.type) out.push(`${path}: type changed from ${previous.type} to ${current.type}`)
  if ('const' in previous && previous.const !== current.const) out.push(`${path}: const changed`)
  if (previous.additionalProperties !== false && current.additionalProperties === false) {
    out.push(`${path}: additionalProperties tightened`)
  }
  if (previous.required || current.required) {
    const prev = new Set(previous.required ?? [])
    for (const req of current.required ?? []) {
      if (!prev.has(req)) out.push(`${path}: new required property ${req}`)
    }
  }
  const prevProps = previous.properties ?? {}
  const curProps = current.properties ?? {}
  for (const key of Object.keys(prevProps)) {
    if (!(key in curProps)) out.push(`${path}.${key}: property removed`)
    else out.push(...breakingChanges(prevProps[key], curProps[key], `${path}.${key}`))
  }
  if (previous.minLength !== undefined && current.minLength !== undefined && current.minLength > previous.minLength) {
    out.push(`${path}: minLength tightened`)
  }
  if (previous.maxLength !== undefined && current.maxLength !== undefined && current.maxLength < previous.maxLength) {
    out.push(`${path}: maxLength tightened`)
  }
  if (previous.pattern && current.pattern && previous.pattern !== current.pattern) {
    out.push(`${path}: pattern changed`)
  }
  return out
}
