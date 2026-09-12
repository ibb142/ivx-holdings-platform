import { createHash } from 'node:crypto';

/** Message identity survives retries; equal text in a new message is new work. */
export function chatWorkerIdentity(ownerId: string, conversationId: string | null, sourceMessageId: string) {
  const sourceChatMessageId = sourceMessageId.trim();
  if (!ownerId.trim() || !sourceChatMessageId) throw new Error('Owner and chat message identity are required.');
  return {
    taskId: `chat:${createHash('sha256').update(JSON.stringify([
      ownerId, conversationId, sourceChatMessageId,
    ])).digest('hex')}`,
    sourceChatMessageId,
  };
}
