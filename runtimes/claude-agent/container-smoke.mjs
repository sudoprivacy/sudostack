/** Image-layout qualification only: no real account, network, task or gVisor. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const image = process.argv[2];
if (!image || process.argv.length !== 3) throw new Error('Usage: container-smoke.mjs LOCAL_CANDIDATE_IMAGE');
const name = `sudo-claude-layout-${randomUUID()}`;
const fixture = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
mkdirSync('/data/claude/1', { recursive: true, mode: 0o700 });
writeFileSync('/private-runtime-config/account.json', JSON.stringify({
  ownerId:'fixture', organizationId:'fixture', microPoolId:'fixture', accountId:1,
  email:'fixture@example.com', httpProxy:'http://127.0.0.1:9',
  privacy:{policyVersion:'claude-optional-data-v1',email:'fixture@example.com',
    locationMetadata:false,modelImprovement:false,persistedReadback:true}
}), { mode: 0o600 });
const child=spawn(process.execPath,['/opt/claude-runtime/launch.mjs',
  '--binding','/private-runtime-config/account.json','--owner','fixture'],{stdio:'inherit'});
child.on('error',()=>{process.exitCode=1});
child.on('exit',(code)=>{process.exitCode=code??1});
`;
const child = spawn('docker', ['run', '--rm', '--name', name, '-i', '--network', 'none',
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000',
  '--tmpfs', '/data:uid=1000,gid=1000,mode=0700',
  '--tmpfs', '/private-runtime-config:uid=1000,gid=1000,mode=0700',
  '--tmpfs', '/home/agent:uid=1000,gid=1000,mode=0700', '--tmpfs', '/tmp:mode=1777',
  '--entrypoint', 'node', image, '--input-type=module', '--eval', fixture],
{ stdio: ['pipe', 'pipe', 'pipe'] });
const exit = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
try {
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Image launcher exited before ACP initialize')));
    createInterface({ input: child.stdout }).on('line', line => {
      try { const value = JSON.parse(line); if (value.id === 1) resolve(value); }
      catch { reject(new Error('Image ACP stdout is not NDJSON')); }
    });
    child.stderr.pipe(process.stderr);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: 1, clientInfo: { name: 'sudo-image-layout', version: '1' }, clientCapabilities: {},
    } }) + '\n');
  });
  assert.equal(result.error, undefined); assert.equal(result.result.protocolVersion, 1);
  child.stdin.end(); assert.deepEqual(await exit, { code: 0, signal: null });
  console.log(JSON.stringify({ image_layout: 'passed', uid: 1000, network: 'none',
    real_launcher: true, acp_initialize_eof: true, account: 'fixture', model_requests: 0,
    gvisor_qualification: false, production_worker: false }));
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  // Only this uniquely named test container; no fleet-wide cleanup.
  spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', timeout: 10000 });
}
