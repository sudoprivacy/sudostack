// Drive one autonomous release review over an actual named-Agent TLS pair.
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {setTimeout: sleep} = require('node:timers/promises');

module.exports = async function runPeerReview(config, sdk) {
  const [requester, verifier] = config.actors;
  const tag = randomUUID();
  const reference = randomUUID();
  const model = process.env.SUDOROUTER_MODEL;
  const endpoint = new URL(process.env.SUDOROUTER_BASE_URL);
  assert.equal(endpoint.protocol, 'https:');
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
  const events = [];
  const processes = new Set();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 135_000);
  const record = {tag, model, events, success: false};

  function observe(actor, direction, msg) {
    if (direction === 'outgoing' && msg.method === 'session/prompt') {
      events.push({type: 'prompt', actor});
    }
    if (direction === 'outgoing' && msg.method === '_sudocode/a2a/send') {
      events.push({type: 'controller-send', actor});
    }
    if (direction !== 'incoming' || msg.method !== 'session/update') return;
    const {sessionId, update, _meta} = msg.params;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      events.push({type: 'assistant', actor, sessionId, text: update.content.text});
    }
    if (update.sessionUpdate === 'user_message_chunk' && update.content?.type === 'text') {
      const source = _meta?.sudocode?.a2a;
      if (source) events.push({type: 'delivery', actor, sessionId, sender: source.from,
        verified: source.verified, sendId: source.sendId, deliveryId: source.deliveryId,
        text: update.content.text});
    }
    if (update.sessionUpdate === 'tool_call') events.push({type: 'tool', actor, name: update.title});
    if (update.sessionUpdate === 'usage_update') events.push({type: 'usage', actor, used: update.used});
  }

  async function open(actor, holdUnread, sessionId) {
    const input = {
      workspace: actor.workspace, env: actor.env, acpSessionId: sessionId,
      signal: controller.signal, startupTimeoutMs: 25_000, closeTimeoutMs: 3500,
      scodeArgv: [config.scode, '--auth', 'proxy', '--account', 'live', '--model', model,
        '--permission-mode', 'workspace-write', '--allowedTools', 'agent_list', '--allowedTools', 'send', 'acp'],
      onProtocol: (direction, msg) => observe(actor.name, direction, msg),
    };
    if (holdUnread) {
      input.peerInputVersion = 3;
      input.onPeerUnread = event => {
        events.push({type: 'unread', actor: actor.name, sessionId: event.sessionId, count: event.unread});
      };
    }
    const connection = await sdk.connectScode(input);
    processes.add(connection);
    sdk.requireScodeNodeIdentity(connection, await sdk.listScodeAgents(connection), actor.name);
    return connection;
  }
  async function waitFor(check, detail) {
    record.stage = detail;
    while (!check()) {
      if (controller.signal.aborted) throw new Error(detail);
      await sleep(100);
    }
  }
  const textFrom = (rows, actor) => rows.filter(e => e.type === 'assistant' && e.actor === actor)
    .map(e => e.text).join('').replace(/[`*]/g, '');
  const delivered = (e, actor, sender, sid) => e.type === 'delivery' && e.actor === actor
    && e.sender === sender && e.sessionId === sid && e.verified === true && e.text.includes(tag);
  try {
    for (const actor of config.actors) {
      fs.writeFileSync(path.join(actor.configHome, 'sudocode.json'), JSON.stringify({
        auth_modes: {proxy: {live: {baseUrl: endpoint.href, apiKeyEnv: 'SUDOROUTER_API_KEY'}}},
        models: {[model]: {alias: model, name: model, input: ['text'],
          providers: {proxy: {provider: 'live', model}}}},
      }));
      fs.writeFileSync(path.join(actor.workspace, '.nexus/sudocode/settings.json'),
        JSON.stringify({agentName: actor.name, maxSteps: 4}));
    }
    // Only the verifier receives the decision reference. The user prompt carries the release ID.
    fs.writeFileSync(path.join(verifier.workspace, 'AGENTS.md'),
      'You review releases. The owner is away so every request must be declined. ' +
      'Reply once to the requesting peer with the release ID, your decision, and this decision reference: ' +
      reference + '. End your task after sending the reply.');
    const sender = await open(requester, false);
    const held = await open(verifier, true);
    record.requesterSession = sender.sessionId;
    record.verifierSession = held.sessionId;
    const task = 'Send one review request for release ' + tag + ' to the known inbox ' +
      verifier.name + ' using the send tool. This named inbox accepts queued requests while the reviewer is away. ' +
      'Report status as a single line. ' +
      'Until the reviewer replies, the status is PENDING. For a decision use APPROVED or DECLINED ' +
      'followed by the reviewer’s decision reference. Update the status when their reply arrives.';
    const first = await sender.request('session/prompt', {
      sessionId: sender.sessionId, prompt: [{type: 'text', text: task}],
    });
    assert.equal(first.stopReason, 'end_turn');
    assert(events.some(e => e.type === 'tool' && e.actor === requester.name && e.name === 'send'),
      'Requester ended its turn without attempting the named review request');
    await waitFor(() => events.some(e => e.type === 'unread' && e.sessionId === held.sessionId && e.count > 0),
      'No review request reached the verifier inbox');
    record.beforeResume = events.length;
    assert(!events.some(e => e.type === 'delivery' && e.actor === requester.name));
    const before = textFrom(events, requester.name);
    assert.match(before, /\bPENDING[.!]?\s*$/i, 'Requester must report the missing decision');
    assert(!before.includes(reference) && !/\b(?:APPROVED|DECLINED)\b/i.test(before),
      'Requester reported a decision before an authenticated reply');
    await held.close();
    processes.delete(held);
    const resumed = await open(verifier, false, held.sessionId);
    assert.equal(resumed.sessionId, held.sessionId);
    const inbound = () => events.findIndex(e => delivered(e, requester.name, verifier.name, sender.sessionId));
    await waitFor(() => inbound() >= 0, 'No authenticated reviewer decision');
    const reply = inbound();
    assert(events.slice(record.beforeResume, reply).some(e =>
      delivered(e, verifier.name, requester.name, resumed.sessionId)), 'Verifier did not receive the original request');
    assert(events[reply].text.includes(reference), 'Authenticated reply must carry the verifier’s decision reference');
    assert(!textFrom(events.slice(0, reply), requester.name).includes(reference));
    // Allow the release label and the word "ref" used by real clients.
    // The decision and exact verifier-only reference must be on the same status line.
    const expected = new RegExp('^(?:Release\\s+' + tag + '\\s*[:\\u2013\\u2014-]\\s*)?' +
      '(?:status:\\s*)?DECLINED\\b[\\s:,.\\u2013\\u2014-]+' +
      '(?:(?:decision\\s+)?ref(?:erence)?[\\s:#-]+)?' + reference + '[.!]?$', 'i');
    await waitFor(() => textFrom(events.slice(reply + 1), requester.name)
      .split(/\r?\n/).some(line => expected.test(line.trim())),
      'Requester did not report the authenticated refusal');
    assert.deepEqual(events.filter(e => e.type === 'prompt').map(e => e.actor), [requester.name]);
    assert(!events.some(e => e.type === 'controller-send'));
    record.stage = 'completed';
    record.success = true;
    return {success: true, heldUnread: true, heldStatus: 'pending', verifierSessionRestored: true,
      authenticatedRefusal: true, reportedOriginalReference: true, directUserPrompts: 1};
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await Promise.allSettled([...processes].map(c => c.close()));
    fs.writeFileSync(path.join(config.output, 'live-review.protocol.json'), JSON.stringify(record, null, 2),
      {mode: 0o600});
  }
};
