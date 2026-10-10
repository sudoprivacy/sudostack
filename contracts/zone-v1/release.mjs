#!/usr/bin/env node
/**
 * Assembles the offline release bundle for zone-v1 (§7.5 items 13-14).
 *
 * Everything it writes is deterministic: no timestamps, no environment
 * leakage — deleting releases/zone-v1 and re-running this script must
 * reproduce byte-identical output (that reproducibility IS the check).
 *
 *   node contracts/zone-v1/release.mjs
 *
 * Layout:
 *   releases/zone-v1/release-manifest.gen.json — versions, pinned owner revs,
 *       per-schema digests (from the bundle) and artifact digests
 *   releases/zone-v1/bundle/ — installable @sudo/contracts source (the TS
 *       entry points + validators + d.ts + package.json), schema bundle,
 *       fixtures and provenance; Private/Edge installs from here via file:
 *   releases/zone-v1/checksums.gen.txt — sha256 over every bundle file
 *   releases/zone-v1/sbom.cdx.gen.json — constructed here (see below)
 *
 * The bundle is a self-contained zero-dependency package, so its SBOM records
 * the published component itself and is constructed in this script —
 * deterministic by construction: no timestamps, no tool versions, no
 * environment input, nothing to normalize.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // contracts/zone-v1
const REPO = join(HERE, '..', '..')
const RELEASE = join(REPO, 'releases', 'zone-v1')
const BUNDLE = join(RELEASE, 'bundle')

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
const pin = JSON.parse(readFileSync(join(HERE, 'pin.json'), 'utf8'))
const schemaBundle = JSON.parse(readFileSync(join(HERE, 'schema-bundle.gen.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(HERE, 'provenance.gen.json'), 'utf8'))

// The bundle carries its own installable manifest. It is NOT a copy of the
// root package.json: the root package is the mainline (zone-id mainline +
// resource-ref) frozen by the candidate gates, while this bundle is the
// zone-v1 line's distribution — same package name so consumers install one
// surface, its own version on the zone-v1 line.
const bundleManifest = {
  name: pkg.name,
  version: '0.2.0-rc.1',
  private: true,
  type: 'module',
  exports: {
    './zone-id': './contracts/zone-id/zone-id.gen.js',
    './common/v1': './contracts/zone-v1/common/v1/index.gen.js',
    './auth/v1': './contracts/zone-v1/auth/v1/index.gen.js',
    './runtime/v2': './contracts/zone-v1/runtime/v2/index.gen.js',
  },
}

// -- bundle contents -----------------------------------------------------------
const bundleFiles = [
  ['common/v1/index.gen.js', 'contracts/zone-v1/common/v1/index.gen.js'],
  ['common/v1/index.gen.d.ts', 'contracts/zone-v1/common/v1/index.gen.d.ts'],
  ['auth/v1/index.gen.js', 'contracts/zone-v1/auth/v1/index.gen.js'],
  ['auth/v1/index.gen.d.ts', 'contracts/zone-v1/auth/v1/index.gen.d.ts'],
  ['runtime/v2/index.gen.js', 'contracts/zone-v1/runtime/v2/index.gen.js'],
  ['runtime/v2/index.gen.d.ts', 'contracts/zone-v1/runtime/v2/index.gen.d.ts'],
  ['validators.gen.js', 'contracts/zone-v1/validators.gen.js'],
  ['codes.gen.js', 'contracts/zone-v1/codes.gen.js'],
  ['../zone-id/zone-id.gen.js', 'contracts/zone-id/zone-id.gen.js'],
  ['../zone-id/zone-id.gen.d.ts', 'contracts/zone-id/zone-id.gen.d.ts'],
  ['schema-bundle.gen.json', 'contracts/zone-v1/schema-bundle.gen.json'],
  ['provenance.gen.json', 'contracts/zone-v1/provenance.gen.json'],
  ['fixtures/valid.gen.json', 'contracts/zone-v1/fixtures/valid.gen.json'],
  ['fixtures/invalid.gen.json', 'contracts/zone-v1/fixtures/invalid.gen.json'],
  ['fixtures/roundtrip.gen.json', 'contracts/zone-v1/fixtures/roundtrip.gen.json'],
  ['fixtures/compatibility.gen.json', 'contracts/zone-v1/fixtures/compatibility.gen.json'],
  ['fixtures/secret-negative.gen.json', 'contracts/zone-v1/fixtures/secret-negative.gen.json'],
  ['fixtures/path-traversal.gen.json', 'contracts/zone-v1/fixtures/path-traversal.gen.json'],
]

mkdirSync(BUNDLE, { recursive: true })
const digests = []
writeFileSync(join(BUNDLE, 'package.json'), JSON.stringify(bundleManifest, null, 2) + '\n')
digests.push({ path: 'package.json', sha256: sha256File(join(BUNDLE, 'package.json')) })
for (const [from, to] of bundleFiles) {
  const src = join(HERE, from)
  const dest = join(BUNDLE, to)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  digests.push({ path: to.replace(/\\/g, '/'), sha256: sha256File(dest) })
}
digests.sort((a, b) => a.path.localeCompare(b.path))

// -- checksums -------------------------------------------------------------------
const checksums = digests.map((d) => `${d.sha256}  ${d.path}`).join('\n') + '\n'
writeFileSync(join(RELEASE, 'checksums.gen.txt'), checksums)

// -- release manifest ---------------------------------------------------------------
const manifest = {
  $comment: [
    'Generated by contracts/zone-v1/release.mjs — do not edit.',
    'Deterministic by design: no timestamps; deleting and re-running reproduces',
    'this file byte-for-byte. created_at is deliberately absent until the 1.0',
    'release process defines a reproducible provenance source for it.',
  ],
  package: {
    name: bundleManifest.name,
    version: bundleManifest.version,
    private: bundleManifest.private,
    exports: Object.keys(bundleManifest.exports),
  },
  pinned_owner_revisions: {
    'nexus-vfs': pin['nexus-vfs'].rev,
    nexus: pin.nexus.rev,
    'moss (metadata only)': pin.moss.rev,
  },
  schemas: schemaBundle.schemas,
  generated_artifacts: digests,
  provenance_regenerate: provenance.regenerate,
}
writeFileSync(join(RELEASE, 'release-manifest.gen.json'), JSON.stringify(manifest, null, 2) + '\n')

// -- sbom ---------------------------------------------------------------------------
// Constructed from the manifest above: the bundle is a zero-dependency
// package, so its component inventory is the published component itself.
// Minimal legal CycloneDX document — deliberately nothing else, so the
// output is byte-reproducible on any machine with no normalization step.
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      'bom-ref': `${bundleManifest.name}@${bundleManifest.version}`,
      name: bundleManifest.name,
      version: bundleManifest.version,
    },
  },
}
writeFileSync(join(RELEASE, 'sbom.cdx.gen.json'), JSON.stringify(sbom, null, 2) + '\n')

console.log(`release assembled: ${digests.length} bundle files, checksums + manifest + sbom written`)
