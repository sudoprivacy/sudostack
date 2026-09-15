#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { REPO } from './schema-lib.mjs'

const matrixPath = join(REPO, 'compatibility/consumers.yaml')
const matrix = readFileSync(matrixPath, 'utf8')
const failures = []

for (const name of ['moss', 'sudowork', 'sudocode', 'nexus']) {
  if (!new RegExp(`^  ${name}:`, 'm').test(matrix)) failures.push(`missing consumer ${name}`)
}
for (const family of ['common', 'zone-id']) {
  if (!matrix.includes(`${family}: [v1]`)) failures.push(`matrix must include ${family}: [v1] for at least one consumer`)
}

const reposRoot = process.env.SUDOSTACK_REPOS_ROOT
if (reposRoot) {
  const consumers = parseConsumers(matrix)
  for (const [name, consumer] of Object.entries(consumers)) {
    if (!consumer.base) failures.push(`${name} must declare a base branch`)
    if (!consumer.boundaryTests.length) failures.push(`${name} must declare at least one boundary test`)
    for (const testPath of consumer.boundaryTests) {
      const fullPath = resolve(reposRoot, name, testPath)
      if (!existsSync(fullPath)) failures.push(`${name} boundary test missing: ${testPath}`)
    }
  }

  const mossPkg = JSON.parse(readFileSync(resolve(reposRoot, 'moss/package.json'), 'utf8'))
  const dep = mossPkg.dependencies?.['@sudo/contracts'] ?? mossPkg.devDependencies?.['@sudo/contracts']
  if (!/^github:sudoprivacy\/sudostack#[0-9a-f]{40}$/i.test(dep ?? '')) {
    failures.push(`moss @sudo/contracts is not exact-pinned: ${JSON.stringify(dep)}`)
  }
}

if (failures.length) {
  console.error(`consumer matrix check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('consumer matrix ok')

function parseConsumers(text) {
  const out = {}
  let current = null
  let inBoundaryTests = false
  for (const line of text.split('\n')) {
    const consumer = line.match(/^  ([a-z0-9-]+):\s*$/)
    if (consumer) {
      current = consumer[1]
      out[current] = { base: null, boundaryTests: [] }
      inBoundaryTests = false
      continue
    }
    if (!current) continue
    const base = line.match(/^    base:\s*(\S+)\s*$/)
    if (base) {
      out[current].base = base[1]
      inBoundaryTests = false
      continue
    }
    if (/^    boundary_tests:\s*$/.test(line)) {
      inBoundaryTests = true
      continue
    }
    const item = line.match(/^      -\s*(\S+)\s*$/)
    if (inBoundaryTests && item) out[current].boundaryTests.push(item[1])
    else if (/^    \S/.test(line)) inBoundaryTests = false
  }
  return out
}
