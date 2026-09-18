import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNodeVersionSupported, parseMinimumNode, requireSupportedNode } from './node-version.mjs'

test('Node engine floor matches proxy and CommonJS requirements', () => {
  assert.deepEqual(parseMinimumNode('>=22.21.0'), [22, 21, 0])
  assert.equal(isNodeVersionSupported('22.20.0', '>=22.21.0'), false)
  assert.equal(isNodeVersionSupported('22.21.0', '>=22.21.0'), true)
  assert.equal(isNodeVersionSupported('23.0.0', '>=22.21.0'), true)
  assert.throws(() => requireSupportedNode('22.20.0', '>=22.21.0'), /unsupported/)
  assert.doesNotThrow(() => requireSupportedNode(process.versions.node, '>=22.21.0'))
})
