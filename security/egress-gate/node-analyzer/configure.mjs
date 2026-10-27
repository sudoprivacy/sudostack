#!/usr/bin/env node
/** Prepare a private single-node analyzer and its relay Secret without exposing credentials. */
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, chmodSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import { nodeAnalyzerGatewayConfiguration, nodeAnalyzerRelayConfiguration } from '../../../packages/user-runtime/dist/egressAnalyzerTransport.js'

if (process.platform !== 'linux') throw new Error('Node analyzer deployment requires Linux')
function parsePrivateJson(text) {
  try { return JSON.parse(text) } catch { throw new Error('Invalid node analyzer deployment JSON') }
}
const configuration = parsePrivateJson(readFileSync(process.argv[2], 'utf8'))
const allowed = ['version', 'dataDirectory', 'bindAddress', 'port', 'serverName', 'analyzerImage', 'gatewayImage', 'namespace', 'relaySecretName', 'kubeconfig', 'relayMode']
if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) ||
  Object.keys(configuration).some(key => !allowed.includes(key)) || configuration.version !== 1 ||
  typeof configuration.dataDirectory !== 'string' || !isAbsolute(configuration.dataDirectory) || resolve(configuration.dataDirectory) === '/' ||
  typeof configuration.namespace !== 'string' || configuration.namespace.length > 63 ||
  !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(configuration.namespace) ||
  typeof configuration.relaySecretName !== 'string' || configuration.relaySecretName.length > 253 ||
  !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(configuration.relaySecretName) ||
  ![configuration.analyzerImage, configuration.gatewayImage].every(image => typeof image === 'string' && image && !/[\s\u0000]/.test(image)) ||
  (configuration.relayMode !== undefined && !['node', 'shared'].includes(configuration.relayMode))) {
  throw new Error('Invalid node analyzer deployment configuration')
}
const isShared = configuration.relayMode === 'shared'
const relay = nodeAnalyzerRelayConfiguration({ ...configuration, ...(isShared ? { upstreamAddress: configuration.bindAddress } : {}) })
// Validate every public transport field before creating private state.
nodeAnalyzerGatewayConfiguration({ ...configuration, passwordHash: '$2a$14$' + 'a'.repeat(53) })
if (!Object.values(networkInterfaces()).flat().some(address =>
  address?.family === 'IPv4' && address.address === configuration.bindAddress)) {
  throw new Error('Analyzer bind address does not belong to this host')
}
const root = resolve(configuration.dataDirectory)
if (existsSync(root) && (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())) throw new Error('Private deployment directory must be a real directory')
const marker = join(root, 'deployment.json')
if (existsSync(root) && !existsSync(marker) && readdirSync(root).length) throw new Error('Refusing to initialize a nonempty unowned deployment directory')
const identity = { version: 1, serverName: configuration.serverName, bindAddress: configuration.bindAddress,
  port: configuration.port, namespace: configuration.namespace, relaySecretName: configuration.relaySecretName,
  ...(isShared ? { relayMode: 'shared' } : {}) }
