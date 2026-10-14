import { generateKeyPairSync, randomUUID } from 'node:crypto'
import forge from 'node-forge'
import { userRuntimeServerName, type SessionCredential } from '@nexus-ai-fs/vfs-client'

function keys() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    publicKey: forge.pki.publicKeyFromPem(pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()),
    privateKey: forge.pki.privateKeyFromPem(pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()),
  }
}

const authorityKeys = keys()
const leafKeys = keys()
const authority = forge.pki.createCertificate()
authority.publicKey = authorityKeys.publicKey
authority.serialNumber = '01'
authority.validity.notBefore = new Date(Date.now() - 1000)
authority.validity.notAfter = new Date(Date.now() + 3600_000)
authority.setSubject([{ name: 'commonName', value: 'runtime-test-ca' }])
authority.setIssuer(authority.subject.attributes)
authority.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true }])
authority.sign(authorityKeys.privateKey, forge.md.sha256.create())

/** Real signed owner capabilities keep the SDK's production validation active in lifecycle tests. */
export function runtimeCredential(ownerId: string, isExpired = false): SessionCredential {
  const subjectId = `session-${randomUUID()}`
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = leafKeys.publicKey
  certificate.serialNumber = randomUUID().replaceAll('-', '')
  certificate.validity.notBefore = new Date(Date.now() - (isExpired ? 600_000 : 1000))
  certificate.validity.notAfter = new Date(Date.now() + (isExpired ? -300_000 : 299_000))
  certificate.setSubject([{ name: 'commonName', value: subjectId }])
  certificate.setIssuer(authority.subject.attributes)
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true, serverAuth: true },
    { name: 'subjectAltName', altNames: [
      { type: 2, value: userRuntimeServerName(ownerId) },
      { type: 6, value: `nexus://agent/${subjectId}` },
      { type: 6, value: `nexus://owner/${ownerId}` },
    ] },
  ])
  certificate.sign(authorityKeys.privateKey, forge.md.sha256.create())
  return { subjectId, caPem: Buffer.from(forge.pki.certificateToPem(authority)),
    certPem: Buffer.from(forge.pki.certificateToPem(certificate)),
    keyPem: Buffer.from(forge.pki.privateKeyToPem(leafKeys.privateKey)) }
}
