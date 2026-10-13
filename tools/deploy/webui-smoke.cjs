// Read by smoke.py and run through kubectl exec, with private configuration on stdin.
const WebSocket = require('ws');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(config.origin + path, {
    method, headers: {'Content-Type': 'application/json', Origin: config.origin, Cookie: cookie},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
  assert(res.ok, `${method} ${path}: HTTP ${res.status}`);
  return res.json();
}
(async () => {
  await api('/api/auth/login/password', {username: config.username, password: config.password});
  assert(cookie, 'login did not set a session cookie');
  const id = config.sessionId || (await api('/api/conversations', {assistantName: '', enabledSkills: []})).id;
  assert(id, 'no session id');
  if (config.sessionId) {
    const history = await api(`/api/conversations/${id}/context`);
    assert(JSON.stringify(history.messages).includes(config.previousNonce), 'previous transcript was lost');
  }
  const nonce = 'MOSS_E2E_TOKEN_atlas_' + crypto.randomUUID().replaceAll('-', '');
  let text = '', sent = false;
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(config.origin.replace('https:', 'wss:') + '/ws/conversations/' + id, {
      headers: {Cookie: cookie, Origin: config.origin},
    });
    const timer = setTimeout(() => finish(new Error('conversation timed out')), 240000);
    let done = false;
    function finish(error) {
      if (done) return;
      done = true; clearTimeout(timer); ws.close(); error ? reject(error) : resolve();
    }
    ws.on('error', finish);
    ws.on('close', () => {if (!done) finish(new Error('websocket closed before result'));});
    ws.on('message', async raw => {
      try {
        const message = JSON.parse(raw);
        if (message.kind === 'error') throw new Error('WebUI: ' + message.code);
        const event = message.kind === 'upstream' ? message.event : {};
        if (message.kind === 'writer' && message.isWriter && !sent) {
          sent = true;
          // Keep the live sandbox observable before the short mock response.
          await sleep(8000);
          ws.send(JSON.stringify({kind: 'send', msgId: crypto.randomUUID(), text: 'Reply with this exact token: ' + nonce, images: []}));
        }
        if (event.type === 'assistant') {
          const content = event.message?.content;
          text += typeof content === 'string' ? content : (content || []).map(c => c.text || '').join('');
        }
        if (event.type === 'result') {
          assert.equal(event.status, 'success'); assert(text.includes(nonce), 'response nonce missing'); finish();
        }
      } catch (error) {finish(error);}
    });
  });
  for (let i = 0; i < 30; i++) {
    const context = await api(`/api/conversations/${id}/context`);
    if (JSON.stringify(context.messages).includes(nonce)) {
      console.log(JSON.stringify({passed: true, sessionId: id, nonce, https: true, webuiLogin: true, websocket: true, transcript: true, resumed: Boolean(config.sessionId)}));
      process.exit(0);
    }
    await sleep(1000);
  }
  throw new Error('transcript did not persist');
})().catch(e => { console.error(e.message); process.exit(1); });
