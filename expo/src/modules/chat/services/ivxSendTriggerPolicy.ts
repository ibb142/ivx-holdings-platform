/**
 * Determines whether a chat reply may start before message persistence finishes.
 *
 * Local-first mode keeps an optimistic user row in the app and retries durable
 * persistence independently. Waiting for that queue before starting Owner AI
 * can otherwise strand a valid message at USER_ROW_INSERTED.
 */
export function shouldStartAssistantBeforePersistence(input: {
  localFirstChatMode: boolean;
  mode: 'send_only' | 'send_and_ai' | 'ai_only' | 'attachment';
}): boolean {
  return input.localFirstChatMode && (input.mode === 'send_and_ai' || input.mode === 'ai_only');
}
