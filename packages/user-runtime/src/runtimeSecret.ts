import { X509Certificate } from 'node:crypto'
import { userRuntimeServerName } from '@nexus-ai-fs/vfs-client'

/** Retire only expired owner certificates issued by the current trusted CA. */
export function renewRuntimeSecretData(ownerId: string, previous: Record<string, string>, next: Record<string, string>, ca: Buffer): Record<string, string> {
  const data = { ...previous }
  const authority = new X509Certificate(ca)
  const configuration = Object.entries(previous).filter(([key]) =>
    key !== 'credential.json' && !/^[a-f0-9]{64}\.(?:ca|cert|key)\.pem$/.test(key))
    .map(([key, value]) => next[key] ?? Buffer.from(value, 'base64').toString('utf8'))
    .concat(Object.values(next)).join('\n')
  for (const [name, encoded] of Object.entries(previous)) {
    const match = /^([a-f0-9]{64})\.cert\.pem$/.exec(name)
    if (!match) continue
    const files = ['ca', 'cert', 'key'].map(suffix => `${match[1]}.${suffix}.pem`)
    if (files.some(file => configuration.includes(file) || Object.hasOwn(next, file))) continue
    try {
      const certificate = new X509Certificate(Buffer.from(encoded, 'base64'))
      if (Date.parse(certificate.validTo) >= Date.now() ||
        certificate.checkHost(userRuntimeServerName(ownerId)) !== userRuntimeServerName(ownerId) ||
        !certificate.verify(authority.publicKey)) continue
      for (const file of files) delete data[file]
    } catch { /* Unknown or malformed data belongs to its original writer. */ }
  }
  for (const [key, value] of Object.entries(next)) data[key] = Buffer.from(value).toString('base64')
  return data
}
