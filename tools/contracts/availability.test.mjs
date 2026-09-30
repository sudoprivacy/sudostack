import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runHistoricalTest } from './history-0.2.0.mjs'

test('immutable 0.2.0 availability mutation suite passes in its historical checkout', () => {
  const output = runHistoricalTest('tools/contracts/availability.test.mjs')
  assert.match(output, /tests 9/)
  assert.match(output, /pass 9/)
  assert.match(output, /fail 0/)
})
