export function parseMinimumNode(range) {
  const match = String(range).match(/^>=(\d+)\.(\d+)\.(\d+)$/)
  if (!match) throw new Error(`unsupported Node engine range: ${range}`)
  return match.slice(1).map(Number)
}

export function isNodeVersionSupported(version, range) {
  const actual = String(version).replace(/^v/, '').split('.').slice(0, 3).map(Number)
  const minimum = parseMinimumNode(range)
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

export function requireSupportedNode(version, range) {
  if (!isNodeVersionSupported(version, range)) {
    throw new Error(`Node ${version} is unsupported; ${range} is required`)
  }
}
