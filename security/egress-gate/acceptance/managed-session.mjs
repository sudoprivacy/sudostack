// Drives the released cohost over its authenticated ACP mailbox protocol.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(process.env.NODE_MODULES ? path.join(process.env.NODE_MODULES, '..', 'package.json') : import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const [work, proto, address, modelUrl, scenario] = process.argv.slice(2);
const definitions = protoLoader.loadSync([
  `${proto}/nexus/grpc/vfs/vfs.proto`, `${proto}/nexus/raft/transport.proto`,
], { keepCase: true, longs: Number, defaults: true, includeDirs: [proto] });
const api = grpc.loadPackageDefinition(definitions);
const options = { 'grpc.ssl_target_name_override': 'nexus-node', 'grpc.default_authority': 'nexus-node' };
const tls = `${work}/data/tls/`;
const credentials = grpc.credentials.createSsl(
  fs.readFileSync(`${tls}ca.pem`), fs.readFileSync(`${tls}node-key.pem`), fs.readFileSync(`${tls}node.pem`),
);
const admin = new api.nexus.grpc.vfs.NexusVFSService(address, credentials, options);
const zone = new api.nexus.raft.ZoneApiService(address, credentials, options);
const clients = [admin, zone];
const rpc = (client, method, data) => new Promise((resolve, reject) => {
  client[method](data, { deadline: Date.now() + 120000 }, (error, result) => {
    if (error) return reject(error);
    if (result.is_error) return reject(new Error(result.error_payload?.toString() || result.payload?.toString()));
    resolve(result);
  });
});
async function call(client, method, params) {
  const result = await rpc(client, 'Call', { method, payload: Buffer.from(JSON.stringify(params)) });
  const payload = JSON.parse(result.payload.toString());
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result ?? payload;
}
const secret = 'sk' + '-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const input = ['redact', 'deny', 'disabled-before', 'disabled-after', 'attached-http', 'standalone-http'].includes(scenario)
  ? `Synthetic credential ${secret}. Reply MANAGED_GATE_OK.` : 'Reply MANAGED_GATE_OK.';
