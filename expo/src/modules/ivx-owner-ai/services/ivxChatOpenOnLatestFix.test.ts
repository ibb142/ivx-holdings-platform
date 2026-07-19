import { describe, expect, it } from 'bun:test';
import {
  mergeOwnerMessages,
  capOwnerMessages,
  type MergeableOwnerMessage,
} from './ivxChatMessageMerge';

/**
 * OPEN-ON-LATEST BOUNDED LOAD (2026-07-19): the owner reported the IVX chat
 * opens on months-old messages instead of the latest turn. Root cause: the
 * message query had NO LIMIT and ordered ascending, so a conversation with
 * hundreds of turns forced the FlatList to lay out every message before
 * scroll-to-latest could anchor on the newest one — the scroll retry gave up
 * after ~1.5s and the viewport stayed at the top (months-old messages).
 *
 * Fix: bound the DB query to the newest 120 (descending) then reverse for
 * chronological display, and cap the merged result to the newest 160 so the
 * 400-row local mirror cannot re-introduce the slow-layout bug. These tests
 * prove the cap + merge keeps the newest messages in chronological order with
 * the latest turn as the last element — which is what scroll-to-latest and
 * initialScrollIndex target.
 */

const DISPLAY_WINDOW = 160;
const INITIAL_PAGE_LIMIT = 120;

function makeMessage(
  overrides: Partial<MergeableOwnerMessage> & { id: string; createdAt: string },
): MergeableOwnerMessage {
  return {
    conversationId: 'ivx-owner-room',
    senderUserId: null,
    senderRole: 'owner',
    body: null,
    attachmentUrl: null,
    attachmentName: null,
    ...overrides,
  };
}

function makeThread(count: number, startEpoch: number, spacingMs: number): MergeableOwnerMessage[] {
  return Array.from({ length: count }, (_, i) => makeMessage({
    id: `msg-${i + 1}`,
    body: `message ${i + 1}`,
    createdAt: new Date(startEpoch + i * spacingMs).toISOString(),
  }));
}

