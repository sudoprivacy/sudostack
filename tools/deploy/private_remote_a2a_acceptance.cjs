// A bounded remote-device canary through the existing SudoCode SDK and Node.
// This checks authenticated transport, not autonomous work or a durable host.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
process.umask(0o077);
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(config.sdk, 'manifest.json')));
assert.equal(manifest.dirty, false);
assert.equal(manifest.sourceCommit, config.sdkSource);
for (const [name, entry] of Object.entries(manifest.files)) {
  assert(!path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'));
  assert.equal(sha(fs.readFileSync(path.join(config.sdk, name))), entry.sha256, name);
}
assert.equal(sha(fs.readFileSync(config.scode)), config.scodeSha256);
assert(/^[a-zA-Z0-9-]+$/.test(config.actor));
assert(/^[a-f0-9]{32}$/.test(config.nonce));
assert(path.isAbsolute(config.output) && !fs.existsSync(config.output));
fs.mkdirSync(config.output, {mode: 0o700});
const sdk = require(path.join(config.sdk, 'dist/index.cjs'));
let connection, provider, timer, modelCalls = 0, catalogReads = 0, answered = false;
const errors = [], wire = [];
let resolveMessage, rejectMessage;
const finished = new Promise((resolve, reject) => {resolveMessage = resolve; rejectMessage = reject;});
// A failure may arrive during initialization, before main awaits finished.
finished.catch(() => {});
function save(name, value) {
  fs.writeFileSync(path.join(config.output, name), JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
}
async function main() {
  const configuration = path.join(config.output, 'config');
  fs.mkdirSync(configuration, {mode: 0o700});
  provider = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      catalogReads++; response.writeHead(200, {'content-type': 'application/json'}); response.end('{"data":[]}');
    } else {
      modelCalls++; response.writeHead(503); response.end('{}');
      rejectMessage(new Error('Unexpected inference request'));
    }
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(configuration, 'sudocode.json'), JSON.stringify({
    auth_modes: {'api-key': {anthropic: {baseUrl: `http://127.0.0.1:${provider.address().port}`, apiKey: 'fixture-no-inference'}}},
    models: {'private-fixture': {alias: 'private-fixture', name: 'Transport canary', input: ['text'],
      providers: {'api-key': {provider: 'anthropic', model: 'claude-sonnet-4-6'}}}}
  }), {mode: 0o600});
  const selected = path.join(config.workspace, '.nexus/sudocode/settings.json');
  if (fs.existsSync(selected)) assert.equal(JSON.parse(fs.readFileSync(selected)).agentName, config.actor);
  else {
    fs.mkdirSync(path.dirname(selected), {recursive: true, mode: 0o700});
    fs.writeFileSync(selected, JSON.stringify({agentName: config.actor}), {mode: 0o600, flag: 'wx'});
  }
  const environment = Object.fromEntries(Object.keys(process.env)
    .filter(key => /^(ANTHROPIC_|OPENAI_|PROXY_|CLAUDE_CODE_OAUTH|NEXUS_|SCODE_|SUDO_CODE_)/.test(key))
    .map(key => [key, null]));
  Object.assign(environment, {SUDO_CODE_CONFIG_HOME: configuration, SCODE_SERVICE_ROOT: path.join(config.output, 'service')});
  connection = await sdk.connectScode({
    scodeArgv: [config.scode, '--auth', 'api-key', '--account', 'anthropic', '--model', 'private-fixture',
      '--permission-mode', 'workspace-write', '--allowedTools', 'agent_list', '--allowedTools', 'send', 'acp'],
    workspace: config.workspace, env: environment, startupTimeoutMs: 60000,
    peerInputVersion: 1, stderrLog: path.join(config.output, 'scode.stderr'),
    onPermission: async () => {throw new Error('Unexpected permission request');},
    onError: error => {errors.push(String(error)); rejectMessage(error);},
    onProtocol: (direction, message) => wire.push({direction, message}),
    onPeerMessage: async message => {
      if (message.sudocode.a2a.from !== config.peer || message.sudocode.a2a.verified !== true
          || message.body !== `SG-A2A-CHALLENGE ${config.nonce}` || answered) return;
      answered = true;
      save('received.json', message);
      try {
        assert(connection, 'Connection was not established');
        const sent = await sdk.sendScodeMessage(connection, {to: config.peer,
          message: `SG-A2A-RETURN ${config.nonce}`, summary: 'Singapore native A2A transport canary result'});
        save('sent.json', sent);
        assert.equal(sent.isError, false);
        assert.equal(sdk.scodeNativeA2aAudit(sent).actor, config.actor);
        resolveMessage();
      } catch (error) {rejectMessage(error);}
    }
  });
  const identity = sdk.requireScodeNodeIdentity(connection, await sdk.listScodeAgents(connection), config.actor);
  save('ready.json', {actor: config.actor, sessionId: connection.sessionId, pid: connection.pid,
    identity, mode: 'bounded-client-owned-transport-canary', modelKeyInstalled: false});
  timer = setTimeout(() => rejectMessage(new Error('No exact authenticated challenge in 300 seconds')), 300000);
  await finished;
  assert.equal(modelCalls, 0); assert.deepEqual(errors, []);
  assert(!wire.some(row => row.direction === 'outgoing' && row.message?.method === 'session/prompt'));
  save('receipt.json', {success: true, actor: config.actor, sessionId: connection.sessionId,
    authenticatedChallengeReceived: true, nativeReplySubmitted: true, modelCalls, catalogReads,
    limits: ['Receiver must independently confirm reply delivery', 'No model task, reboot or durable host acceptance']});
}
main().catch(error => {save('failure.json', {error: String(error)}); process.exitCode = 1;}).finally(async () => {
  clearTimeout(timer);
  try {if (connection) await connection.close();} catch (error) {errors.push(String(error)); process.exitCode = 1;}
  if (provider) await new Promise(resolve => provider.close(resolve));
  save('protocol.json', {wire, errors, modelCalls, catalogReads});
});
