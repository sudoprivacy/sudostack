/** Launch the unmodified producer ACP adapter; never construct model requests.
 * The authenticated product controller supplies this private deployment binding.
 * This is not a scheduler, credential importer, or additional A2A transport.
 */
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import managedSettings from './managed-settings.json' with { type: 'json' };

export const PRIVACY_ENV = Object.freeze(managedSettings.env);

export function launchConfiguration(binding, ownerId, inherited = {}) {
  if (!ownerId || binding.ownerId !== ownerId || !binding.organizationId || !binding.microPoolId ||
      !Number.isSafeInteger(binding.accountId) || binding.accountId < 1 ||
      !/^[^\s@<>]+@[^\s@<>]+$/.test(binding.email ?? '')) {
    throw new Error('An authenticated owner and exact account, organization and micro-pool binding are required');
  }
  if (binding.privacy?.policyVersion !== 'claude-optional-data-v1' ||
      binding.privacy.email !== binding.email.toLowerCase() ||
      binding.privacy.locationMetadata !== false || binding.privacy.modelImprovement !== false ||
      binding.privacy.persistedReadback !== true) {
    throw new Error('Provider UI privacy verification is required before starting this account');
  }
  let proxy;
  try { proxy = new URL(binding.httpProxy); } catch { throw new Error('A fixed HTTP CONNECT proxy is required'); }
  if (!['http:', 'https:'].includes(proxy.protocol) || !proxy.hostname || proxy.username || proxy.password ||
      proxy.pathname !== '/' || proxy.search || proxy.hash) {
    throw new Error('Use an inventory-managed HTTP CONNECT endpoint without credentials in the URL');
  }
  // All sessions of this account stay in the same retained allocation. The
  // product must exclusively lease it; a second writer cannot be fixed here.
  const configDir = `/data/claude/${binding.accountId}`;
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/agent',
    LANG: 'C.UTF-8', TMPDIR: '/tmp',
    ...Object.fromEntries(['SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']
      .filter(key => typeof inherited[key] === 'string').map(key => [key, inherited[key]])),
    ...PRIVACY_ENV,
    CLAUDE_CONFIG_DIR: configDir,
    HTTP_PROXY: proxy.href, HTTPS_PROXY: proxy.href,
    NO_PROXY: '127.0.0.1,localhost,::1',
  };
  // No ANTHROPIC_BASE_URL/API key, other account OAuth, cloud credential or
  // operator environment is forwarded from the controller/daemon.
  return { configDir, env };
}

export function readPrivateBinding(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && ![0, process.getuid()].includes(info.uid))) {
    throw new Error('The controller binding must be a private regular file owned by root or the runtime user');
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('The private Claude runtime binding could not be read as JSON'); }
}

export function requirePrivateState(path) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path ||
      (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('Retained account state must be a private, non-symlink directory owned by this runtime');
  }
}

export function adapterEntry() {
  const req = createRequire(import.meta.url);
  return join(dirname(req.resolve('@agentclientprotocol/claude-agent-acp/package.json')), 'dist/index.js');
}

export function supervise(child) {
  let interruptTimer, terminateTimer;
  const stop = () => {
    if (interruptTimer || child.exitCode !== null || child.signalCode !== null) return;
    // The controller first sends session/cancel and waits for the turn result.
    // This bounded shutdown is a last resort and does not prove completion.
    child.kill('SIGINT');
    interruptTimer = setTimeout(() => {
      child.kill('SIGTERM');
      terminateTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    }, 5000);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  child.once('error', () => { console.error('Claude adapter could not start'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    clearTimeout(interruptTimer); clearTimeout(terminateTimer);
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

export function main(args) {
  if (args.length !== 4 || args[0] !== '--binding' || args[2] !== '--owner') {
    throw new Error('Usage: launch.mjs --binding PRIVATE_FILE --owner AUTHENTICATED_OWNER');
  }
  if (process.getuid?.() === 0) throw new Error('Claude must run as a non-root user');
  const { configDir, env } = launchConfiguration(readPrivateBinding(args[1]), args[3], process.env);
  requirePrivateState(configDir);
  // ACP stdin/stdout pass unchanged to the upstream adapter. Its SDK resolves
  // its own pinned official native CLI; no binary/prompt/header rewrite occurs.
  const child = spawn(process.execPath, [adapterEntry()], { env, stdio: 'inherit' });
  supervise(child);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
