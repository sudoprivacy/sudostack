import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { openSync, readSync, closeSync, fstatSync, constants } from 'node:fs'
import { parseEgressPolicy, type EgressPolicy } from '@sudo/egress-policy'

/** Load a bounded deployment default without putting policy values in errors. */
export function readEgressPolicyFile(filename: string): EgressPolicy {
  if (!isAbsolute(filename)) throw new Error('Egress policy path must be absolute')
  const handle = openSync(filename, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    if (!fstatSync(handle).isFile()) throw new Error('Egress policy must be a regular file')
    const bytes = Buffer.alloc(1024 * 1024 + 1)
    let count = 0
    while (count < bytes.length) {
      const read = readSync(handle, bytes, count, bytes.length - count, count)
      if (!read) break
      count += read
    }
    if (count === bytes.length) throw new Error('Egress policy exceeds size limit')
    let data: unknown
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))) }
    catch { throw new Error('Invalid deployment egress policy JSON') }
    return parseEgressPolicy(data)
  } finally { closeSync(handle) }
}

/** Atomically deliver a complete policy to a deployment-owned local runtime. */
export async function writeEgressPolicyFile(filename: string, input: EgressPolicy): Promise<void> {
  if (!isAbsolute(filename)) throw new Error('Local egress policy path must be absolute')
  const policy = parseEgressPolicy(input)
  const previous = await lstat(filename).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error('Local egress policy must be a regular file')
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    try { await handle.writeFile(JSON.stringify(policy), 'utf8'); await handle.sync() }
    finally { await handle.close() }
    await rename(temporary, filename)
    if (process.platform !== 'win32') {
      const parent = await open(dirname(filename), 'r')
      try { await parent.sync() } finally { await parent.close() }
    }
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
}
