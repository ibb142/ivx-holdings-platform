/**
 * Pure, runtime-free helpers for merging the IVX Owner AI conversation from its
 * two durable sources (remote Supabase rows + the local AsyncStorage shadow) and
 * for bounding the local shadow so it never grows without limit.
 *
 * This module deliberately has ZERO runtime imports (only a type-only import that
 * is erased at build time) so the conversation-state logic can be unit-tested
 * without React Native, Supabase, or AsyncStorage in scope. It is the single
 * source of truth for "which message wins" when the same turn exists both
 * locally and remotely — the logic that decides whether the chat survives a
 * reload, route change, logout/login, or a transient remote-read failure.
 */

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
 * under the canonical id are still the same logical turn. Including room id here
 * caused stale assistant replies to be re-injected after id rotation.
 *
 * Attachment identity is included when present. Returns null for attachment-only
 * messages with no body so distinct uploads are never collapsed accidentally.
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

/**
 * STABLE ORDERING FIX (owner mandate 2026-07-20 Phase 4D): sort by created_at
 * ascending, breaking ties by message id (stable secondary key). Previously
 * this sorted ONLY by createdAt — equal-timestamp messages (common when the
 * server assigns near-simultaneous timestamps to realtime + optimistic copies)
 * changed order after every realtime sync, producing the flicker/reorder the
 * owner reported. The id tiebreak is deterministic and stable across reloads.
 */
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
 *
 * Rules:
 * - Remote rows always win.
 * - A local row is dropped if its exact signature already exists remotely
 *   (true duplicate), OR if a remote row shares its logical content key — even
 *   when the canonical conversation id changed between the local and remote
 *   writes. This prevents stale old answers from reappearing after reload.
 * - Local-only rows (never persisted remotely, e.g. offline/auth-degraded sends)
 *   are preserved so the conversation never loses a turn.
 */
export function mergeOwnerMessages<T extends MergeableOwnerMessage>(
  remoteMessages: T[],
  localMessages: T[],
): T[] {
  if (localMessages.length === 0) {
    return sortByCreatedAtAscending(remoteMessages);
  }

  const merged = new Map<string, T>();
  const remoteContentKeys = new Set<string>();

  for (const message of remoteMessages) {
    merged.set(buildOwnerMessageSignature(message), message);
    const contentKey = buildOwnerMessageContentKey(message);
    if (contentKey) {
      remoteContentKeys.add(contentKey);
    }
  }

  for (const message of localMessages) {
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
 * Bound the local shadow to the most recent `maxMessages` turns (chronological)
 * so the durable cache can never grow without limit. Keeps the newest messages.
 */
export function capOwnerMessages<T extends MergeableOwnerMessage>(
  messages: T[],
  maxMessages: number,
): T[] {
  if (maxMessages <= 0 || messages.length <= maxMessages) {
    return sortByCreatedAtAscending(messages);
  }
  return sortByCreatedAtAscending(messages).slice(-maxMessages);
}
