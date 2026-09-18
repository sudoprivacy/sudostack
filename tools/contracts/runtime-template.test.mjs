import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderResourceRefTypeScript } from './runtime-template.mjs'

test('ResourceRef discriminator types derive from generated constants', () => {
  const source = renderResourceRefTypeScript({
    nexusRevision: '1'.repeat(40),
    definitionRevision: '2'.repeat(40),
    nexusVfsRevision: '3'.repeat(40),
    apiVersion: 'common.sudo.dev/v2',
    kind: 'OtherResourceRef',
  })
  assert.match(source, /RESOURCE_REF_API_VERSION = "common\.sudo\.dev\/v2" as const/)
  assert.match(source, /RESOURCE_REF_KIND = "OtherResourceRef" as const/)
  assert.match(source, /api_version: typeof RESOURCE_REF_API_VERSION/)
  assert.match(source, /kind: typeof RESOURCE_REF_KIND/)
  assert.equal(source.includes("api_version: 'common.sudo.dev/v1'"), false)
  assert.equal(source.includes("kind: 'ResourceRef'"), false)
})
