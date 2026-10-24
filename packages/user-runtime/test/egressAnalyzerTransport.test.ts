import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeAnalyzerGatewayConfiguration, nodeAnalyzerRelayConfiguration } from '../src/egressAnalyzerTransport.js'

void test('node transport refuses configuration injection and unverified gateway credentials', () => {
  assert.throws(() => nodeAnalyzerRelayConfiguration({ serverName: 'trusted\n tls_insecure_skip_verify', port: 9448 }))
  assert.throws(() => nodeAnalyzerRelayConfiguration({ serverName: 'egress.internal', port: 80 }))
  assert.throws(() => nodeAnalyzerGatewayConfiguration({ bindAddress: 'node.example', port: 9448, passwordHash: 'plaintext' }))
  assert.throws(() => nodeAnalyzerGatewayConfiguration({ bindAddress: '127.0.0.1', port: 9448, passwordHash: 'plaintext' }))
})
