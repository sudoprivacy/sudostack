#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REPO, listFiles, readJson, schemaFiles, stableJson } from './schema-lib.mjs'

const BASELINE_ROOT = join(REPO, 'compatibility/baseline-schemas')
const UPDATE = process.argv.includes('--update-baseline')
const failures = []
const currentPaths = schemaFiles()
const currentRels = new Set(currentPaths.map((path) => path.slice(join(REPO, 'schemas').length + 1)))

for (const baselinePath of listFiles(BASELINE_ROOT, (path) => path.endsWith('.schema.json'))) {
  const rel = baselinePath.slice(BASELINE_ROOT.length + 1)
  if (!currentRels.has(rel)) failures.push(`${rel}: schema removed`)
}

for (const currentPath of currentPaths) {
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

export function breakingChanges(previous, current, path = '$') {
  const out = []
  if (previous.type === undefined && current.type !== undefined) out.push(`${path}: type added`)
  if (previous.type !== current.type) out.push(`${path}: type changed from ${previous.type} to ${current.type}`)
  if ('const' in previous && previous.const !== current.const) out.push(`${path}: const changed`)
  if (!previous.enum && current.enum) out.push(`${path}: enum added`)
  if (previous.enum && current.enum) {
    for (const value of previous.enum) {
      if (!current.enum.includes(value)) out.push(`${path}: enum value removed ${JSON.stringify(value)}`)
    }
  }
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
  if (current.minLength !== undefined && (previous.minLength === undefined || current.minLength > previous.minLength)) {
    out.push(`${path}: minLength tightened`)
  }
  if (current.maxLength !== undefined && (previous.maxLength === undefined || current.maxLength < previous.maxLength)) {
    out.push(`${path}: maxLength tightened`)
  }
  if (previous.pattern !== current.pattern && current.pattern !== undefined) {
    out.push(`${path}: pattern changed`)
  }
  if (previous.format !== current.format && current.format !== undefined) out.push(`${path}: format changed`)
  if (previous.$ref !== current.$ref && current.$ref !== undefined) out.push(`${path}: $ref changed`)
  if (current.minimum !== undefined && (previous.minimum === undefined || current.minimum > previous.minimum)) {
    out.push(`${path}: minimum tightened`)
  }
  if (current.maximum !== undefined && (previous.maximum === undefined || current.maximum < previous.maximum)) {
    out.push(`${path}: maximum tightened`)
  }
  if (previous.items || current.items) {
    if (!previous.items && current.items) out.push(`${path}: array item constraint added`)
    else if (previous.items && !current.items) {
      // Removing an item constraint widens accepted payloads.
    } else {
      out.push(...breakingChanges(previous.items, current.items, `${path}[]`))
    }
  }
  return out
}
