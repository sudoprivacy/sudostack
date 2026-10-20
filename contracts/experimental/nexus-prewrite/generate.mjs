import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLocalGitBlob, requireFullCommitSha, sha256 } from '../../../tools/contracts/source.mjs'

const root = dirname(fileURLToPath(import.meta.url))
export const ownerRoot = 'rust/transport/contracts/pre-write-rejection.v1/'
export const files = ['schema.json', 'fixture.json']
export function validateLock(lock) {
  requireFullCommitSha(lock.revision, 'Nexus VFS pre-write rejection revision')
  if (lock.repository !== 'https://github.com/nexi-lab/nexus-vfs' || lock.semanticOwner !== 'nexus-vfs'
    || lock.maturity !== 'experimental-pre-write-rejection' || lock.apiVersion !== 'nexus-pre-write-rejection/v1'
    || JSON.stringify(Object.keys(lock.files ?? {}).sort()) !== JSON.stringify(files.map(file => ownerRoot + file).sort())) throw new Error('Invalid pre-write rejection source identity')
  for (const file of files) if (lock.files[ownerRoot + file]?.output !== file || !/^sha256:[a-f0-9]{64}$/.test(lock.files[ownerRoot + file]?.digest ?? '')) throw new Error('Invalid pre-write rejection source file')
}
export function verifySource(lock, file, content) {
  validateLock(lock)
  if (!files.includes(file) || `sha256:${sha256(content)}` !== lock.files[ownerRoot + file].digest) throw new Error('pre-write rejection source digest mismatch')
  if (content.includes('\r') || !content.endsWith('\n')) throw new Error('Owner artifacts must use LF and final newline')
  return content
}
export function generate(owner, check = false) {
  const lock = JSON.parse(readFileSync(join(root, 'source.lock.json'), 'utf8'))
  validateLock(lock)
  const previous = process.env.SUDOSTACK_REPOS_ROOT
  try {
    process.env.SUDOSTACK_REPOS_ROOT = dirname(resolve(owner))
    for (const file of files) {
      const source = readLocalGitBlob({ ...lock, checkout: basename(resolve(owner)) }, ownerRoot + file).toString('utf8')
      verifySource(lock, file, source)
      if (check) {
        if (readFileSync(join(root, file), 'utf8') !== source) throw new Error(`Stale pre-write rejection artifact: ${file}`)
      } else writeFileSync(join(root, file), source)
    }
  } finally {
    if (previous === undefined) delete process.env.SUDOSTACK_REPOS_ROOT
    else process.env.SUDOSTACK_REPOS_ROOT = previous
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--owner')
  if (index < 0 || !process.argv[index + 1]) throw new Error('Pass --owner <nexus-vfs checkout>')
  generate(process.argv[index + 1], process.argv.includes('--check'))
}
