import { isDeepStrictEqual } from 'node:util'

const ANNOTATIONS = new Set([
  '$comment',
  'description',
  'title',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
])

const pointer = (parts) =>
  parts.length === 0
    ? ''
    : '/' + parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')

const asTypes = (value) => new Set(Array.isArray(value) ? value : value === undefined ? [] : [value])
const equal = isDeepStrictEqual
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

export function compareSchemas(previous, current) {
  if (previous == null) return { status: 'initial_baseline', findings: [] }
  if (current == null) {
    return {
      status: 'breaking',
      findings: [
        { severity: 'breaking', path: '', rule: 'schema_deleted', detail: 'schema was removed' },
      ],
    }
  }
  const findings = []
  compareNode(previous, current, [], findings)
  const status = findings.some((item) => item.severity === 'breaking')
    ? 'breaking'
    : findings.length > 0
      ? 'manual_review'
      : 'compatible'
  return { status, findings }
}

function add(findings, severity, path, rule, detail) {
  findings.push({ severity, path: pointer(path), rule, detail })
}

function compareNode(previous, current, path, findings) {
  if (equal(previous, current)) return
  if (typeof previous === 'boolean' || typeof current === 'boolean') {
    if (previous === true && current === false) {
      add(findings, 'breaking', path, 'boolean_schema_tightened', 'schema changed from true to false')
    } else {
      add(findings, 'manual_review', path, 'boolean_schema_changed', 'boolean schema changed')
    }
    return
  }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    add(findings, 'manual_review', path, 'value_changed', 'unclassified schema value changed')
    return
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    add(findings, 'breaking', path, 'schema_node_changed', 'schema object was removed or replaced')
    return
  }

  if (previous.$id !== current.$id && (previous.$id !== undefined || current.$id !== undefined)) {
    add(findings, 'breaking', [...path, '$id'], 'schema_id_changed', 'schema identity changed')
  }
  if (
    previous.$schema !== current.$schema &&
    (previous.$schema !== undefined || current.$schema !== undefined)
  ) {
    add(findings, 'manual_review', [...path, '$schema'], 'dialect_changed', 'schema dialect changed')
  }
  if (previous.$ref !== current.$ref && (previous.$ref !== undefined || current.$ref !== undefined)) {
    add(findings, 'breaking', [...path, '$ref'], 'ref_target_changed', '$ref was added, removed, or changed')
  }
  if (has(previous, 'const') && !equal(previous.const, current.const)) {
    add(findings, 'breaking', [...path, 'const'], 'const_changed', 'const value changed')
  } else if (!has(previous, 'const') && has(current, 'const')) {
    add(findings, 'breaking', [...path, 'const'], 'const_added', 'new const narrows accepted values')
  }

  const previousTypes = asTypes(previous.type)
  const currentTypes = asTypes(current.type)
  if (previousTypes.size > 0 && currentTypes.size > 0) {
    for (const type of previousTypes) {
      if (!currentTypes.has(type)) {
        add(findings, 'breaking', [...path, 'type'], 'type_removed', `type ${type} is no longer accepted`)
      }
    }
  } else if (previousTypes.size === 0 && currentTypes.size > 0) {
    add(findings, 'breaking', [...path, 'type'], 'type_added', 'new type constraint narrows accepted values')
  }

  if (Array.isArray(previous.enum)) {
    if (!Array.isArray(current.enum)) {
      // Removing an enum widens the accepted set.
    } else {
      for (const value of previous.enum) {
        if (!current.enum.some((candidate) => equal(candidate, value))) {
          add(findings, 'breaking', [...path, 'enum'], 'enum_value_removed', 'accepted enum value was removed')
        }
      }
    }
  } else if (Array.isArray(current.enum)) {
    add(findings, 'breaking', [...path, 'enum'], 'enum_added', 'new enum narrows accepted values')
  }

  const priorRequired = new Set(previous.required ?? [])
  const nextRequired = new Set(current.required ?? [])
  for (const name of nextRequired) {
    if (!priorRequired.has(name)) {
      add(findings, 'breaking', [...path, 'required'], 'required_added', `property ${name} became required`)
    }
  }

  for (const key of ['minLength', 'minItems', 'minProperties', 'minimum', 'exclusiveMinimum']) {
    if (current[key] !== undefined && (previous[key] === undefined || current[key] > previous[key])) {
      add(findings, 'breaking', [...path, key], 'lower_bound_tightened', `${key} was added or increased`)
    }
  }
  for (const key of ['maxLength', 'maxItems', 'maxProperties', 'maximum', 'exclusiveMaximum']) {
    if (current[key] !== undefined && (previous[key] === undefined || current[key] < previous[key])) {
      add(findings, 'breaking', [...path, key], 'upper_bound_tightened', `${key} was added or decreased`)
    }
  }
  if (current.pattern !== previous.pattern && current.pattern !== undefined) {
    add(findings, 'breaking', [...path, 'pattern'], 'pattern_changed', 'pattern was added or changed')
  }

  compareAdditionalProperties(previous, current, path, findings)

  const priorProperties = previous.properties ?? {}
  const nextProperties = current.properties ?? {}
  for (const [name, schema] of Object.entries(priorProperties)) {
    if (!has(nextProperties, name)) {
      add(findings, 'breaking', [...path, 'properties', name], 'property_deleted', 'property schema was removed')
    } else {
      compareNode(schema, nextProperties[name], [...path, 'properties', name], findings)
    }
  }
  for (const [name, schema] of Object.entries(nextProperties)) {
    if (has(priorProperties, name)) continue
    const matchingPatterns = Object.entries(previous.patternProperties ?? {}).filter(([pattern]) => {
      try {
        return new RegExp(pattern, 'u').test(name)
      } catch {
        return true
      }
    })
    if (matchingPatterns.length > 0) {
      if (schema !== true) {
        add(
          findings,
          'manual_review',
          [...path, 'properties', name],
          'pattern_property_intersection_changed',
          'new property schema intersects a previous patternProperties allowance',
        )
      }
      continue
    }
    const priorAllowance = previous.additionalProperties
    if (priorAllowance === false) continue
    if (priorAllowance && typeof priorAllowance === 'object') {
      compareNode(priorAllowance, schema, [...path, 'properties', name], findings)
    } else if (schema !== true) {
      add(
        findings,
        'breaking',
        [...path, 'properties', name],
        'optional_property_narrowed',
        'new property constraints reject values previously accepted as additional properties',
      )
    }
  }

  compareNamedSchema(previous, current, 'items', path, findings, 'items_added')
  compareNamedSchema(previous, current, 'propertyNames', path, findings, 'property_names_added')

  compareDefinitions(previous.$defs ?? {}, current.$defs ?? {}, [...path, '$defs'], findings)

  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']) {
    if (!equal(previous[keyword], current[keyword])) {
      if (previous[keyword] !== undefined || current[keyword] !== undefined) {
        add(
          findings,
          'manual_review',
          [...path, keyword],
          'applicator_changed',
          `${keyword} changed and requires semantic review`,
        )
      }
    }
  }

  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (!key.startsWith('x-sudo-') || equal(previous[key], current[key])) continue
    const bounds = new Set(['x-sudo-max-json-bytes', 'x-sudo-max-extension-depth'])
    const tightened =
      bounds.has(key) &&
      typeof previous[key] === 'number' &&
      typeof current[key] === 'number' &&
      current[key] < previous[key]
    add(
      findings,
      tightened ? 'breaking' : 'manual_review',
      [...path, key],
      tightened ? 'runtime_bound_tightened' : 'extension_keyword_changed',
      `${key} changed and affects generated runtime policy`,
    )
  }

  const handled = new Set([
    '$id', '$schema', '$ref', '$defs', 'type', 'const', 'enum', 'required', 'properties',
    'items', 'additionalProperties', 'propertyNames', 'allOf', 'anyOf', 'oneOf', 'not', 'if',
    'then', 'else', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties',
    'maxProperties', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', ...ANNOTATIONS,
  ])
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (handled.has(key) || key.startsWith('x-sudo-')) continue
    if (!equal(previous[key], current[key])) {
      add(
        findings,
        'manual_review',
        [...path, key],
        'unknown_keyword_changed',
        `unclassified keyword ${key} changed`,
      )
    }
  }
}

