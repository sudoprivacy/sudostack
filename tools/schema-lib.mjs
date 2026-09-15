import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SCHEMA_ROOT = join(REPO, 'schemas')
export const FIXTURE_ROOT = join(REPO, 'fixtures')

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function listFiles(root, predicate = () => true) {
  if (!existsSync(root)) return []
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name)
      if (name.isDirectory()) walk(path)
      else if (predicate(path)) out.push(path)
    }
  }
  walk(root)
  return out.sort()
}

export function schemaFiles() {
  return listFiles(SCHEMA_ROOT, (p) => p.endsWith('.schema.json'))
}

export function loadSchemas() {
  const byPath = new Map()
  const byKind = new Map()
  const byId = new Map()
  for (const path of schemaFiles()) {
    const schema = readJson(path)
    byPath.set(path, schema)
    if (schema.$id) byId.set(schema.$id, schema)
    const kind = schema.properties?.kind?.const
    const apiVersion = schema.properties?.api_version?.const
    if (kind && apiVersion) byKind.set(`${apiVersion}:${kind}`, schema)
  }
  return { byPath, byKind, byId }
}

export function schemaForObject(value, schemas = loadSchemas()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return schemas.byKind.get(`${value.api_version}:${value.kind}`) ?? null
}

export function validateByObject(value, schemas = loadSchemas()) {
  const schema = schemaForObject(value, schemas)
  if (!schema) {
    return [{ path: '$', message: `unsupported api_version/kind ${JSON.stringify(value?.api_version)}/${JSON.stringify(value?.kind)}` }]
  }
  return validate(schema, value, { schemas, basePath: schemaPathFor(schema, schemas) })
}

function schemaPathFor(schema, schemas) {
  for (const [path, candidate] of schemas.byPath) {
    if (candidate === schema) return path
  }
  return null
}

export function validate(schema, value, options = {}, path = '$') {
  const errors = []
  const schemas = options.schemas ?? loadSchemas()

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, options.basePath, schemas)
    return validate(resolved.schema, value, { ...options, basePath: resolved.path }, path)
  }

  if ('const' in schema && value !== schema.const) {
    errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` })
    return errors
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` })
    return errors
  }

  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push({ path, message: `expected ${schema.type}, got ${Array.isArray(value) ? 'array' : typeof value}` })
    return errors
  }

  if (schema.type === 'object' || schema.properties || schema.required) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ path, message: 'expected object' })
      return errors
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push({ path: `${path}.${required}`, message: 'missing required property' })
    }
    const props = schema.properties ?? {}
    for (const key of Object.keys(value)) {
      if (isForbiddenInlineField(key)) {
        errors.push({ path: `${path}.${key}`, message: 'forbidden inline secret-like field' })
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push({ path: `${path}.${key}`, message: 'unexpected property' })
      }
    }
    for (const [key, childSchema] of Object.entries(props)) {
      if (key in value) {
        errors.push(...validate(childSchema, value[key], options, `${path}.${key}`))
      }
    }
  }

  if (schema.type === 'string' || typeof value === 'string') {
    if (typeof value !== 'string') return errors
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      errors.push({ path, message: `string shorter than ${schema.minLength}` })
    }
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) {
      errors.push({ path, message: `string longer than ${schema.maxLength}` })
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `string does not match /${schema.pattern}/` })
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      errors.push({ path, message: 'invalid date-time' })
    }
  }

  if (schema.type === 'integer' || typeof value === 'number') {
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push({ path, message: 'expected integer' })
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `number below ${schema.minimum}` })
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `number above ${schema.maximum}` })
    }
  }

  return errors
}

function typeMatches(type, value) {
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value)
  return typeof value === type
}

export function isForbiddenInlineField(key) {
  return /secret|credential|password|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key/i.test(key)
}

function resolveRef(ref, basePath, schemas) {
  if (schemas.byId.has(ref)) return { schema: schemas.byId.get(ref), path: schemaPathFor(schemas.byId.get(ref), schemas) }
  if (!basePath) throw new Error(`cannot resolve relative $ref ${ref} without base path`)
  const path = resolve(dirname(basePath), ref)
  const schema = schemas.byPath.get(path)
  if (!schema) throw new Error(`cannot resolve $ref ${ref} from ${basePath}`)
  return { schema, path }
}

export function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
}

export function fixtureFiles(kind) {
  return listFiles(join(FIXTURE_ROOT, kind), (p) => p.endsWith('.json'))
}

export function fixtureLabel(path) {
  return relative(REPO, path)
}

export function schemaExportName(path) {
  const name = basename(path, '.schema.json')
  return name
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
