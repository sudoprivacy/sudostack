// Real native SDK/CLI acceptance; no private ACP or mailbox implementation.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const phase = process.argv[3];
assert(['initial', 'node-restart'].includes(phase));
const manifest = JSON.parse(fs.readFileSync(path.join(config.sdk, 'manifest.json')));
assert.equal(manifest.dirty, false, 'Use a clean committed SDK build');
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = fs.readFileSync(path.join(config.sdk, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
}
const sdk = require(path.join(config.sdk, 'dist/index.cjs'));
const owned = new Set(), inbox = new Map(), errors = [], wire = [], httpRequests = [];
let model, modelCalls = 0;
function save(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
}
async function open(actor, resume) {
  const file = path.join(config.root, actor.name + '.profile.json');
  const profile = resume ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
    workspace: actor.workspace, env: actor.env,
    scodeArgv: [config.scode, '--auth', 'api-key', '--account', 'anthropic', '--model', 'private-fixture',
      '--permission-mode', 'workspace-write', '--allowedTools', 'agent_list', '--allowedTools', 'send', 'acp'],
    stderrLog: path.join(config.output, actor.name + '.stderr.log')};
  const messages = [];
  inbox.set(actor.name, messages);
  const connection = await sdk.connectScode({...profile, peerInputVersion: 2,
    onPeerMessage: async message => {
      const fd = fs.openSync(path.join(config.output, actor.name + '.messages.jsonl'), 'a', 0o600);
      try { fs.writeSync(fd, JSON.stringify(message) + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      messages.push(message);
    }, onError: error => errors.push(String(error)),
    onProtocol: (direction, message) => wire.push({direction, message})});
  owned.add(connection);
  if (resume) assert.equal(connection.sessionId, profile.acpSessionId);
  else save(file, {...profile, acpSessionId: connection.sessionId});
  const listed = await sdk.listScodeAgents(connection);
  sdk.requireScodeNodeIdentity(connection, listed, actor.name);
  return connection;
}
async function close(connection) {
  await connection.close();
  owned.delete(connection);
}
async function send(connection, recipient, body) {
  const result = await sdk.sendScodeMessage(connection, {
    to: recipient, message: body, summary: 'Private bootstrap acceptance ' + phase});
  assert.equal(result.isError, false, JSON.stringify(result));
  return result;
}
async function received(actor, sender, body) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const matches = inbox.get(actor).filter(message => message.body === body);
    if (matches.length) {
      assert.equal(matches.length, 1);
      assert.equal(matches[0].sudocode.a2a.from, sender);
      assert.equal(matches[0].sudocode.a2a.verified, true);
      return matches[0];
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('No authenticated exact message received by ' + actor);
}
async function main() {
  model = http.createServer((request, response) => {
    httpRequests.push({method: request.method, path: request.url});
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end('{"data":[]}');
    } else {
      modelCalls++;
      response.writeHead(503); response.end('{}');
    }
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  for (const actor of config.actors) {
    save(path.join(actor.configHome, 'sudocode.json'), {auth_modes: {'api-key': {
      anthropic: {baseUrl: `http://127.0.0.1:${model.address().port}`, apiKey: 'fixture-no-inference'}}},
      models: {'private-fixture': {alias: 'private-fixture', name: 'Private no-inference fixture',
        input: ['text'], providers: {'api-key': {provider: 'anthropic', model: 'claude-sonnet-4-6'}}}}});
  }
  const [a, b] = config.actors;
  const sender = await open(a, phase !== 'initial');
  let receiver = await open(b, phase !== 'initial');
  const body = `PRIVATE-A2A-${phase}-${randomUUID()} 汉字`;
  const sent = await send(sender, b.name, body);
  assert.equal(sdk.scodeNativeA2aAudit(sent).actor, a.name);
  await received(b.name, a.name, body);
  await send(receiver, a.name, 'ACK ' + body);
  await received(a.name, b.name, 'ACK ' + body);
  if (phase === 'initial') {
    const original = receiver.sessionId;
    await close(receiver);
    await send(sender, b.name, 'OFFLINE ' + body);
    receiver = await open(b, true);
    assert.equal(receiver.sessionId, original);
    await received(b.name, a.name, 'OFFLINE ' + body);
  }
  await close(receiver); await close(sender);
  assert.equal(modelCalls, 0, 'Native enrollment/A2A/resume must not invoke a model: ' + JSON.stringify(httpRequests));
  assert(!wire.some(row => row.direction === 'outgoing' && row.message?.method === 'session/prompt'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({success: true, phase, authenticatedBidirectionalMessages: true,
    receiverOfflineDelivery: phase === 'initial', originalSessionIdsLoaded: phase !== 'initial',
    modelCalls, catalogReads: httpRequests.length, sdkSource: manifest.sourceCommit}));
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {
  await Promise.allSettled([...owned].map(connection => connection.close()));
  if (model) await new Promise(resolve => model.close(resolve));
  save(path.join(config.output, phase + '.protocol.json'), {wire, errors, modelCalls, httpRequests});
});
