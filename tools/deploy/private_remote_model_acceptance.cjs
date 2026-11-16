// One bounded real-model task on an already enrolled device. Native SDK only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
process.umask(0o077);
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert(path.isAbsolute(config.output) && !fs.existsSync(config.output));
fs.mkdirSync(config.output, {mode: 0o700});
const save = (name, value) => fs.writeFileSync(path.join(config.output, name), JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
let connection, timer, keyRemoved = false;
const wire = [], errors = [];
const owner = new AbortController();
async function main() {
  const settings = JSON.parse(fs.readFileSync(path.join(config.modelConfigHome, 'settings.json')));
  assert.equal(settings.maxSteps, 4, 'The disposable model configuration must retain its tool-step cap');
  const manifest = JSON.parse(fs.readFileSync(path.join(config.sdk, 'manifest.json')));
  assert.equal(manifest.dirty, false); assert.equal(manifest.sourceCommit, config.sdkSource);
  for (const [name, entry] of Object.entries(manifest.files)) {
    assert(!path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'));
    assert.equal(sha(fs.readFileSync(path.join(config.sdk, name))), entry.sha256, name);
  }
  assert.equal(sha(fs.readFileSync(config.scode)), config.scodeSha256);
  const sdk = require(path.join(config.sdk, 'dist/index.cjs'));
  const environment = Object.fromEntries(Object.keys(process.env)
    .filter(key => /^(ANTHROPIC_|OPENAI_|PROXY_|CLAUDE_CODE_OAUTH|NEXUS_|SCODE_|SUDO_CODE_)/.test(key)).map(key => [key, null]));
  Object.assign(environment, {SUDO_CODE_CONFIG_HOME: config.modelConfigHome, SCODE_SERVICE_ROOT: path.join(config.output, 'service')});
  timer = setTimeout(() => owner.abort(), 180000);
  connection = await sdk.connectScode({workspace: config.workspace, acpSessionId: config.sessionId,
    scodeArgv: [config.scode, '--auth', 'proxy', '--account', 'sudorouter', '--model', 'claude-sonnet-4-6',
      '--permission-mode', 'workspace-write', '--allowedTools', 'write_file', '--allowedTools', 'read_file', '--allowedTools', 'send', 'acp'],
    env: environment, signal: owner.signal, stderrLog: path.join(config.output, 'scode.stderr'),
    onProtocol: (direction, message) => wire.push({direction, message}),
    onError: error => errors.push(String(error)),
    onPermission: async () => {throw new Error('No interactive approval is authorized by this canary');}
  });
  assert.equal(connection.sessionId, config.sessionId);
  const file = path.join(config.workspace, `model-check-${config.nonce}.txt`);
  assert(!fs.existsSync(file));
  const prompt = `The device owner authorized this single bounded acceptance task. Do exactly these steps, without shell commands or additional tasks.\n1. Use write_file to create ${file} containing exactly ${config.nonce}, without a newline.\n2. Use read_file to read that same file.\n3. Only if the actual read result equals the value you wrote, use send once to ${config.peer} with summary "Singapore real-model file check" and exact message "SG-MODEL-PASS ${config.nonce}".\n4. Finish. Do not reply to any acknowledgement. Use only write_file, read_file and send.`;
  save('prompt.json', {prompt});
  const result = await connection.request('session/prompt', {sessionId: connection.sessionId,
    prompt: [{type: 'text', text: prompt}]});
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(fs.readFileSync(file, 'utf8'), config.nonce);
  assert(!JSON.stringify(wire).includes('The computation step limit ('), 'Task hit its computation cap');
  assert.deepEqual(errors, []);
  save('receipt.json', {success: true, actor: config.actor, originalSessionLoaded: true,
    sessionId: connection.sessionId, model: 'claude-sonnet-4-6', prompts: 1,
    artifact: file, artifactSha256: sha(fs.readFileSync(file)),
    limits: ['Inspect native tool calls and independently confirm authenticated model message', 'One run, no uptime or reboot claim']});
}
main().catch(error => {save('failure.json', {error: String(error)}); process.exitCode = 1;}).finally(async () => {
  clearTimeout(timer);
  try {if (connection) await connection.close();} catch (error) {errors.push(String(error)); process.exitCode = 1;}
  const credential = path.join(config.modelConfigHome, 'sudocode.json');
  if (fs.existsSync(credential)) {
    const stat = fs.lstatSync(credential);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid());
    const fd = fs.openSync(credential, 'r+');
    try {fs.writeSync(fd, Buffer.alloc(stat.size), 0, stat.size, 0); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.unlinkSync(credential); keyRemoved = true;
  }
  save('protocol.json', {wire, errors});
  save('cleanup.json', {temporaryCredentialRemoved: keyRemoved, ownedConnectionClosed: !connection || connection.closed,
    cleanShutdown: errors.length === 0, shutdownDiagnostics: errors});
});
