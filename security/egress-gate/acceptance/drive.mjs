// Drive the gated daemon: mount a gated egress route and an ungated local
// route to the same Router, send a prompt carrying synthetic customer data
// to each (plus the egress prompt again as Python's json.dumps writes it),
// and wait for the real model to answer all three.
//
// Inputs (all from the environment, set by run.sh): WORK, ENDPOINT,
// PROXY_URL, PROTO, ROUTER_KEY, MODEL.
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'node:fs';

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const work = env('WORK');
const proto = env('PROTO');
const defs = protoLoader.loadSync([proto + '/nexus/grpc/vfs/vfs.proto'], {
  keepCase: true, longs: String, defaults: true, includeDirs: [proto],
});
const api = grpc.loadPackageDefinition(defs);
const tls = work + '/data/tls/';
const vfs = new api.nexus.grpc.vfs.NexusVFSService(
  env('ENDPOINT'),
  grpc.credentials.createSsl(fs.readFileSync(tls + 'ca.pem'), fs.readFileSync(tls + 'node-key.pem'), fs.readFileSync(tls + 'node.pem')),
  { 'grpc.ssl_target_name_override': 'nexus-node', 'grpc.default_authority': 'nexus-node' },
);
async function rpc(method, data) {
  const r = await new Promise((resolve, reject) =>
    vfs[method](data, { deadline: Date.now() + 120000 }, (e, r) => (e ? reject(e) : resolve(r))));
  if (r.is_error) throw new Error(method + ': ' + (r.error_payload?.toString() || r.payload?.toString()));
  return r;
}

const proxy = env('PROXY_URL');
for (const [mount, label] of [['/cloud-model', 'egress'], ['/model', 'local']]) {
  await rpc('Setattr', {
    path: mount, entry_type: 2, backend_type: 'openai', backend_name: label + '-router', zone_id: 'model',
    backend_params: { base_url: `${proxy}/${label}/v1`, api_key: env('ROUTER_KEY'), blob_root: `${work}/blob-${label}` },
  });
  console.log('MOUNTED', mount, '->', label);
}

// Synthetic fixtures only: a GB 11643 specimen id, a network test card, a
// placeholder name and (when FAKE_KEY is set) a fake API key. Nothing here
// belongs to anyone.
const fakeKey = process.env.FAKE_KEY ? `，接口密钥 ${process.env.FAKE_KEY}` : '';
const content = '客户档案：姓名张三，身份证 11010519491231002X，手机 13912345678，'
  + `银行卡 6212 3456 7890 1232${fakeKey}。请只回复两个字：收到。`;
const request = Buffer.from(JSON.stringify({
  model: env('MODEL'), max_tokens: 1024, messages: [{ role: 'user', content }],
}));

// The same request as Python's json.dumps writes it by default: every
// non-ASCII character as a backslash-u escape. A detector reading the raw
// text would see only ASCII here. Built from the code point so the source
// holds no escape for a tool to rewrite.
const BS = String.fromCharCode(0x5c);
function escapeNonAscii(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    out += u > 127 ? BS + 'u' + u.toString(16).padStart(4, '0') : s[i];
  }
  return out;
}
const escaped = Buffer.from(escapeNonAscii(request.toString()));
if ([...escaped.toString()].some((c) => c.charCodeAt(0) > 127)) throw new Error('escaped request still has non-ASCII');

for (const [mount, stem, body] of [
  ['/cloud-model', 'ask-1', request], ['/cloud-model', 'ask-2', escaped], ['/model', 'ask-1', request],
]) {
  const ask = `${mount}/${stem}.prompt`;
  await rpc('Write', { path: ask, content: body });
  const replyPath = ask.replace(/\.prompt$/, '.reply');
  const deadline = Date.now() + 300000;
  let reply = '';
  while (Date.now() < deadline) {
    try {
      reply = (await rpc('StreamCollectAll', { path: replyPath })).data.toString();
      if (reply.includes('"done"') || reply.includes('"error"')) break;
    } catch (_) { /* reply stream not open yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const name = `${mount.slice(1)}-${stem}`;
  fs.writeFileSync(`${work}/out-${name}.reply`, reply);
  fs.writeFileSync(`${work}/out-${name}.stored-prompt`, (await rpc('Read', { path: ask })).content);
  const terminal = reply.includes('"done"') ? 'done' : reply.includes('"error"') ? 'error' : 'none';
  console.log('ASKED', ask, 'reply_bytes', reply.length, 'terminal', terminal);
}
vfs.close();
