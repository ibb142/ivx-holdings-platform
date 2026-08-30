import type { MergeableOwnerMessage } from './ivxChatMessageMerge';

/**
 * A message row is renderable when it has visible text or an attachment.
 * Empty assistant/system rows can be created by interrupted persistence or
 * realtime delivery and must never become a synthetic failed chat bubble.
 */
export function isRenderableOwnerMessage(
  message: Pick<MergeableOwnerMessage, 'body' | 'attachmentUrl'>,
): boolean {
  return Boolean(message.body?.trim() || message.attachmentUrl?.trim());
}

/**
 * Remove structurally empty rows before they reach the Owner AI chat surface.
 * This keeps durable/realtime recovery intact while preventing an empty
 * assistant database row from being presented as "Not sent" to the owner.
 */
export function filterRenderableOwnerMessages<T extends Pick<MergeableOwnerMessage, 'body' | 'attachmentUrl'>>(
  messages: T[],
): T[] {
  return messages.filter(isRenderableOwnerMessage);
}
