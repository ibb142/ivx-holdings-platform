/**
 * IVX Chat Pagination (Expo-side)
 *
 * Owner mandate 2026-07-20 Phase 4 (areas B, C, E): cursor-based pagination
 * for older messages, scroll position preservation, and memoized message rows.
 *
 * This is the Expo-side mirror of backend/services/ivx-chat-pagination.ts. It
 * is pure TypeScript (no React, no backend imports) so it is unit-testable and
 * tree-shakeable. The chat screen imports these helpers to fetch older messages
 * on scroll-to-top via a cursor, prepend them preserving the scroll anchor, and
 * keep stable ordering (created_at ascending + id tiebreak) so realtime sync
 * never reorders equal-timestamp messages.
 */

export const IVX_CHAT_PAGINATION_MARKER = 'ivx-chat-pagination-2026-07-20';

/**
 * A cursor for pagination. Encodes the created_at + id of the oldest currently-
 * loaded message so the next page fetches messages older than that cursor.
 */
export type IVXMessageCursor = {
  createdAt: string;
  id: string;
};

/**
 * Encode a cursor to a base64 string for transport. Uses btoa (available in
 * React Native + the Metro runtime) with a UTF-8 safe path.
 */
export function encodeCursor(cursor: IVXMessageCursor): string {
  const json = JSON.stringify(cursor);
  // btoa is ASCII-only; encode UTF-8 bytes as percent-escaped chars first.
  const utf8 = unescape(encodeURIComponent(json));
  return btoa(utf8);
}

/**
 * Decode a cursor from a base64 string. Returns null on malformed input.
 */
export function decodeCursor(encoded: string): IVXMessageCursor | null {
  try {
    const utf8 = atob(encoded);
    const json = decodeURIComponent(escape(utf8));
    const parsed = JSON.parse(json) as IVXMessageCursor;
    if (!parsed.createdAt || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The initial page size (newest messages loaded on room open) and the older-
 * message page size (loaded when the user scrolls to the top).
 */
export const INITIAL_PAGE_SIZE = 120;
export const OLDER_PAGE_SIZE = 80;

/**
 * Stable ordering: sort by created_at ascending, breaking ties by message id
 * (stable secondary key). This prevents messages from changing order after
 * realtime synchronization when timestamps are equal.
 */
export function stableMessageOrder<T extends { id: string; createdAt: string }>(a: T, b: T): number {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Deduplicate messages by canonical message id. Realtime + optimistic + local
 * mirror can produce the same logical message under different ids; the
 * canonical id is the remote id if present, else the local id.
 */
export function deduplicateMessages<T extends { id: string; remoteId?: string | null }>(messages: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const m of messages) {
    const canonical = m.remoteId ?? m.id;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(m);
  }
  return result;
}

/**
 * Prepend older messages to the current list, preserving the visible scroll
 * position. Returns the merged list (deduped + sorted).
 *
 * The caller is responsible for preserving the scroll anchor by remembering
 * the index of the first visible message BEFORE the prepend and scrolling to
 * that message AFTER the prepend.
 */
export function prependOlderMessages<T extends { id: string; createdAt: string; remoteId?: string | null }>(
  current: T[],
  older: T[],
): T[] {
  const merged = [...older, ...current];
  const deduped = deduplicateMessages(merged);
  deduped.sort(stableMessageOrder);
  return deduped;
}

/**
 * Merge a new realtime message into the current list. If the user is near the
 * bottom, the caller should auto-scroll; if the user is reading older
 * messages, the caller should show a "new messages" button.
 *
 * Returns the merged list (deduped + sorted) and whether the message was new.
 */
export function mergeRealtimeMessage<T extends { id: string; createdAt: string; remoteId?: string | null }>(
  current: T[],
  incoming: T,
): { messages: T[]; isNew: boolean } {
  const canonical = incoming.remoteId ?? incoming.id;
  const exists = current.some((m) => (m.remoteId ?? m.id) === canonical);
  if (exists) {
    return { messages: current, isNew: false };
  }
  const merged = [...current, incoming];
  merged.sort(stableMessageOrder);
  return { messages: merged, isNew: true };
}

/**
 * Determine whether the user is near the bottom of the list (within
 * `thresholdPx` pixels). Used to decide auto-scroll vs "new messages" button.
 */
export function isNearBottom(
  contentSizeHeight: number,
  contentOffsetY: number,
  layoutMeasurementHeight: number,
  thresholdPx: number = 96,
): boolean {
  const distanceFromBottom = contentSizeHeight - (contentOffsetY + layoutMeasurementHeight);
  return distanceFromBottom < thresholdPx;
}

/**
 * Batch realtime updates: if multiple realtime messages arrive within a
 * short window, batch them into a single update to avoid N parent rerenders.
 */
export function batchRealtimeUpdates<T extends { id: string; createdAt: string; remoteId?: string | null }>(
  current: T[],
  batch: T[],
): T[] {
  let merged = current;
  for (const msg of batch) {
    const result = mergeRealtimeMessage(merged, msg);
    merged = result.messages;
  }
  return merged;
}

/**
 * Build the cursor for the next older-messages fetch from the oldest currently-
 * loaded message. Returns null if the list is empty.
 */
export function buildOlderCursor<T extends { id: string; createdAt: string }>(messages: T[]): IVXMessageCursor | null {
  if (messages.length === 0) return null;
  const oldest = messages[0];
  return { createdAt: oldest.createdAt, id: oldest.id };
}
