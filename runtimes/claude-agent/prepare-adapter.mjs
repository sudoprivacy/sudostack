/** Explicit, digest-checked downstream policy for the third-party ACP adapter.
 * Never changes the official Agent SDK, native CLI or provider request bytes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import policy from './adapter-policy.json' with { type: 'json' };

export const adapterDirectory = dirname(createRequire(import.meta.url)
  .resolve('@agentclientprotocol/claude-agent-acp/package.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function checkPreparedAdapter(directory = adapterDirectory) {
  const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version;
  if (version !== policy.adapter_version ||
      digest(readFileSync(join(directory, policy.file))) !== policy.prepared_sha256) {
    throw new Error('Claude ACP title policy is not prepared; run npm run prepare:adapter on the pinned dependency');
  }
}

export function prepareAdapter(directory = adapterDirectory) {
  const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version;
  const file = join(directory, policy.file);
  const bytes = readFileSync(file);
  if (version !== policy.adapter_version) throw new Error('Unreviewed ACP adapter version');
  if (digest(bytes) === policy.prepared_sha256) return { policy: policy.policy, changed: false };
  if (digest(bytes) !== policy.upstream_sha256) throw new Error('Unreviewed ACP adapter title implementation');
  // Keep the reviewed patch in source control. This intentionally understands
  // just its one hunk, refusing unexpected patch syntax or source drift.
  const patch = readFileSync(new URL('./patches/local-session-titles.patch', import.meta.url), 'utf8');
  const lines = patch.split('\n').slice(3).filter(line => line !== '');
  if (!lines.every(line => /^[ +\-]/.test(line))) throw new Error('Unexpected ACP policy patch');
  const before = lines.filter(line => line[0] !== '+').map(line => line.slice(1)).join('\n') + '\n';
  const after = lines.filter(line => line[0] !== '-').map(line => line.slice(1)).join('\n') + '\n';
  const source = bytes.toString('utf8');
  if (source.split(before).length !== 2) throw new Error('ACP policy patch does not apply exactly once');
  const prepared = source.replace(before, after);
  if (digest(prepared) !== policy.prepared_sha256) throw new Error('ACP policy output does not match reviewed digest');
  writeFileSync(file, prepared);
  checkPreparedAdapter(directory);
  return { policy: policy.policy, changed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--check') checkPreparedAdapter();
    else if (process.argv.length === 2) console.log(JSON.stringify(prepareAdapter()));
    else throw new Error('Usage: prepare-adapter.mjs [--check]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