describe('OPEN-ON-LATEST bounded load — display cap keeps the newest window', () => {
  it('caps a 400-message merged thread to the newest 160 in chronological order', () => {
    const fullThread = makeThread(400, Date.parse('2026-01-01T00:00:00Z'), 60_000);
    const capped = capOwnerMessages(fullThread, DISPLAY_WINDOW);
    expect(capped.length).toBe(160);
    // Newest 160 = messages 241..400, in chronological (ascending) order.
    expect(capped[0]!.id).toBe('msg-241');
    expect(capped[capped.length - 1]!.id).toBe('msg-400');
    // Chronological order invariant: createdAt ascending.
    for (let i = 1; i < capped.length; i++) {
      expect(Date.parse(capped[i]!.createdAt)).toBeGreaterThanOrEqual(Date.parse(capped[i - 1]!.createdAt));
    }
  });

  it('the latest turn is the LAST element (scroll-to-latest target)', () => {
    const fullThread = makeThread(400, Date.parse('2026-01-01T00:00:00Z'), 60_000);
    const capped = capOwnerMessages(fullThread, DISPLAY_WINDOW);
    const latest = fullThread[fullThread.length - 1]!;
    expect(capped[capped.length - 1]!.id).toBe(latest.id);
    expect(capped[capped.length - 1]!.createdAt).toBe(latest.createdAt);
  });

  it('does not cap a thread smaller than the display window', () => {
    const smallThread = makeThread(50, Date.parse('2026-01-01T00:00:00Z'), 60_000);
    const capped = capOwnerMessages(smallThread, DISPLAY_WINDOW);
    expect(capped.length).toBe(50);
    expect(capped[0]!.id).toBe('msg-1');
    expect(capped[capped.length - 1]!.id).toBe('msg-50');
  });

  it('simulates the bounded DB query: newest 120 (descending) then reversed = chronological 120', () => {
    const fullThread = makeThread(500, Date.parse('2026-01-01T00:00:00Z'), 60_000);
    // Simulate the DB query: .order('created_at', ascending: false).limit(120)
    const newestFirst = [...fullThread].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    ).slice(0, INITIAL_PAGE_LIMIT);
    // Reverse in-memory for chronological display.
    const chronological = [...newestFirst].reverse();
    expect(chronological.length).toBe(120);
    // The window is messages 381..500 in chronological order.
    expect(chronological[0]!.id).toBe('msg-381');
    expect(chronological[chronological.length - 1]!.id).toBe('msg-500');
    // Chronological invariant.
    for (let i = 1; i < chronological.length; i++) {
      expect(Date.parse(chronological[i]!.createdAt)).toBeGreaterThanOrEqual(Date.parse(chronological[i - 1]!.createdAt));
    }
  });

  it('a months-old conversation no longer surfaces months-old messages first after the cap', () => {
    // Reproduce the owner scenario: a conversation that started in January,
    // latest turn in July. Without the cap, the merged thread is 400 messages
    // and the FlatList lays out January messages first. With the cap, the
    // displayed window is the newest 160 — July messages — and the latest turn
    // is the last element.
    const fullThread = makeThread(400, Date.parse('2026-01-01T00:00:00Z'), 12 * 60 * 60_000);
    const capped = capOwnerMessages(fullThread, DISPLAY_WINDOW);
    const newest = capped[capped.length - 1]!;
    const oldest = capped[0]!;
    // The oldest displayed message should be well into the year (message 241),
    // NOT a January message.
    expect(Date.parse(oldest.createdAt)).toBeGreaterThan(Date.parse('2026-04-01T00:00:00Z'));
    // The newest displayed message is the July turn.
    expect(Date.parse(newest.createdAt)).toBeGreaterThan(Date.parse('2026-06-01T00:00:00Z'));
  });

  it('merge of 120 newest remote + 400 local mirror (superset), capped to 160, keeps the newest 160', () => {
    // The real listOwnerMessages path: remote returns the newest 120, the
    // durable local mirror is a 400-message SUPERSET shadow of every rendered
    // turn — so the 120 remote rows are the TAIL of the 400-message local
    // mirror (same messages, duplicated by signature). mergeOwnerMessages
    // dedupes back to 400; the display cap then keeps the newest 160. This
    // proves the 400-row mirror cannot re-introduce the slow-layout bug.
    const localMirror400 = makeThread(400, Date.parse('2026-01-01T00:00:00Z'), 12 * 60 * 60_000);
    // Remote returns the newest 120 = the last 120 of the local mirror.
    const remoteNewest120 = localMirror400.slice(-120);
    const merged = mergeOwnerMessages(remoteNewest120, localMirror400);
    expect(merged.length).toBe(400); // deduped back to the superset
    const displayMessages = merged.length > DISPLAY_WINDOW ? merged.slice(-DISPLAY_WINDOW) : merged;
    expect(displayMessages.length).toBe(160);
    // Latest turn is the last element.
    expect(displayMessages[displayMessages.length - 1]!.id).toBe('msg-400');
    // Oldest displayed is message 241, which is well past January (April+).
    expect(displayMessages[0]!.id).toBe('msg-241');
    expect(Date.parse(displayMessages[0]!.createdAt)).toBeGreaterThan(Date.parse('2026-04-01T00:00:00Z'));
  });

  it('a single-message conversation still renders that message as the last element', () => {
    const single = makeThread(1, Date.parse('2026-07-19T00:00:00Z'), 60_000);
    const capped = capOwnerMessages(single, DISPLAY_WINDOW);
    expect(capped.length).toBe(1);
    expect(capped[0]!.id).toBe('msg-1');
  });

  it('an empty conversation stays empty (no crash, no phantom message)', () => {
    const capped = capOwnerMessages([], DISPLAY_WINDOW);
    expect(capped.length).toBe(0);
  });

  it('equal-timestamp messages sort by stable insertion order (no reordering jitter)', () => {
    const sameTimestamp = [
      makeMessage({ id: 'a', body: 'first', createdAt: '2026-07-19T00:00:00Z' }),
      makeMessage({ id: 'b', body: 'second', createdAt: '2026-07-19T00:00:00Z' }),
      makeMessage({ id: 'c', body: 'third', createdAt: '2026-07-19T00:00:00Z' }),
    ];
    const capped = capOwnerMessages(sameTimestamp, DISPLAY_WINDOW);
    expect(capped.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});
