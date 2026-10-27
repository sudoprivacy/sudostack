/** Real Caddy TLS/authentication transport acceptance with synthetic classification data. */
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import forge from 'node-forge'
import { nodeAnalyzerGatewayConfiguration, nodeAnalyzerRelayConfiguration } from '../../src/egressAnalyzerTransport.js'

const binary = process.env.CADDY_BINARY
const image = process.env.CADDY_CONTAINER_IMAGE
assert(binary || image, 'Set CADDY_BINARY or CADDY_CONTAINER_IMAGE to verified Caddy 2.10.2')
const root = await mkdtemp(join(tmpdir(), 'sudo-analyzer-relay-'))
const processes: ReturnType<typeof spawn>[] = []
const containers = new Map<ReturnType<typeof spawn>, string>()
const createdContainers: string[] = []
async function availablePort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = (listener.address() as { port: number }).port
  await new Promise<void>(resolveClose => listener.close(() => resolveClose()))
  return port
}
const gatewayPort = await availablePort()
const relayPort = await availablePort()
const restricted = ['--network', 'host', '--user', '1002:1002', '--group-add', String(process.getgid?.()),
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only',
  '--tmpfs', '/scratch:size=16m,mode=1777', '--memory', '128m', '--cpus', '0.5',
  '--entrypoint', '/usr/bin/caddy']
