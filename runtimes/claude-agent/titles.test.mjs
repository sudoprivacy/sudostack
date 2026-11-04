import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { adapterDirectory, prepareAdapter, checkPreparedAdapter } from './prepare-adapter.mjs';
import policy from './adapter-policy.json' with { type: 'json' };

const { SessionTitles } = await import(pathToFileURL(join(adapterDirectory, policy.file)));
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(Titles = SessionTitles, stored) {
  const updates = [], errors = [];
  let modelCalls = 0;
  const session = { cwd: '/not-a-real-workspace', queryClosed: false, cancelled: false,
    query: { generateSessionTitle: async () => { modelCalls++; return 'Generated title'; } } };
  const agent = { sessions: { fixture: session }, client: { sessionUpdate: async value => updates.push(value.update) },
    logger: { error: message => errors.push(message) } };
  const titles = new Titles(agent, 'fixture');
  // Stored transcript metadata is the test seam. All title lifecycle logic is
  // the real installed adapter module, with a recording SDK query boundary.
  titles.readSessionInfo = async () => stored;
  const prompt = text => [{ type: 'text', text }];
  return { titles, session, updates, errors, prompt, modelCalls: () => modelCalls };
}

test('long prompt, turn end, resume and reset never request a title model', async () => {
  const f = fixture();
  for (const text of ['Fix the login timeout\nand add a regression case', 'Continue after a conversation reset']) {
    f.titles.onPrompt(f.prompt(text));
    f.titles.onPromptQueued(f.session, f.prompt(text));
    await flush();
    f.titles.onAssistantText({ type: 'text', text: 'Implemented the change.' });
    await f.titles.onTurnEnd(f.session);
    await f.titles.publishCurrent(f.session);
    assert.equal(f.updates.at(-1).title, text.replace(/\s+/g, ' '));
    f.titles.reset();
  }
  assert.equal(f.modelCalls(), 0);
  assert.deepEqual(f.errors, []);
});

test('short opening plus assistant text also uses a local bounded title', async () => {
  const f = fixture();
  f.titles.onPrompt(f.prompt('hi'));
  f.titles.onPromptQueued(f.session, f.prompt('hi'));
  f.titles.onAssistantText({ type: 'text', text: 'A meaningful answer '.repeat(60) });
  await f.titles.onTurnEnd(f.session); await flush();
  assert.equal(f.modelCalls(), 0);
  assert.ok(f.updates.at(-1).title.length <= 256);
  assert.ok(f.updates.at(-1).title.length > 0);
});

test('stored titles and explicit user names win without inference', async () => {
  const f = fixture(SessionTitles, { customTitle: 'Existing official session title', lastModified: Date.now() });
  f.titles.onPromptQueued(f.session, f.prompt('Perform the next useful task'));
  await flush();
  assert.equal(f.updates.at(-1).title, 'Existing official session title');
  assert.equal(f.modelCalls(), 0);
  const explicit = fixture();
  await explicit.titles.setExplicitTitle('Owner-chosen title', async () => 'Owner-chosen title');
  explicit.titles.onPromptQueued(explicit.session, explicit.prompt('Another substantial task'));
  await explicit.titles.onTurnEnd(explicit.session); await flush();
  assert.equal(explicit.updates.at(-1).title, 'Owner-chosen title');
  assert.equal(explicit.modelCalls(), 0);
});

test('negative control: the original pinned adapter really requests inference', async () => {
  const prepared = readFileSync(join(adapterDirectory, policy.file), 'utf8');
  const original = prepared.replace(
    '// Sudo downstream policy: session titles never request inference.\n                sanitizeTitle(description) || fallback?.title || null;',
    '(await session.query.generateSessionTitle?.(description, {\n                    persist: true,\n                })) ?? null;');
  assert.equal(digest(original), policy.upstream_sha256);
  // Same package directory preserves the real SDK and relative imports. This
  // uniquely owned test module is removed even when the negative control fails.
  const file = join(adapterDirectory, 'dist', `session-titles.control-${process.pid}.js`);
  writeFileSync(file, original, { flag: 'wx' });
  try {
    const { SessionTitles: OriginalTitles } = await import(pathToFileURL(file));
    const f = fixture(OriginalTitles);
    f.titles.onPromptQueued(f.session, f.prompt('Fix the login timeout and verify it'));
    await flush();
    assert.equal(f.modelCalls(), 1);
  } finally { rmSync(file); }
});

test('preparation is idempotent and refuses source/version drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sudo-title-policy-'));
  try {
    mkdirSync(join(directory, 'dist'));
    const file = join(directory, policy.file);
    const prepared = readFileSync(join(adapterDirectory, policy.file));
    writeFileSync(file, prepared);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: policy.adapter_version }));
    assert.deepEqual(prepareAdapter(directory), { policy: policy.policy, changed: false });
    writeFileSync(file, Buffer.concat([prepared, Buffer.from('\n// drift')]));
    assert.throws(() => prepareAdapter(directory), /Unreviewed/);
    assert.throws(() => checkPreparedAdapter(directory), /not prepared/);
    writeFileSync(file, prepared);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: 'unreviewed' }));
    assert.throws(() => prepareAdapter(directory), /version/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
