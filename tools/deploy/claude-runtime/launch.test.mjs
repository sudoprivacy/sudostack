import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchConfiguration, readPrivateBinding, requirePrivateState } from './launch.mjs';

export const binding = {
  ownerId: 'owner-1', organizationId: 'org-1', microPoolId: 'pool-1',
  accountId: 6, email: 'owner@example.com', httpProxy: 'http://100.64.0.7:1055',
  privacy: { policyVersion: 'claude-optional-data-v1', email: 'owner@example.com',
    locationMetadata: false, modelImprovement: false, persistedReadback: true },
};

test('wrong owner, incomplete isolation or missing persisted privacy never starts', () => {
  assert.throws(() => launchConfiguration(binding, 'another-owner'));
  for (const field of ['ownerId', 'organizationId', 'microPoolId', 'accountId', 'email', 'privacy']) {
    assert.throws(() => launchConfiguration({ ...binding, [field]: undefined }, 'owner-1'));
  }
  for (const change of [{ email: 'other@example.com' }, { locationMetadata: true },
    { modelImprovement: true }, { persistedReadback: false }, { policyVersion: 'unknown' }]) {
    assert.throws(() => launchConfiguration({ ...binding, privacy: { ...binding.privacy, ...change } }, 'owner-1'));
  }
});

test('fixed CONNECT endpoint, durable state and minimal environment', () => {
  const { configDir, env } = launchConfiguration(binding, 'owner-1', {
    ANTHROPIC_API_KEY: 'operator-key', ANTHROPIC_BASE_URL: 'https://other.example',
    CLAUDE_CODE_OAUTH_TOKEN: 'other-account', HTTPS_PROXY: 'http://wrong',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0', NO_PROXY: '*', AZURE_CLIENT_SECRET: 'secret',
  });
  assert.equal(configDir, '/data/claude/6');
  assert.equal(env.CLAUDE_CONFIG_DIR, configDir);
  assert.equal(env.HTTPS_PROXY, 'http://100.64.0.7:1055/');
  assert.equal(env.NO_PROXY, '127.0.0.1,localhost,::1');
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  for (const name of ['ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','CLAUDE_CODE_OAUTH_TOKEN','AZURE_CLIENT_SECRET']) {
    assert.equal(env[name], undefined);
  }
  for (const httpProxy of ['socks5://proxy:1080', 'http://u:p@proxy:1080', 'http://proxy/path', 'http://proxy/#x', '']) {
    assert.throws(() => launchConfiguration({ ...binding, httpProxy }, 'owner-1'));
  }
});

test('private binding refuses a symlink or shared file', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-binding-'));
  try {
    const path = join(directory, 'binding.json');
    writeFileSync(path, JSON.stringify(binding), { mode: 0o600 });
    assert.equal(readPrivateBinding(path).ownerId, 'owner-1');
    symlinkSync(path, join(directory, 'link'));
    assert.throws(() => readPrivateBinding(join(directory, 'link')));
    chmodSync(path, 0o644);
    assert.throws(() => readPrivateBinding(path));
    chmodSync(directory, 0o700);
    // /var on macOS may itself be a symlink; test the canonical path.
    requirePrivateState(realpathSync(directory));
    chmodSync(directory, 0o755);
    assert.throws(() => requirePrivateState(realpathSync(directory)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
