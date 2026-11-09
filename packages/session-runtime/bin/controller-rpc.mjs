#!/usr/bin/env node
import { runControllerRpc } from '../dist/controllerRpc.js'

try {
  await runControllerRpc(process.stdin, process.stdout)
} catch {
  // The bounded structured failure is on private stdout. Do not log keys,
  // native payloads, endpoints or provider exception messages.
  process.exitCode = 1
}
