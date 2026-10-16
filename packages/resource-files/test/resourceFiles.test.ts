import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import JSZip from 'jszip'
import { ResourceFilesError, copyResourceDirectory, MAX_RESOURCE_ENTRIES, MAX_RESOURCE_FILE_BYTES, ownerFileMode,
  readResourceArchive, readResourceDirectory, writeResourceFiles } from '../src/index.js'

async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sudo-resource-files-'))
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()))
    assert(basename(root).startsWith('sudo-resource-files-'))
    await rm(root, { recursive: true, force: true })
  })
  return root
}

test('an executable survives ZIP extraction, directory copying and native execution with bounded owner permissions', async t => {
  const root = await fixture(t)
  const script = '#!/bin/sh\nprintf resource-ready\n'
  const zip = new JSZip()
  zip.file('SKILL.md', '# Fixture', { unixPermissions: 0o100644 })
  zip.file('scripts/run.sh', script, { unixPermissions: 0o107755 })
  zip.file('data.bin', Buffer.from([0, 128, 255]), { unixPermissions: 0o100644 })
  const files = await readResourceArchive(await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
  assert.equal(files.find(file => file.path === 'scripts/run.sh')?.mode, 0o700)
  assert.equal(files.find(file => file.path === 'SKILL.md')?.mode, 0o600)
  const unpacked = join(root, 'unpacked')
  const copied = join(root, 'copied')
  await writeResourceFiles(unpacked, files)
  await copyResourceDirectory(unpacked, copied)
  for (const directory of [unpacked, copied]) {
    assert.deepEqual(await readFile(join(directory, 'data.bin')), Buffer.from([0, 128, 255]))
    assert.equal(await readFile(join(directory, 'scripts/run.sh'), 'utf8'), script)
    if (process.platform !== 'win32') {
      assert.equal((await lstat(join(directory, 'scripts/run.sh'))).mode & 0o7777, 0o700)
      assert.equal((await lstat(join(directory, 'SKILL.md'))).mode & 0o7777, 0o600)
      assert.equal(execFileSync(join(directory, 'scripts/run.sh'), { encoding: 'utf8' }), 'resource-ready')
    }
  }
})

test('archive traversal and special file entries are refused before extraction', async () => {
  for (const path of ['../escape', '/outside', 'C:\\outside', 'a/../../escape', 'a\\..\\escape', 'file:stream',
    'NUL', 'aux.txt', 'nested/COM1.json', 'name.', 'name ', 'control\x1b']) {
    const zip = new JSZip().file(path, 'outside')
    await assert.rejects(readResourceArchive(await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })), /Unsafe resource entry path/)
  }
  for (const kind of [0o120000, 0o010000, 0o020000, 0o060000, 0o140000]) {
    const zip = new JSZip().file('special', 'outside', { unixPermissions: kind | 0o777 })
    await assert.rejects(readResourceArchive(await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })), /regular files or directories/)
  }
})

test('the complete file batch is validated before the first destination write', async t => {
  const root = await fixture(t)
  const target = join(root, 'unpublished')
  for (const files of [
    [{ path: 'valid', content: Buffer.from('valid'), mode: 0o600 }, { path: '../escape', content: Buffer.alloc(0), mode: 0o600 }],
    [{ path: 'same', content: Buffer.alloc(0), mode: 0o600 }, { path: './same', content: Buffer.alloc(0), mode: 0o600 }],
    [{ path: 'parent', content: Buffer.alloc(0), mode: 0o600 }, { path: 'parent/child', content: Buffer.alloc(0), mode: 0o600 }],
    [{ path: '.', content: Buffer.alloc(0), mode: 0o600 }],
  ]) {
    await assert.rejects(writeResourceFiles(target, files), ResourceFilesError)
    await assert.rejects(lstat(target), { code: 'ENOENT' })
  }
})

test('storage failures remain distinguishable from invalid resource input', async t => {
  const root = await fixture(t)
  const occupied = join(root, 'occupied')
  await writeFile(occupied, 'existing file')
  await assert.rejects(writeResourceFiles(occupied, [{ path: 'child', content: Buffer.from('data'), mode: 0o600 }]),
    error => error instanceof Error && !(error instanceof ResourceFilesError) && 'code' in error)
  assert.equal(await readFile(occupied, 'utf8'), 'existing file')
})

test('source and destination links cannot redirect a resource copy', async t => {
  const root = await fixture(t)
  const source = join(root, 'source'), outside = join(root, 'outside'), target = join(root, 'target')
  await mkdir(source); await mkdir(outside); await mkdir(target)
  await symlink(outside, join(source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readResourceDirectory(source), /symbolic links/)
  await symlink(outside, join(target, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(writeResourceFiles(target, [{ path: 'escape/file', content: Buffer.from('outside'), mode: 0o600 }]), /symbolic links/)
  await assert.rejects(lstat(join(outside, 'file')), { code: 'ENOENT' })
})

test('entry and file size limits fail before publication', async t => {
  const root = await fixture(t)
  const files = Array.from({ length: MAX_RESOURCE_ENTRIES + 1 }, (_, index) => ({ path: `entry-${index}`, content: Buffer.alloc(0), mode: 0o600 }))
  await assert.rejects(writeResourceFiles(join(root, 'entries'), files), /too many entries/)
  await assert.rejects(writeResourceFiles(join(root, 'large'), [{ path: 'large', content: Buffer.alloc(MAX_RESOURCE_FILE_BYTES + 1), mode: 0o600 }]), /size limit/)
  assert.equal(ownerFileMode(0o100010), 0o600, 'group executable must not grant owner execution')
  assert.throws(() => ownerFileMode(-1), /Invalid resource file mode/)
})
