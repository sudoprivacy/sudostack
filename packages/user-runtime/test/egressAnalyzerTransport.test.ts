import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeAnalyzerGatewayConfiguration, nodeAnalyzerRelayConfiguration } from '../src/egressAnalyzerTransport.js'

void test('node transport refuses configuration injection and unverified gateway credentials', () => {
  assert.throws(() => nodeAnalyzerRelayConfiguration({ serverName: 'trusted\n tls_insecure_skip_verify', port: 9448 }))
  assert.throws(() => nodeAnalyzerRelayConfiguration({ serverName: 'egress.internal', port: 80 }))
  assert.throws(() => nodeAnalyzerGatewayConfiguration({ bindAddress: 'node.example', port: 9448, passwordHash: 'plaintext' }))
  assert.throws(() => nodeAnalyzerGatewayConfiguration({ bindAddress: '127.0.0.1', port: 9448, passwordHash: 'plaintext' }))
})

void test('a shared analyzer address is fixed by infrastructure while node placement uses the actual host', () => {
  const node = nodeAnalyzerRelayConfiguration({ serverName: 'egress.internal', port: 9448 })
  assert(node.includes('https://{$NEXUS_DLP_NODE_IP}:9448'))
  const shared = nodeAnalyzerRelayConfiguration({ serverName: 'egress.internal', port: 9448, upstreamAddress: '192.0.2.9' })
  assert(shared.includes('https://192.0.2.9:9448'))
  assert(!shared.includes('NEXUS_DLP_NODE_IP'))
  assert(shared.includes('tls_server_name egress.internal'))
  assert(shared.includes('tls_trust_pool file /relay/analyzer-ca.pem'))
  for (const address of ['0.0.0.0', 'host.example', '::1', '192.0.2.9\n tls_insecure_skip_verify']) {
    assert.throws(() => nodeAnalyzerRelayConfiguration({ serverName: 'egress.internal', port: 9448, upstreamAddress: address }))
  }
})
