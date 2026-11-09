/** Reconstruct visible ACP assistant text in transport order. */
export function visibleAssistantText(messages) {
  return messages
    .filter(message => message.method === 'session/update'
      && message.params?.update?.sessionUpdate === 'agent_message_chunk'
      && message.params.update.content?.type === 'text'
      && typeof message.params.update.content.text === 'string')
    .map(message => message.params.update.content.text)
    .join('');
}
