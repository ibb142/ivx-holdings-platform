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
 * Looser content key (conversation + role + body) used to recognise the SAME
 * logical turn after it has been re-persisted remotely with a fresh server id
 * and timestamp. Returns null for attachment-only messages (no body) so two
 * different uploads are never collapsed.
 */
export function buildOwnerMessageContentKey(message: MergeableOwnerMessage): string | null {
  const body = normalizeMessageComparisonValue(message.body);
  if (body.length === 0) {
    return null;
  }
  return [
    normalizeMessageComparisonValue(message.conversationId),
    normalizeMessageComparisonValue(message.senderRole),
    body,
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
 *   (true duplicate), OR if a remote row shares its content key — i.e. the same
 *   text turn that was successfully re-persisted remotely with a new server
 *   timestamp. This prevents the "message shows twice after reload" artifact.
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
      // Stale local copy of a turn that is already persisted remotely.
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
