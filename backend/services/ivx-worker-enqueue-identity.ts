import { chatWorkerIdentity } from './ivx-chat-worker-identity';
import type { IVXWorkerJobInput } from './ivx-senior-developer-worker';

type Identity = Pick<IVXWorkerJobInput, 'taskId' | 'sourceChatMessageId' | 'conversationId'>;
type Source = { taskId?: unknown; sourceChatMessageId?: unknown; conversationId?: unknown };

/** Call only after owner authentication. Correlation is never an approval grant. */
export function resolveWorkerEnqueueIdentity(ownerId: string, source: Source):
  | { ok: true; identity: Identity }
  | { ok: false; error: string } {
  for (const field of ['taskId', 'sourceChatMessageId', 'conversationId'] as const) {
    const value = source[field];
    if (value != null && (typeof value !== 'string' || !value.trim() || value.length > 512)) {
      return { ok: false, error: `${field} must be a nonempty string of at most 512 characters.` };
    }
  }
  const taskId = typeof source.taskId === 'string' ? source.taskId.trim() : null;
  if (taskId && !/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,511}$/.test(taskId)) {
    return { ok: false, error: 'taskId contains unsupported characters.' };
  }
  const messageId = typeof source.sourceChatMessageId === 'string' ? source.sourceChatMessageId.trim() : null;
  const conversationId = typeof source.conversationId === 'string' ? source.conversationId.trim() : null;
  return { ok: true, identity: {
    ...(messageId ? chatWorkerIdentity(ownerId, conversationId, messageId) : {}),
    // An explicit mission ID binds a follow-up to its existing task. Preserve
    // the message identity too, so the final reply returns to the source chat.
    ...(taskId ? { taskId } : {}),
    ...(conversationId ? { conversationId } : {}),
  } };
}