async function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  const id = containers.get(child)
  if (id) {
    assert.equal(spawnSync('docker', ['stop', '--time', '3', id], { encoding: 'utf8' }).status, 0)
  } else child.kill()
  await closed
}
let requests = 0
const analyzer = createServer(async (request, response) => {
  requests++
  assert.equal(request.headers.authorization, undefined, 'Gateway credentials must not reach the analyzer')
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ terms: body.business_policy?.protected_terms ?? [] }))
})
const childrenLogs: string[] = []
try {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 1000)
  cert.validity.notAfter = new Date(Date.now() + 3600_000)
  cert.setSubject([{ name: 'commonName', value: 'egress-node.internal' }])
  cert.setIssuer(cert.subject.attributes)
  cert.setExtensions([{ name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'egress-node.internal' }] }])
  cert.sign(forge.pki.privateKeyFromPem(pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()), forge.md.sha256.create())
  const pem = forge.pki.certificateToPem(cert)
  await writeFile(join(root, 'server.pem'), pem)
  await writeFile(join(root, 'analyzer-ca.pem'), pem)
  await writeFile(join(root, 'server-key.pem'), pair.privateKey.export({ type: 'pkcs1', format: 'pem' }), { mode: image ? 0o640 : 0o600 })
  if (image) await chmod(root, 0o750)
  const password = randomBytes(32).toString('hex')
  const hash = image
    ? spawnSync('docker', ['run', '--rm', '-i', ...restricted, image, 'hash-password', '--bcrypt-cost', '10'], { input: `${password}\n`, encoding: 'utf8' })
    : spawnSync(binary!, ['hash-password', '--bcrypt-cost', '10'], { input: `${password}\n`, encoding: 'utf8', windowsHide: true })
  assert.equal(hash.status, 0, hash.stderr)
  const pathRoot = root.replaceAll('\\', '/')
  const relocate = (config: string) => config.replaceAll('/relay/', `${pathRoot}/`).replaceAll('/node-identity/', `${pathRoot}/`)
  analyzer.listen(0, '127.0.0.1')
  await once(analyzer, 'listening')
  const analyzerPort = (analyzer.address() as { port: number }).port
  const gateway = relocate(nodeAnalyzerGatewayConfiguration({ bindAddress: '127.0.0.1', port: gatewayPort, passwordHash: hash.stdout.trim() }))
    .replace('127.0.0.1:59081', `127.0.0.1:${analyzerPort}`)
  const relay = relocate(nodeAnalyzerRelayConfiguration({ serverName: 'egress-node.internal', port: gatewayPort }))
    .replace('127.0.0.1:59080', `127.0.0.1:${relayPort}`)
  await writeFile(join(root, 'authorization.caddy'), `header_up Authorization "Basic ${Buffer.from(`classifier:${password}`).toString('base64')}"\n`, { mode: image ? 0o640 : 0o600 })
  const start = async (name: string, config: string, nodeAddress = '127.0.0.1') => {
    const path = join(root, `${name}.Caddyfile`)
    await writeFile(path, config, { mode: image ? 0o640 : 0o600 })
    const args = ['run', '--config', path, '--adapter', 'caddyfile']
    let id: string | undefined
    if (image) {
      const created = spawnSync('docker', ['create', ...restricted,
        '--mount', `type=bind,src=${root},dst=${root},readonly`,
        '--env', `NEXUS_DLP_NODE_IP=${nodeAddress}`, '--env', 'XDG_CONFIG_HOME=/scratch/config',
        '--env', 'XDG_DATA_HOME=/scratch/data', image, ...args], { encoding: 'utf8' })
      assert.equal(created.status, 0, created.stderr)
      id = created.stdout.trim()
      assert.match(id, /^[a-f0-9]{64}$/)
      createdContainers.push(id)
    }
    const child = spawn(image ? 'docker' : binary!, id ? ['start', '--attach', id] : args, {
      windowsHide: true, env: { ...process.env, NEXUS_DLP_NODE_IP: nodeAddress, XDG_CONFIG_HOME: root, XDG_DATA_HOME: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', value => childrenLogs.push(String(value)))
    child.stderr!.on('data', value => childrenLogs.push(String(value)))
    processes.push(child)
    if (id) containers.set(child, id)
    child.on('error', error => childrenLogs.push(String(error)))
  }
  await start('gateway', gateway)
  await start('relay', relay)
  const post = (terms: string[]) => fetch(`http://127.0.0.1:${relayPort}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'synthetic fixture', language: 'zh', business_policy: { protected_terms: terms } }),
    signal: AbortSignal.timeout(3000),
  })
  const waitForStatus = async (expected: number, terms: string[] = []) => {
    const deadline = Date.now() + 10000
    while (true) {
      try { const response = await post(terms); if (response.status === expected) return response } catch {}
      assert(Date.now() < deadline, `Caddy did not return ${expected}: ${childrenLogs.join('').replaceAll(password, '[secret]')}`)
      await delay(100)
    }
  }
  await waitForStatus(200, ['fixture-a'])
  const first = await post(['fixture-a'])
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { terms: ['fixture-a'] })
  assert.deepEqual(await (await post([])).json(), { terms: [] }, 'Request-scoped policy must survive transport without cross-request state')
  assert.equal((await fetch(`http://127.0.0.1:${relayPort}/policy`)).status, 404)
  assert(childrenLogs.join('').split('admin endpoint disabled').length - 1 >= 2,
    'Both Caddy processes must confirm their admin endpoint is disabled')
  await writeFile(join(root, 'authorization.caddy'), 'header_up Authorization "Basic invalid"\n')
  await stop(processes[1]!)
  await start('relay-invalid-auth', relay)
  const before = requests
  assert.equal((await waitForStatus(401)).status, 401)
  assert.equal(requests, before, 'Unauthenticated requests must not reach the analyzer')
  await stop(processes[2]!)
  await start('relay-wrong-identity', relay.replaceAll('egress-node.internal', 'wrong-node.internal'))
  assert.equal((await waitForStatus(502)).status, 502, 'An untrusted node identity must fail TLS verification')
  assert.equal(requests, before)
  await stop(processes[3]!)
  await writeFile(join(root, 'authorization.caddy'), `header_up Authorization "Basic ${Buffer.from(`classifier:${password}`).toString('base64')}"\n`)
  const shared = relocate(nodeAnalyzerRelayConfiguration({ serverName: 'egress-node.internal', port: gatewayPort, upstreamAddress: '127.0.0.1' }))
    .replace('127.0.0.1:59080', `127.0.0.1:${relayPort}`)
  await start('relay-shared', shared, '192.0.2.111')
  assert.deepEqual(await (await waitForStatus(200, ['shared-fixture'])).json(), { terms: ['shared-fixture'] })
  console.log(JSON.stringify({ passed: true, caddy: '2.10.2', containerSecurity: image ? 'uid1002, shared group, cap-drop ALL, no-new-privileges, read-only root' : undefined, cases: ['TLS identity', 'authenticated classification', 'request isolation', 'credential stripping', 'loopback paths', 'admin disabled', 'bad credentials rejected', 'wrong TLS name rejected', 'controller-fixed shared upstream'] }))
} finally {
  for (const child of processes) await stop(child)
  for (const id of createdContainers) assert.equal(spawnSync('docker', ['rm', id], { encoding: 'utf8' }).status, 0)
  await new Promise<void>(resolveClose => analyzer.close(() => resolveClose()))
  const target = resolve(root)
  assert.equal(dirname(target), resolve(tmpdir()))
  assert(target.startsWith(join(resolve(tmpdir()), 'sudo-analyzer-relay-')))
  await rm(target, { recursive: true })
}
