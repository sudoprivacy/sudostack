import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLocalGitBlob, requireFullCommitSha, sha256 } from '../../../tools/contracts/source.mjs'

const root = dirname(fileURLToPath(import.meta.url))
export const ownerRoot = 'src/nexus/contracts/schemas/agent-registry/v1alpha1/'
export const files = ['contract.gen.ts', 'schema.json', 'signed-version.fixture.json']
export function validateLock(lock) {
  requireFullCommitSha(lock.revision, 'Nexus product Registry revision')
  if (lock.repository !== 'https://github.com/nexi-lab/nexus' || lock.semanticOwner !== 'nexus'
    || lock.maturity !== 'experimental-registration-authority' || lock.apiVersion !== 'agent-registry.sudo.dev/v1alpha1'
    || JSON.stringify(Object.keys(lock.files ?? {}).sort()) !== JSON.stringify(files.map(file => ownerRoot + file).sort())) throw new Error('Invalid Registry source identity')
  for (const file of files) if (lock.files[ownerRoot + file]?.output !== file || !/^sha256:[a-f0-9]{64}$/.test(lock.files[ownerRoot + file]?.digest ?? '')) throw new Error('Invalid Registry source file')
}
export function verifySource(lock, file, content) {
  validateLock(lock)
  if (!files.includes(file) || `sha256:${sha256(content)}` !== lock.files[ownerRoot + file].digest) throw new Error('Registry source digest mismatch')
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
        if (readFileSync(join(root, file), 'utf8') !== source) throw new Error(`Stale Registry artifact: ${file}`)
      } else writeFileSync(join(root, file), source)
    }
  } finally {
    if (previous === undefined) delete process.env.SUDOSTACK_REPOS_ROOT
    else process.env.SUDOSTACK_REPOS_ROOT = previous
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--owner')
  if (index < 0 || !process.argv[index + 1]) throw new Error('Pass --owner <Nexus checkout>')
  generate(process.argv[index + 1], process.argv.includes('--check'))
}
