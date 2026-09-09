/**
 * Determines whether a chat reply may start before message persistence finishes.
 *
 * Every interactive chat mode keeps an optimistic user row in the app and the
 * transport queue retries persistence independently. Waiting for a degraded
 * database before starting Owner AI can otherwise strand a valid message at
 * USER_ROW_INSERTED even though the live AI endpoint is available.
 */
export function shouldStartAssistantBeforePersistence(input: {
  localFirstChatMode: boolean;
  mode: 'send_only' | 'send_and_ai' | 'ai_only' | 'attachment';
}): boolean {
  return input.mode === 'send_and_ai' || input.mode === 'ai_only';
}
