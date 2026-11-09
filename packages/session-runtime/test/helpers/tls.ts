import { generateKeyPairSync } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import forge from 'node-forge'

interface TlsMaterial {
  cert: Buffer
  key: Buffer
}

function keyPair() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    publicKey: forge.pki.publicKeyFromPem(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()),
    privateKey: forge.pki.privateKeyFromPem(keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()),
  }
}

export function testAuthority() {
  const keys = keyPair()
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = '01'
  certificate.validity.notBefore = new Date(Date.now() - 1000)
  certificate.validity.notAfter = new Date(Date.now() + 3600_000)
  certificate.setSubject([{ name: 'commonName', value: 'session-connection-test-ca' }])
  certificate.setIssuer(certificate.subject.attributes)
  certificate.setExtensions([{ name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true }])
  certificate.sign(keys.privateKey, forge.md.sha256.create())
  const ca = Buffer.from(forge.pki.certificateToPem(certificate))
  let serial = 1
  const issue = (name: string, altNames: Array<{ type: number; value: string }>, validitySecs = 300): TlsMaterial => {
    const leafKeys = keyPair()
    const leaf = forge.pki.createCertificate()
    leaf.publicKey = leafKeys.publicKey
    leaf.serialNumber = (++serial).toString(16).padStart(2, '0')
    leaf.validity.notBefore = new Date(Date.now() - 1000)
    leaf.validity.notAfter = new Date(Date.now() + validitySecs * 1000)
    leaf.setSubject([{ name: 'commonName', value: name }])
    leaf.setIssuer(certificate.subject.attributes)
    leaf.setExtensions([{ name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', clientAuth: true, serverAuth: true },
      { name: 'subjectAltName', altNames }])
    leaf.sign(keys.privateKey, forge.md.sha256.create())
    return { cert: Buffer.from(forge.pki.certificateToPem(leaf)),
      key: Buffer.from(forge.pki.privateKeyToPem(leafKeys.privateKey)) }
  }
  return { ca, issue }
}

// Load the installed official client's own proto files; do not copy its wire contract.
const protoRoot = join(dirname(fileURLToPath(import.meta.resolve('@nexus-ai-fs/vfs-client'))), '../proto')
const definitions = protoLoader.loadSync([
  join(protoRoot, 'nexus/grpc/vfs/vfs.proto'),
  join(protoRoot, 'nexus/raft/transport.proto'),
], { includeDirs: [protoRoot], keepCase: true, longs: String, defaults: true })

export async function serve(
  t: { after(callback: () => void): void },
  ca: Buffer,
  material: TlsMaterial,
  service: string,
  handlers: grpc.UntypedServiceImplementation,
): Promise<string> {
  const server = new grpc.Server()
  server.addService(definitions[service] as grpc.ServiceDefinition, handlers)
  t.after(() => server.forceShutdown())
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createSsl(ca,
      [{ private_key: material.key, cert_chain: material.cert }], true),
    (error, bound) => error ? reject(error) : resolve(bound))
  })
  return `https://127.0.0.1:${port}`
}
