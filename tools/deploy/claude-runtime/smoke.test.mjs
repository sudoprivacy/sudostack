import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { adapterEntry, launchConfiguration } from './launch.mjs';

test('pinned real ACP adapter initializes without an account or model request', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-acp-smoke-'));
  const deployment = {
    ownerId:'fixture', organizationId:'fixture', microPoolId:'fixture', accountId:1,
    email:'fixture@example.com', httpProxy:'http://127.0.0.1:9',
    privacy:{ policyVersion:'claude-optional-data-v1', email:'fixture@example.com',
      locationMetadata:false, modelImprovement:false, persistedReadback:true },
  };
  const env = launchConfiguration(deployment, 'fixture').env;
  env.HOME = directory; env.CLAUDE_CONFIG_DIR = directory;
  const child = spawn(process.execPath, [adapterEntry()], { env, stdio:['pipe','pipe','pipe'] });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({code,signal})));
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    // Drain diagnostics without logging paths, transcripts or auth material.
    child.stderr.resume();
    const result = await new Promise((resolve,reject) => {
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Adapter exited before initialize')));
      createInterface({input:child.stdout}).on('line', line => {
        try { const message=JSON.parse(line); if (message.id===1) resolve(message); }
        catch { reject(new Error('ACP stdout is not NDJSON')); }
      });
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{
        protocolVersion:1,clientInfo:{name:'sudo-startup-check',version:'1'},clientCapabilities:{},
      }})+'\n');
    });
    assert.equal(result.error, undefined);
    assert.equal(result.result.protocolVersion, 1);
    assert.ok(result.result.agentCapabilities);
    // No session/new, authenticate or session/prompt is sent by this check.
    child.stdin.end();
    assert.deepEqual(await exit, {code:0,signal:null});
  } finally {
    clearTimeout(timer);
    if (child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');
    rmSync(directory, {recursive:true,force:true});
  }
});
