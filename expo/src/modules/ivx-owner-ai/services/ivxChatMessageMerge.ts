/**
 * Pure, runtime-free helpers for merging the IVX Owner AI conversation from its
 * two durable sources (remote Supabase rows + the local AsyncStorage shadow) and
 * for bounding the local shadow so it never grows without limit.
 */

import { filterRenderableOwnerMessages } from './ivxRenderableMessage';

/** Minimal structural shape needed to merge/dedupe owner-chat messages. */
export interface MergeableOwnerMessage {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  senderRole: string;
  body: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  createdAt: string;
}

function normalizeMessageComparisonValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/** Exact-identity signature (conversation + sender + body + attachment + createdAt). */
export function buildOwnerMessageSignature(message: MergeableOwnerMessage): string {
  return [
    normalizeMessageComparisonValue(message.conversationId),
    normalizeMessageComparisonValue(message.senderUserId),
    normalizeMessageComparisonValue(message.senderRole),
    normalizeMessageComparisonValue(message.body),
    normalizeMessageComparisonValue(message.attachmentUrl),
    normalizeMessageComparisonValue(message.attachmentName),
    normalizeMessageComparisonValue(message.createdAt),
  ].join('::');
}

/**
 * Looser logical-turn content key. Intentionally DOES NOT include conversationId.
 * The owner room can adopt a backend canonical id after a reply; a local shadow
 * row written under the pre-adoption id and the authoritative remote row written
 * under the canonical id are still the same logical turn.
 */
export function buildOwnerMessageContentKey(message: MergeableOwnerMessage): string | null {
  const body = normalizeMessageComparisonValue(message.body);
  if (body.length === 0) {
    return null;
  }
  return [
    normalizeMessageComparisonValue(message.senderRole),
    body,
    normalizeMessageComparisonValue(message.attachmentUrl),
    normalizeMessageComparisonValue(message.attachmentName),
  ].join('::');
}

function sortByCreatedAtAscending<T extends MergeableOwnerMessage>(messages: T[]): T[] {
  return [...messages].sort((left, right) => {
    const ta = new Date(left.createdAt).getTime();
    const tb = new Date(right.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/**
 * Merge remote (authoritative) and local (shadow/fallback) owner messages.
 * Structurally empty rows are removed here, before they can ever reach chat.tsx
 * and be converted into the synthetic failed "unable to display" bubble.
 */
export function mergeOwnerMessages<T extends MergeableOwnerMessage>(
  remoteMessages: T[],
  localMessages: T[],
): T[] {
  const renderableRemote = filterRenderableOwnerMessages(remoteMessages);
  const renderableLocal = filterRenderableOwnerMessages(localMessages);

  if (renderableLocal.length === 0) {
    return sortByCreatedAtAscending(renderableRemote);
  }

  const merged = new Map<string, T>();
  const remoteContentKeys = new Set<string>();

  for (const message of renderableRemote) {
    merged.set(buildOwnerMessageSignature(message), message);
    const contentKey = buildOwnerMessageContentKey(message);
    if (contentKey) {
      remoteContentKeys.add(contentKey);
    }
  }

  for (const message of renderableLocal) {
    const signature = buildOwnerMessageSignature(message);
    if (merged.has(signature)) {
      continue;
    }
    const contentKey = buildOwnerMessageContentKey(message);
    if (contentKey && remoteContentKeys.has(contentKey)) {
      continue;
    }
    merged.set(signature, message);
  }

  return sortByCreatedAtAscending(Array.from(merged.values()));
}

/**
 * Bound the local shadow to the most recent `maxMessages` turns and purge
 * structurally empty rows from the durable mirror as part of every save.
 */
export function capOwnerMessages<T extends MergeableOwnerMessage>(
  messages: T[],
  maxMessages: number,
): T[] {
  const renderableMessages = filterRenderableOwnerMessages(messages);
  if (maxMessages <= 0 || renderableMessages.length <= maxMessages) {
    return sortByCreatedAtAscending(renderableMessages);
  }
  return sortByCreatedAtAscending(renderableMessages).slice(-maxMessages);
}
