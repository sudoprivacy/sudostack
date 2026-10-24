#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseEgressPolicy } from '../src/index.js'

try {
  const [filename, ...args] = process.argv.slice(2)
  if (!filename) throw new Error('Usage: sudo-egress-policy-check <file> [--expect-enabled|--expect-disabled] [--model-mount <path>] [--exclude-model-mount <path>]')
  const raw = readFileSync(filename)
  if (raw.length > 1024 * 1024) throw new Error('Policy file exceeds size limit')
  let input
  try { input = JSON.parse(raw.toString('utf8')) } catch { throw new Error('Invalid policy JSON') }
  const policy = parseEgressPolicy(input)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--expect-enabled' || arg === '--expect-disabled') {
      if (policy.enabled !== (arg === '--expect-enabled')) throw new Error('Unexpected deployment default switch')
    } else if (arg === '--model-mount' || arg === '--exclude-model-mount') {
      const mount = args[++i]
      if (!mount || policy.modelMounts.includes(mount) !== (arg === '--model-mount')) throw new Error('Unexpected outbound model mount scope')
    } else throw new Error('Unknown profile validation option')
  }
  process.stdout.write(JSON.stringify({ valid: true, version: policy.version, enabled: policy.enabled,
    mode: policy.mode, modelMounts: policy.modelMounts, a2aMounts: policy.a2aMounts }) + '\n')
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'Invalid egress policy') + '\n')
  process.exitCode = 1
}