if (existsSync(marker) && JSON.stringify(parsePrivateJson(readFileSync(marker, 'utf8'))) !== JSON.stringify(identity)) {
  throw new Error('Existing analyzer belongs to a different node or namespace')
}
mkdirSync(root, { recursive: true, mode: 0o700 })
chmodSync(root, 0o700)
function write(name, content) {
  const path = join(root, name)
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error('Private deployment file must be a regular file')
  writeFileSync(path, content, { mode: 0o600 })
  chmodSync(path, 0o600)
}
function execute(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Node analyzer command failed: ${command}`)
  return result.stdout.trim()
}
write('deployment.json', JSON.stringify(identity))
const passwordFile = join(root, 'classifier-password')
if (!existsSync(passwordFile)) write('classifier-password', randomBytes(32).toString('hex'))
const password = readFileSync(passwordFile, 'utf8').trim()
if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid classifier credential file')
const p = name => join(root, name)
if (!existsSync(p('authority.pem'))) {
  execute('openssl', ['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '3650',
    '-subj', '/CN=sudo-egress-analyzer-authority', '-keyout', p('authority-key.pem'), '-out', p('authority.pem'),
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
}
if (!existsSync(p('server.pem'))) {
  write('server.ext', `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${configuration.serverName}\n`)
  execute('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${configuration.serverName}`,
    '-keyout', p('server-key.pem'), '-out', p('server.csr')])
  execute('openssl', ['x509', '-req', '-in', p('server.csr'), '-CA', p('authority.pem'), '-CAkey', p('authority-key.pem'),
    '-set_serial', '0x' + randomBytes(16).toString('hex'), '-days', '365', '-extfile', p('server.ext'), '-out', p('server.pem')])
}
for (const name of ['authority-key.pem', 'authority.pem', 'server-key.pem', 'server.pem']) chmodSync(p(name), 0o600)
execute('openssl', ['verify', '-CAfile', p('authority.pem'), p('server.pem')])
execute('openssl', ['x509', '-in', p('server.pem'), '-noout', '-checkend', '86400'])
const hash = execute('docker', ['run', '--rm', '-i', '--entrypoint', 'caddy', configuration.gatewayImage, 'hash-password', '--bcrypt-cost', '10'], password + '\n')
write('Caddyfile', nodeAnalyzerGatewayConfiguration({ ...configuration, passwordHash: hash }))
const secret = { apiVersion: 'v1', kind: 'Secret', type: 'Opaque', metadata: { name: configuration.relaySecretName,
  namespace: configuration.namespace, labels: { 'app.kubernetes.io/managed-by': 'sudo-egress-infrastructure' } }, stringData: {
    Caddyfile: relay, 'authorization.caddy': `header_up Authorization "Basic ${Buffer.from(`classifier:${password}`).toString('base64')}"\n`,
    'analyzer-ca.pem': readFileSync(p('authority.pem'), 'utf8'),
  } }
write('relay-secret.json', JSON.stringify(secret))
write('compose.json', JSON.stringify({ services: {
  analyzer: { image: configuration.analyzerImage, restart: 'unless-stopped',
    ports: ['127.0.0.1:59081:3000'], mem_limit: '4g', cpus: 2,
    security_opt: ['no-new-privileges:true'], cap_drop: ['ALL'],
    read_only: true, tmpfs: ['/tmp:size=128m,mode=1777'],
  },
  gateway: { image: configuration.gatewayImage, restart: 'unless-stopped', network_mode: 'host',
    user: `${process.getuid()}:${process.getgid()}`,
    command: ['caddy', 'run', '--config', '/node-identity/Caddyfile', '--adapter', 'caddyfile'],
    environment: { XDG_CONFIG_HOME: '/tmp/config', XDG_DATA_HOME: '/tmp/data', GOMEMLIMIT: '96MiB' },
    volumes: [p('Caddyfile') + ':/node-identity/Caddyfile:ro', p('server.pem') + ':/node-identity/server.pem:ro', p('server-key.pem') + ':/node-identity/server-key.pem:ro'],
    mem_limit: '128m', cpus: 0.5, read_only: true, tmpfs: ['/tmp:size=16m,mode=1777'],
    security_opt: ['no-new-privileges:true'], cap_drop: ['ALL'],
  },
} }, null, 2))
execute('docker', ['compose', '-p', 'sudo-egress-node', '-f', p('compose.json'), 'config', '--quiet'])
if (process.argv.includes('--apply')) {
  const kube = ['--namespace', configuration.namespace, ...(configuration.kubeconfig ? ['--kubeconfig', configuration.kubeconfig] : [])]
  const existing = execute('kubectl', [...kube, 'get', 'secret', configuration.relaySecretName, '--ignore-not-found', '-o', 'json'])
  if (existing && parsePrivateJson(existing).metadata?.labels?.['app.kubernetes.io/managed-by'] !== 'sudo-egress-infrastructure') {
    throw new Error('Refusing to replace an analyzer Secret owned by another deployment')
  }
  execute('docker', ['compose', '-p', 'sudo-egress-node', '-f', p('compose.json'), 'up', '-d'])
  execute('kubectl', [...kube, 'apply', '--server-side', '--field-manager=sudo-egress-infrastructure', '-f', p('relay-secret.json')])
}
console.log(JSON.stringify({ prepared: true, applied: process.argv.includes('--apply'), namespace: configuration.namespace,
  relaySecretName: configuration.relaySecretName, serverName: configuration.serverName, port: configuration.port,
  relayMode: isShared ? 'shared' : 'node' }))
