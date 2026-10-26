/** Real Caddy TLS/authentication transport acceptance with synthetic classification data. */
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import forge from 'node-forge'
import { nodeAnalyzerGatewayConfiguration, nodeAnalyzerRelayConfiguration } from '../../src/egressAnalyzerTransport.js'

const binary = process.env.CADDY_BINARY
assert(binary, 'Set CADDY_BINARY to the verified Caddy 2.10.2 executable')
const root = await mkdtemp(join(tmpdir(), 'sudo-analyzer-relay-'))
const processes: ReturnType<typeof spawn>[] = []
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
  await writeFile(join(root, 'server-key.pem'), pair.privateKey.export({ type: 'pkcs1', format: 'pem' }), { mode: 0o600 })
  const password = randomBytes(32).toString('hex')
  const hash = spawnSync(binary, ['hash-password', '--bcrypt-cost', '10'], { input: `${password}\n`, encoding: 'utf8', windowsHide: true })
  assert.equal(hash.status, 0, hash.stderr)
  const pathRoot = root.replaceAll('\\', '/')
  const relocate = (config: string) => config.replaceAll('/relay/', `${pathRoot}/`).replaceAll('/node-identity/', `${pathRoot}/`)
  const gateway = relocate(nodeAnalyzerGatewayConfiguration({ bindAddress: '127.0.0.1', port: 59448, passwordHash: hash.stdout.trim() }))
  const relay = relocate(nodeAnalyzerRelayConfiguration({ serverName: 'egress-node.internal', port: 59448 }))
  await writeFile(join(root, 'authorization.caddy'), `header_up Authorization "Basic ${Buffer.from(`classifier:${password}`).toString('base64')}"\n`, { mode: 0o600 })
  const start = async (name: string, config: string) => {
    const path = join(root, `${name}.Caddyfile`)
    await writeFile(path, config, { mode: 0o600 })
    const child = spawn(binary, ['run', '--config', path, '--adapter', 'caddyfile'], {
      windowsHide: true, env: { ...process.env, NEXUS_DLP_NODE_IP: '127.0.0.1', XDG_CONFIG_HOME: root, XDG_DATA_HOME: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', value => childrenLogs.push(String(value)))
    child.stderr!.on('data', value => childrenLogs.push(String(value)))
    processes.push(child)
    child.on('error', error => childrenLogs.push(String(error)))
  }
  analyzer.listen(59081, '127.0.0.1')
  await once(analyzer, 'listening')
  await start('gateway', gateway)
  await start('relay', relay)
  const post = (terms: string[]) => fetch('http://127.0.0.1:59080/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'synthetic fixture', language: 'zh', business_policy: { protected_terms: terms } }),
    signal: AbortSignal.timeout(3000),
  })
  const deadline = Date.now() + 10000
  while (true) {
    try { const response = await post(['fixture-a']); if (response.ok) break } catch {}
    assert(Date.now() < deadline, `Caddy did not become ready: ${childrenLogs.join('').replaceAll(password, '[secret]')}`)
    await delay(100)
  }
  const first = await post(['fixture-a'])
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { terms: ['fixture-a'] })
  assert.deepEqual(await (await post([])).json(), { terms: [] }, 'Request-scoped policy must survive transport without cross-request state')
  assert.equal((await fetch('http://127.0.0.1:59080/policy')).status, 404)
  await assert.rejects(fetch('http://127.0.0.1:2019/config/', { signal: AbortSignal.timeout(1000) }), 'The agent must not retrieve relay credentials through Caddy admin')
  await writeFile(join(root, 'authorization.caddy'), 'header_up Authorization "Basic invalid"\n')
  processes[1]!.kill()
  await once(processes[1]!, 'close')
  await start('relay-invalid-auth', relay)
  await delay(500)
  const before = requests
  assert.equal((await post([])).status, 401)
  assert.equal(requests, before, 'Unauthenticated requests must not reach the analyzer')
  processes[2]!.kill()
  await once(processes[2]!, 'close')
  await start('relay-wrong-identity', relay.replaceAll('egress-node.internal', 'wrong-node.internal'))
  await delay(500)
  assert.equal((await post([])).status, 502, 'An untrusted node identity must fail TLS verification')
  assert.equal(requests, before)
  console.log(JSON.stringify({ passed: true, caddy: '2.10.2', cases: ['TLS identity', 'authenticated classification', 'request isolation', 'credential stripping', 'loopback paths', 'admin disabled', 'bad credentials rejected', 'wrong TLS name rejected'] }))
} finally {
  for (const child of processes) if (child.exitCode === null && child.signalCode === null) {
    child.kill(); await once(child, 'close')
  }
  await new Promise<void>(resolveClose => analyzer.close(() => resolveClose()))
  const target = resolve(root)
  assert.equal(dirname(target), resolve(tmpdir()))
  assert(target.startsWith(join(resolve(tmpdir()), 'sudo-analyzer-relay-')))
  await rm(target, { recursive: true })
}
