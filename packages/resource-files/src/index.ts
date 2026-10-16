import { chmod, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { Readable } from 'node:stream'
import JSZip from 'jszip'

export const RESOURCE_FILES_FORMAT_VERSION = 1
export const MAX_RESOURCE_ENTRIES = 5000
export const MAX_RESOURCE_FILE_BYTES = 50 * 1024 * 1024
export const MAX_RESOURCE_BYTES = 200 * 1024 * 1024

/** Invalid resource input; filesystem I/O errors retain their native identity. */
export class ResourceFilesError extends Error {
  override name = 'ResourceFilesError'
}

export interface ResourceFile {
  path: string
  content: Buffer
  mode: number
  isDirectory?: boolean
}

/** Keep owner read/write and the source's owner executable bit. */
export function ownerFileMode(mode: number = 0): number {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o177777) throw new ResourceFilesError('Invalid resource file mode')
  return mode & 0o100 ? 0o700 : 0o600
}

function resourcePath(value: string): string {
  if (typeof value !== 'string') throw new ResourceFilesError('Unsafe resource entry path')
  const path = value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  if (!path || path.length > 4096 || path.startsWith('/') || /[:\0]/.test(path) || path.split('/').includes('..')) {
    throw new ResourceFilesError('Unsafe resource entry path')
  }
  const normalized = posix.normalize(path)
  if (normalized === '.' || normalized.split('/').length > 33) throw new ResourceFilesError('Unsafe resource entry path')
  if (normalized.split('/').some(part => /[<>"|?*\x00-\x1f\x7f]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new ResourceFilesError('Unsafe resource entry path')
  }
  return normalized
}

function validateFiles(files: readonly ResourceFile[]): ResourceFile[] {
  if (files.length > MAX_RESOURCE_ENTRIES) throw new ResourceFilesError('Resource has too many entries')
  let bytes = 0
  const paths = new Set<string>()
  const validated = files.map(file => {
    const path = resourcePath(file.path)
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (paths.has(key)) throw new ResourceFilesError('Duplicate resource entry path')
    paths.add(key)
    if (file.isDirectory !== undefined && typeof file.isDirectory !== 'boolean') throw new ResourceFilesError('Invalid resource entry type')
    if (file.isDirectory && path.split('/').length > 32) throw new ResourceFilesError('Resource directory nesting exceeds limit')
    if (!Buffer.isBuffer(file.content) || file.content.length > MAX_RESOURCE_FILE_BYTES) throw new ResourceFilesError('Resource file exceeds size limit')
    bytes += file.content.length
    if (bytes > MAX_RESOURCE_BYTES) throw new ResourceFilesError('Resource exceeds size limit')
    return { ...file, path, mode: file.isDirectory ? 0o700 : ownerFileMode(file.mode) }
  })
  const kinds = new Map(validated.map(file => [process.platform === 'win32' ? file.path.toLowerCase() : file.path, file.isDirectory]))
  for (const file of validated) {
    let parent = posix.dirname(file.path)
    while (parent !== '.') {
      const key = process.platform === 'win32' ? parent.toLowerCase() : parent
      if (kinds.has(key) && !kinds.get(key)) throw new ResourceFilesError('Resource file conflicts with a parent directory')
      parent = posix.dirname(parent)
    }
  }
  return validated
}

/** Decode and validate the complete archive before a caller writes any files. */
export async function readResourceArchive(buffer: Buffer): Promise<ResourceFile[]> {
  if (buffer.length > MAX_RESOURCE_BYTES) throw new ResourceFilesError('Resource archive exceeds size limit')
  const zip = await JSZip.loadAsync(buffer).catch(() => { throw new ResourceFilesError('Invalid resource ZIP archive') })
  const entries = Object.values(zip.files)
  if (entries.length > MAX_RESOURCE_ENTRIES) throw new ResourceFilesError('Resource has too many entries')
  const files: ResourceFile[] = []
  let bytes = 0
  for (const entry of entries) {
    if (entry.dir && /^(?:\.[/\\])+$/.test(entry.unsafeOriginalName || entry.name)) continue
    const path = resourcePath(entry.unsafeOriginalName || entry.name)
    const rawMode = typeof entry.unixPermissions === 'string' ? parseInt(entry.unixPermissions, 8) : entry.unixPermissions ?? 0
    const mode = ownerFileMode(rawMode)
    const kind = rawMode & 0o170000
    if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) throw new ResourceFilesError('Resource entries must be regular files or directories')
    if (entry.dir) { files.push({ path, content: Buffer.alloc(0), mode: 0o700, isDirectory: true }); continue }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of new Readable().wrap(entry.nodeStream('nodebuffer'))) {
      const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += content.length
      bytes += content.length
      if (size > MAX_RESOURCE_FILE_BYTES || bytes > MAX_RESOURCE_BYTES) throw new ResourceFilesError('Expanded resource exceeds size limit')
      chunks.push(content)
    }
    files.push({ path, content: Buffer.concat(chunks, size), mode })
  }
  return validateFiles(files)
}

