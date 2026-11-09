import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleAssistantText } from './session-output.mjs';

function chunk(text, sessionUpdate = 'agent_message_chunk') {
  return { method: 'session/update', params: { update: { sessionUpdate, content: { type: 'text', text } } } };
}

test('visible reply is independent of arbitrary streaming chunk boundaries', () => {
  const messages = ['MAN', 'AGED', '_GATE', '_OK'].map(text => chunk(text));
  assert.equal(visibleAssistantText(messages), 'MANAGED_GATE_OK');
});

test('reasoning, user input and tool output cannot satisfy the visible reply assertion', () => {
  const messages = [chunk('MANAGED_GATE_OK', 'agent_thought_chunk'),
    chunk('MANAGED_GATE_OK', 'user_message_chunk'), chunk('MANAGED_GATE_OK', 'tool_call_update'),
    { id: 'turn', result: { echo: 'MANAGED_GATE_OK' } }];
  assert.equal(visibleAssistantText(messages), '');
});

test('only text content is concatenated in order', () => {
  const messages = [chunk('答案'), chunk('42'), { method: 'session/update', params: { update: {
    sessionUpdate: 'agent_message_chunk', content: { type: 'image', text: 'ignored' },
  } } }];
  assert.equal(visibleAssistantText(messages), '答案42');
});
