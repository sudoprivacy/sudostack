#!/usr/bin/env node
import { join } from 'node:path'
import { fixtureFiles, fixtureLabel, listFiles, loadSchemas, readJson, REPO, schemaFiles, validateByObject } from './schema-lib.mjs'

let failures = 0
const fail = (message) => {
  failures++
  console.error(message)
}

const schemas = loadSchemas()
const schemaManifestFiles = listFiles(join(REPO, 'manifests/schemas'), (p) => p.endsWith('.manifest.json'))
const schemaManifests = schemaManifestFiles.map((path) => [path, readJson(path)])
const manifestBySchemaId = new Map(schemaManifests.map(([, manifest]) => [manifest.schema_id, manifest]))

for (const path of schemaFiles()) {
  const schema = readJson(path)
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    fail(`${path}: $schema must be JSON Schema 2020-12`)
  }
  if (!schema.$id?.startsWith('https://contracts.sudo.dev/schemas/')) {
    fail(`${path}: missing stable contracts.sudo.dev $id`)
  }
  if (!schema.title) fail(`${path}: missing title`)
  if (!schema.type) fail(`${path}: missing type`)
  if (!schema.required?.includes('api_version')) fail(`${path}: api_version must be required`)
  if (!schema.required?.includes('kind')) fail(`${path}: kind must be required`)
  if (!schema.properties?.api_version) fail(`${path}: missing api_version property`)
  if (!schema.properties?.kind) fail(`${path}: missing kind property`)
  if (!manifestBySchemaId.has(schema.$id)) fail(`${path}: missing schema manifest`)
}

for (const [path, manifest] of schemaManifests) {
  for (const key of ['family', 'api_version', 'kind', 'schema_id', 'owner', 'data_classification', 'retention_policy']) {
    if (!manifest[key]) fail(`${path}: missing ${key}`)
  }
  if (manifest.secrets_allowed !== false) fail(`${path}: secrets_allowed must be false`)
  if (!manifest.security_owner) fail(`${path}: missing security_owner`)
  if (!manifest.large_payload_policy) fail(`${path}: missing large_payload_policy`)
  if (!Array.isArray(manifest.producers) || manifest.producers.length === 0) fail(`${path}: missing producers`)
  if (!Array.isArray(manifest.consumers) || manifest.consumers.length === 0) fail(`${path}: missing consumers`)
  if (!Array.isArray(manifest.semantic_adr_refs) || manifest.semantic_adr_refs.length === 0) {
    fail(`${path}: missing semantic_adr_refs`)
  }
  if (!manifest.compatibility?.status) fail(`${path}: missing compatibility.status`)
}

for (const path of fixtureFiles('valid')) {
  const value = readJson(path)
  const errors = validateByObject(value, schemas)
  if (errors.length) fail(`${fixtureLabel(path)} should be valid:\n  ${errors.map((e) => `${e.path}: ${e.message}`).join('\n  ')}`)
}

for (const path of fixtureFiles('roundtrip')) {
  const value = readJson(path)
  const errors = validateByObject(value, schemas)
  if (errors.length) fail(`${fixtureLabel(path)} should roundtrip from a valid object:\n  ${errors.map((e) => `${e.path}: ${e.message}`).join('\n  ')}`)
}

for (const path of fixtureFiles('invalid')) {
  const value = readJson(path)
  const errors = validateByObject(value, schemas)
  if (errors.length === 0) fail(`${fixtureLabel(path)} should be rejected`)
}

if (failures) {
  console.error(`\n${failures} schema check failure(s)`)
  process.exit(1)
}

console.log('schemas and fixtures ok')
