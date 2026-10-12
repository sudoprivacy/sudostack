import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const lock = JSON.parse(readFileSync(join(root, 'source.lock.json'), 'utf8'))
const args = process.argv.slice(2)
const owner = args[args.indexOf('--owner') + 1]
if (!args.includes('--owner') || !owner) throw new Error('Pass --owner <Moss checkout>; reads the pinned commit, never the working tree')
const source = execFileSync('git', ['-C', owner, 'show', `${lock.revision}:${lock.path}`], { encoding: 'utf8' })
if (`sha256:${createHash('sha256').update(source).digest('hex')}` !== lock.digest) throw new Error('Semantic owner content digest mismatch')
const output = `// Derived from Moss ${lock.revision}:${lock.path}. DO NOT EDIT.\n${source}`
const target = join(root, 'contract.gen.ts')
if (args.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Generated contract is stale')
} else writeFileSync(target, output)
console.log('Experimental external-provider source provenance verified')
