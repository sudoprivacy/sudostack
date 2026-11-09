import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  NexusVfsClient,
  NexusZoneApiClient,
  userRuntimeServerName,
  type SessionCredential,
  type NexusVfsTlsConfig,
} from '@nexus-ai-fs/vfs-client'

import { connectSessionRuntime, renewSessionCredential } from '../src/index.js'

function credential(): SessionCredential {
  return { subjectId: 'session-00000000-0000-0000-0000-000000000000',
    caPem: Buffer.from('delegated-ca'), certPem: Buffer.from('delegated-cert'),
    keyPem: Buffer.from('delegated-key') }
}

const issuerTls = { ca: '/ca', cert: '/controller-cert', key: '/controller-key', serverName: 'issuer' }

void test('missing owner or TLS refuses before any issuer/runtime connection', async t => {
  let touched = false
  t.mock.method(NexusZoneApiClient, 'withMtls', () => { touched = true; throw new Error('unexpected issuer') })
  t.mock.method(NexusVfsClient, 'withMtls', () => { touched = true; throw new Error('unexpected runtime') })
  await assert.rejects(connectSessionRuntime({ endpoint: 'https://issuer', tls: issuerTls }, ''), /owner/)
  await assert.rejects(connectSessionRuntime({ endpoint: 'https://issuer', tls: null as unknown as NexusVfsTlsConfig }, 'alice'), /mTLS/)
  assert.equal(touched, false)
})

void test('issuer failure releases its connection without runtime fallback', async t => {
  let closes = 0
  let runtimeCalls = 0
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({
    mintSessionAgent: async () => { throw new Error('denied') },
    close: () => { closes++ },
  }))
  t.mock.method(NexusVfsClient, 'withMtls', () => { runtimeCalls++; throw new Error('unexpected runtime') })
  await assert.rejects(connectSessionRuntime({ endpoint: 'https://issuer', tls: issuerTls }, 'alice'), /denied/)
  assert.equal(closes, 1)
  assert.equal(runtimeCalls, 0)
})

void test('caller mutation during mint cannot retarget execution or renewal', async t => {
  const issued = credential()
  let resolveMint!: (value: SessionCredential) => void
  const minted = new Promise<SessionCredential>(resolve => { resolveMint = resolve })
  const config = { endpoint: 'https://original-issuer', runtimeEndpoint: 'https://alice-runtime',
    tls: { ca: Buffer.from('issuer-ca'), cert: Buffer.from('issuer-cert'), key: Buffer.from('issuer-key'), serverName: 'original-issuer' } }
  let issuerCalls = 0
  let renew!: (current: SessionCredential, signal: AbortSignal) => Promise<SessionCredential>
  t.mock.method(NexusZoneApiClient, 'withMtls', (endpoint, tls) => {
    issuerCalls++
    assert.equal(endpoint, 'https://original-issuer')
    assert.equal(tls.key.toString(), 'issuer-key')
    assert.equal(tls.serverName, 'original-issuer')
    return {
      mintSessionAgent: async (owner: string) => { assert.equal(owner, 'alice'); return minted },
      renewSessionAgent: async (current: SessionCredential) => { assert.equal(current, issued); return issued },
      close: () => {},
    }
  })
  t.mock.method(NexusVfsClient, 'withMtls', (endpoint, tls) => {
    assert.equal(endpoint, 'https://alice-runtime')
    assert.equal(tls.serverName, userRuntimeServerName('alice'))
    assert.equal(tls.key.toString(), 'delegated-key')
    return {
      maintainSessionCredential: (_current: SessionCredential, options: { renew: typeof renew }) => { renew = options.renew },
      close: () => {},
    }
  })
  const pending = connectSessionRuntime(config, 'alice')
  config.endpoint = 'https://other-issuer'
  config.runtimeEndpoint = 'https://bob-runtime'
  config.tls.serverName = 'bob-runtime'
  config.tls.key.fill(0)
  resolveMint(issued)
  const connection = await pending
  assert.equal(connection.authToken, '')
  assert.equal(connection.identity.subjectId, issued.subjectId)
  assert.equal(await renew(issued, new AbortController().signal), issued)
  assert.equal(issuerCalls, 2)
})

void test('renewal setup failure closes the newly created runtime connection', async t => {
  let issuerCloses = 0
  let runtimeCloses = 0
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({
    mintSessionAgent: async () => credential(), close: () => { issuerCloses++ },
  }))
  t.mock.method(NexusVfsClient, 'withMtls', () => ({
    maintainSessionCredential: () => { throw new Error('lease unavailable') },
    close: () => { runtimeCloses++ },
  }))
  await assert.rejects(connectSessionRuntime({ endpoint: 'https://issuer', tls: issuerTls }, 'alice'), /lease unavailable/)
  assert.equal(issuerCloses, 1)
  assert.equal(runtimeCloses, 1)
})

void test('already aborted renewal does not contact issuer', async t => {
  let touched = false
  t.mock.method(NexusZoneApiClient, 'withMtls', () => { touched = true; throw new Error('unexpected issuer') })
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(renewSessionCredential('https://issuer', issuerTls, credential(), abort.signal))
  assert.equal(touched, false)
})

void test('controller close interrupts renewal and releases issuer transport', async t => {
  let closes = 0
  const abort = new AbortController()
  t.mock.method(NexusZoneApiClient, 'withMtls', () => ({
    renewSessionAgent: async () => new Promise<never>((_resolve, reject) => {
      abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true })
    }),
    close: () => { closes++ },
  }))
  const pending = renewSessionCredential('https://issuer', issuerTls, credential(), abort.signal)
  const refused = assert.rejects(pending)
  abort.abort()
  await refused
  assert.equal(closes, 2)
})