let started;
let operator;
async function cliTurn() {
  const directory = path.join(work, 'cli-' + scenario);
  const home = path.join(directory, 'home');
  const bundle = path.join(home, '.nexus', 'agents', 'cli-acceptance-' + scenario);
  const project = path.join(directory, 'project');
  const configDirectory = path.join(directory, 'config');
  for (const name of [bundle, project, configDirectory, path.join(home, '.nexus', 'run')]) fs.mkdirSync(name, { recursive: true, mode: 0o700 });
  const agent = path.basename(bundle);
  const minted = await rpc(zone, 'MintAgent', { subject_id: agent, display_name: 'Synthetic CLI acceptance' });
  if (!minted.success) throw new Error(minted.error);
  for (const [name, content] of Object.entries({ 'ca.pem': minted.ca_pem, 'cert.pem': minted.agent_cert_pem, 'key.pem': minted.agent_key_pem })) {
    fs.writeFileSync(path.join(bundle, name), content, { mode: 0o600 });
  }
  fs.writeFileSync(path.join(bundle, 'credential.json'), JSON.stringify({ agent, server_name: 'nexus-node', ca: 'ca.pem', cert: 'cert.pem', key: 'key.pem' }), { mode: 0o600 });
  if (scenario !== 'standalone-http') fs.writeFileSync(path.join(home, '.nexus/run/node.json'), JSON.stringify({ version: 1, endpoint: address, agents_dir: path.dirname(bundle) }), { mode: 0o600 });
  const configuration = JSON.parse(fs.readFileSync(path.join(work, 'config/sudocode.json'), 'utf8'));
  if (scenario.endsWith('-http')) configuration.auth_modes['api-key'].anthropic = { baseUrl: modelUrl, apiKey: 'synthetic-only' };
  fs.writeFileSync(path.join(configDirectory, 'sudocode.json'), JSON.stringify(configuration));
  fs.writeFileSync(path.join(configDirectory, 'settings.json'), JSON.stringify({ agentName: agent }));
  const inherited = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'LANG', 'LC_ALL']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => inherited.has(key.toUpperCase())));
  Object.assign(env, { HOME: home, USERPROFILE: home, SCODE_GLOBAL_CONFIG_DIR: configDirectory });
  const child = spawn(process.env.SCODE_BIN, ['--print', '--model', 'managed-fixture', '--auth', 'api-key', '--permission-mode', 'read-only', '--output-format', 'json', input], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 90000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); }
  finally { clearTimeout(timer); }
  fs.writeFileSync(path.join(directory, 'output.jsonl'), stdout);
  fs.writeFileSync(path.join(directory, 'stderr.log'), stderr);
  const results = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = results.findLast(item => item.type === 'result');
  if (!result) throw new Error('CLI returned no structured terminal result; inspect ' + directory);
  const expectedReject = ['deny', 'outage', 'malformed'].includes(scenario);
  if (Boolean(result.is_error) !== expectedReject || (code !== 0) !== expectedReject) throw new Error('Unexpected CLI terminal verdict: ' + JSON.stringify(result));
  const visible = !result.is_error && String(result.result).includes('MANAGED_GATE_OK');
  if (!expectedReject && !visible) throw new Error('CLI produced no visible model answer');
  if (expectedReject && !/egress|classif|redact|denied|hook/i.test(JSON.stringify(result))) throw new Error('CLI failure did not identify the content gate');
  const transcripts = fs.readdirSync(project, { recursive: true }).filter(name => path.basename(name) === 'transcript.jsonl');
  const retained = transcripts.some(name => fs.readFileSync(path.join(project, name), 'utf8').includes(input));
  if (!retained) throw new Error('CLI original local input was not retained');
  fs.writeFileSync(path.join(work, 'events.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(work, 'started.json'), JSON.stringify({ cli: true, agent, exit_code: code }));
  return { scenario, passed: true, standalone_cli: true, authenticated_node: scenario !== 'standalone-http', model_via_nexus: !scenario.endsWith('-http'), caller_received_error: expectedReject, visible_answer: visible, local_original_retained: retained, model: 'managed-fixture' };
}
try {
  if (process.env.GATE_REUSE_MOUNT !== '1') await rpc(admin, 'Setattr', {
    path: '/cloud-model', entry_type: 2, backend_type: 'anthropic', backend_name: 'managed-acceptance',
    zone_id: 'root', backend_params: {
      base_url: modelUrl, api_key: 'synthetic-only', blob_root: `${work}/model-cache`,
    },
  });
  let report;
  if (process.env.SCODE_BIN) {
    report = await cliTurn();
  } else {
  const controllerId = `acceptance-controller-${scenario}`;
  const minted = await rpc(zone, 'MintAgent', { subject_id: controllerId, display_name: 'Synthetic DLP acceptance' });
  if (!minted.success) throw new Error(minted.error);
  const allowed = await rpc(zone, 'AllowSessionMinter', { agent_id: controllerId });
  if (!allowed.success) throw new Error(allowed.error);
  const controller = new api.nexus.raft.ZoneApiService(address,
    grpc.credentials.createSsl(Buffer.from(minted.ca_pem), Buffer.from(minted.agent_key_pem), Buffer.from(minted.agent_cert_pem)), options);
  clients.push(controller);
  const delegated = await rpc(controller, 'MintSessionAgent', { owner_id: 'root', validity_secs: 300 });
  if (!delegated.success) throw new Error(delegated.error);
  operator = new api.nexus.grpc.vfs.NexusVFSService(address,
    grpc.credentials.createSsl(Buffer.from(delegated.ca_pem), Buffer.from(delegated.agent_key_pem), Buffer.from(delegated.agent_cert_pem)), options);
  clients.push(operator);
  started = await call(operator, 'managed_agent.start_session_v1', {
    agent_id: `managed-egress-${scenario}`, model: 'managed-fixture', owner_id: 'root', zone_id: 'root',
  });
  fs.writeFileSync(`${work}/started.json`, JSON.stringify(started, null, 2));
  const endpoint = started.session_endpoint;
  if (endpoint?.protocol !== 'acp-mailbox/1') throw new Error('Missing production session endpoint');
  let sequence = 0;
  let received = 0;
  let offset = 0;
  const messages = [];
  async function send(message) {
    const frame = { protocol: endpoint.protocol, channel_id: endpoint.channel_id, sequence: ++sequence, type: 'rpc', message };
    const envelope = { from: endpoint.controller, to: endpoint.agent, kind: 'session', body: JSON.stringify(frame) };
    await rpc(operator, 'StreamWriteNowait', { path: endpoint.transcript, data: Buffer.from(JSON.stringify(envelope)) });
  }
  async function request(id, method, params) {
    await send({ jsonrpc: '2.0', id, method, params });
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline) {
      const response = await rpc(operator, 'StreamReadAt', { path: endpoint.transcript, offset, blocking: true, timeout_ms: 300 });
      offset = response.next_offset;
      if (!response.data?.length) continue;
      const envelope = JSON.parse(response.data.toString());
      if (envelope.kind !== 'session' || envelope.from !== endpoint.agent) continue;
      const frame = JSON.parse(envelope.body);
      if (frame.channel_id !== endpoint.channel_id || frame.sequence <= received) continue;
      if (frame.protocol !== endpoint.protocol || frame.sequence !== received + 1) throw new Error('Session ordering failed');
      received = frame.sequence;
      if (frame.type === 'closed') throw new Error('Session closed: ' + frame.reason);
      messages.push(frame.message);
      if (frame.message.id === id) return frame.message;
      if (frame.message.method === 'session/request_permission') throw new Error('Fixture unexpectedly requested tool approval');
    }
    throw new Error('No terminal session response');
  }
  const initialize = await request('init', 'initialize', { protocolVersion: 1, clientCapabilities: {} });
  if (initialize.error) throw new Error('Initialize failed');
  const opened = await request('new', 'session/new', { cwd: '/', mcpServers: [] });
  if (opened.error) throw new Error('Session creation failed');
  const result = await request('turn', 'session/prompt', {
    sessionId: opened.result.sessionId, prompt: [{ type: 'text', text: input }],
  });
  fs.writeFileSync(`${work}/events.json`, JSON.stringify(messages, null, 2));
  const rejected = Boolean(result.error);
  const expectedReject = ['deny', 'outage', 'malformed'].includes(scenario);
  if (rejected !== expectedReject) throw new Error('Unexpected terminal gate verdict: ' + JSON.stringify(result));
  const visible = JSON.stringify(messages).includes('MANAGED_GATE_OK');
  if (!expectedReject && !visible) throw new Error('No visible model answer');
  if (expectedReject && !/egress|classif|redact|denied|hook/i.test(JSON.stringify(result.error))) {
    throw new Error('Failure did not identify the content gate: ' + JSON.stringify(result.error));
  }
  const transcript = `/sessions/${started.durable_session_id}/transcript.jsonl`;
  const history = await rpc(admin, 'StreamCollectAll', { path: transcript });
  if (!history.data?.includes(Buffer.from(input))) throw new Error('Original local input was not retained');
  report = { scenario, passed: true, managed_session: true, authenticated_controller: true,
    caller_received_error: rejected, visible_answer: visible, local_original_retained: true,
    error: result.error ?? null, model: 'managed-fixture' };
  }
  if (process.env.LIVE_POLICY === '1') {
    const desired = JSON.parse(fs.readFileSync(`${work}/policy.json`, 'utf8'));
    const actual = await call(admin, 'egress_gate.get_policy_status_v1', {});
    for (const field of ['revision', 'enabled', 'mode']) if (actual[field] !== desired[field]) throw new Error('Native policy status differs: ' + field);
    if (actual.error) throw new Error('Native policy status reports an error');
    report.policy = actual;
  }
  fs.writeFileSync(`${work}/client.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (started && operator) await call(operator, 'managed_agent.cancel_v1', { session_id: started.session_id, mode: 'session' }).catch(() => {});
  for (const client of clients) client.close();
}
