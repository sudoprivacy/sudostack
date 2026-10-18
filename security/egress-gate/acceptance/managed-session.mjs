// Drives the released cohost over its authenticated ACP mailbox protocol.
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'node:fs';

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
const input = scenario === 'redact' || scenario === 'deny'
  ? `Synthetic credential ${secret}. Reply MANAGED_GATE_OK.` : 'Reply MANAGED_GATE_OK.';
let started;
let operator;
try {
  await rpc(admin, 'Setattr', {
    path: '/cloud-model', entry_type: 2, backend_type: 'anthropic', backend_name: 'managed-acceptance',
    zone_id: 'root', backend_params: {
      base_url: modelUrl, api_key: 'synthetic-only', blob_root: `${work}/model-cache`,
    },
  });
  const minted = await rpc(zone, 'MintAgent', { subject_id: 'acceptance-controller', display_name: 'Synthetic DLP acceptance' });
  if (!minted.success) throw new Error(minted.error);
  operator = new api.nexus.grpc.vfs.NexusVFSService(address,
    grpc.credentials.createSsl(Buffer.from(minted.ca_pem), Buffer.from(minted.agent_key_pem), Buffer.from(minted.agent_cert_pem)), options);
  clients.push(operator);
  started = await call(operator, 'managed_agent.start_session_v1', {
    agent_id: 'managed-egress-agent', model: 'managed-fixture', owner_id: 'root', zone_id: 'root',
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
  const report = { scenario, passed: true, managed_session: true, authenticated_controller: true,
    caller_received_error: rejected, visible_answer: visible, local_original_retained: true,
    error: result.error ?? null, model: 'managed-fixture' };
  fs.writeFileSync(`${work}/client.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (started && operator) await call(operator, 'managed_agent.cancel_v1', { session_id: started.session_id, mode: 'session' }).catch(() => {});
  for (const client of clients) client.close();
}