function compareAdditionalProperties(previous, current, path, findings) {
  const prior = previous.additionalProperties
  const next = current.additionalProperties
  if ((prior === undefined || prior === true) && next !== undefined && next !== true) {
    add(
      findings,
      'breaking',
      [...path, 'additionalProperties'],
      'additional_properties_tightened',
      'additional properties became restricted',
    )
  } else if (prior && typeof prior === 'object' && next && typeof next === 'object') {
    compareNode(prior, next, [...path, 'additionalProperties'], findings)
  } else if (!equal(prior, next) && next !== true) {
    add(
      findings,
      'manual_review',
      [...path, 'additionalProperties'],
      'additional_properties_changed',
      'additionalProperties changed in an unclassified way',
    )
  }
}

function compareNamedSchema(previous, current, keyword, path, findings, addedRule) {
  const priorHas = has(previous, keyword)
  const nextHas = has(current, keyword)
  if (priorHas && nextHas) {
    compareNode(previous[keyword], current[keyword], [...path, keyword], findings)
  } else if (!priorHas && nextHas && current[keyword] !== true) {
    add(findings, 'breaking', [...path, keyword], addedRule, `${keyword} constraint was added`)
  }
}

function compareDefinitions(previous, current, path, findings) {
  for (const [name, schema] of Object.entries(previous)) {
    if (!has(current, name)) {
      add(findings, 'breaking', [...path, name], 'definition_deleted', 'referenced definition was removed')
    } else {
      compareNode(schema, current[name], [...path, name], findings)
    }
  }
}