/** Read a directory snapshot without following links or opening special files. */
export async function readResourceDirectory(source: string): Promise<ResourceFile[]> {
  const root = await lstat(source)
  if (root.isSymbolicLink() || !root.isDirectory()) throw new ResourceFilesError('Resource root must be a directory')
  const files: ResourceFile[] = []
  let bytes = 0
  const visit = async (relative: string, depth: number): Promise<void> => {
    if (depth > 32) throw new ResourceFilesError('Resource directory nesting exceeds limit')
    for (const name of (await readdir(join(source, relative))).sort()) {
      if (files.length >= MAX_RESOURCE_ENTRIES) throw new ResourceFilesError('Resource has too many entries')
      const path = resourcePath(posix.join(relative, name))
      const native = join(source, path)
      const metadata = await lstat(native)
      if (metadata.isSymbolicLink()) throw new ResourceFilesError('Resource entries must not be symbolic links')
      if (metadata.isDirectory()) {
        files.push({ path, content: Buffer.alloc(0), mode: 0o700, isDirectory: true })
        await visit(path, depth + 1)
      } else if (metadata.isFile()) {
        if (metadata.size > MAX_RESOURCE_FILE_BYTES || bytes + metadata.size > MAX_RESOURCE_BYTES) throw new ResourceFilesError('Resource exceeds size limit')
        const content = await readFile(native)
        bytes += content.length
        if (content.length !== metadata.size || bytes > MAX_RESOURCE_BYTES) throw new ResourceFilesError('Resource changed during preparation')
        files.push({ path, content, mode: ownerFileMode(metadata.mode) })
      } else throw new ResourceFilesError('Resource entries must be regular files or directories')
    }
  }
  await visit('', 0)
  return files
}

async function rejectLinks(root: string, path: string): Promise<void> {
  let current = root
  const paths = [root]
  for (const part of path.split('/')) { current = join(current, part); paths.push(current) }
  for (const candidate of paths) {
    const metadata = await lstat(candidate).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return undefined
    })
    if (metadata?.isSymbolicLink()) throw new ResourceFilesError('Resource destination must not contain symbolic links')
  }
}

/** Write into an application-owned staging directory after validating the batch. */
export async function writeResourceFiles(target: string, entries: readonly ResourceFile[]): Promise<void> {
  const files = validateFiles(entries)
  const root = resolve(target)
  await rejectLinks(root, '')
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const file of files) {
    await rejectLinks(root, file.path)
    const native = join(root, file.path)
    if (file.isDirectory) await mkdir(native, { recursive: true, mode: 0o700 })
    else {
      await mkdir(dirname(native), { recursive: true, mode: 0o700 })
      await writeFile(native, file.content, { mode: file.mode })
      await chmod(native, file.mode)
    }
  }
}

/** Preserve the same validated file facts across a directory import. */
export async function copyResourceDirectory(source: string, target: string): Promise<void> {
  await writeResourceFiles(target, await readResourceDirectory(source))
}
