import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runHistoricalTest } from './history-0.2.0.mjs'

test('immutable 0.2.0 support and B0 mutation suite passes in its historical checkout', () => {
  const output = runHistoricalTest('tools/contracts/support.test.mjs')
  assert.match(output, /tests 6/)
  assert.match(output, /pass 6/)
  assert.match(output, /fail 0/)
})
