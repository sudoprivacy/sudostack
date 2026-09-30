#!/usr/bin/env node
/**
 * Normalize the generated SBOM so it does not embed the generating
 * environment (§7.5 items 13-14).
 *
 * cyclonedx-npm records the npm version it ran under in metadata.tools —
 * the one value that differs between machines (npm 11 locally, npm 10 on
 * the Node 22 runner). `--output-reproducible` sorts lists and strips
 * time/random values but deliberately keeps tool versions, and the release
 * gate is `git diff --exit-code` over releases/zone-v1, so that single
 * entry would fail every CI run. Rewriting it to a constant makes the
 * artifact environment-independent; the toolchain that actually produced
 * it stays pinned in the lockfile and recorded in the release manifest.
 *
 *   node contracts/zone-v1/normalize-sbom.mjs   (also run by `npm run sbom`)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // contracts/zone-v1
const SBOM = join(HERE, '..', '..', 'releases', 'zone-v1', 'sbom.cdx.gen.json')

const bom = JSON.parse(readFileSync(SBOM, 'utf8'))
const npm = (bom.metadata?.tools?.components ?? []).find((c) => c.name === 'npm')
if (!npm) throw new Error('no npm tool entry in metadata.tools — did the SBOM layout change?')
npm.version = 'env-normalized'
writeFileSync(SBOM, JSON.stringify(bom, null, 2) + '\n')
console.log('normalized: metadata.tools npm version -> env-normalized')
