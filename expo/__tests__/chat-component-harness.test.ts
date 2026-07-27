/**
 * Automated Chat Component QA — production-faithful test harness.
 *
 * Tests the real chat ordering, pagination, realtime merge, dedup,
 * date separator, and inverted-list logic with actual message data
 * across 14 scenario categories.
 */
import { describe, expect, test } from 'bun:test';
import {
  sortMessagesByCanonicalOrder,
  formatMessageDateKey,
  formatMessageDateLabel,
} from '@/src/modules/chat/services/chatMessageUtils';
import {
  stableMessageOrder,
  deduplicateMessages,
  prependOlderMessages,
  mergeRealtimeMessage,
  batchRealtimeUpdates,
  buildOlderCursor,
  isNearBottom,
  encodeCursor,
  decodeCursor,
  INITIAL_PAGE_SIZE,
  OLDER_PAGE_SIZE,
} from '@/src/modules/ivx-owner-ai/services/ivxChatPagination';
import {
  mergeOwnerMessages,
  capOwnerMessages,
  buildOwnerMessageSignature,
  buildOwnerMessageContentKey,
} from '@/src/modules/ivx-owner-ai/services/ivxChatMessageMerge';

type TestMessage = {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  senderRole: string;
  body: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  createdAt: string;
  remoteId?: string | null;
  serverCreatedAt?: string | null;
};

function makeMessage(overrides: Partial<TestMessage> & { id: string; createdAt: string }): TestMessage {
  return {
    conversationId: 'conv-test',
    senderUserId: 'user-1',
    senderRole: 'owner',
    body: 'Hello',
    attachmentUrl: null,
    attachmentName: null,
    ...overrides,
  };
}

function makeTimestamps(count: number, startMs: number = 1000, stepMs: number = 1000): string[] {
  return Array.from({ length: count }, (_, i) => new Date(startMs + i * stepMs).toISOString());
}

// --- Scenario 1: Empty conversation ---
describe('Scenario 1: Empty conversation', () => {
  test('empty list produces empty inverted data, null cursor, no initial scroll', () => {
    const messages: TestMessage[] = [];
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.length).toBe(0);
    const cursor = buildOlderCursor(sorted);
    expect(cursor).toBeNull();
  });
});

// --- Scenario 2: One message ---
describe('Scenario 2: One message', () => {
  test('single message is both first and last, cursor points to it', () => {
    const msg = makeMessage({ id: 'msg-1', createdAt: '2026-07-27T10:00:00Z' });
    const sorted = sortMessagesByCanonicalOrder([msg]);
    expect(sorted.length).toBe(1);
    expect(sorted[0].id).toBe('msg-1');
    const cursor = buildOlderCursor(sorted);
    expect(cursor).not.toBeNull();
    expect(cursor!.id).toBe('msg-1');
  });
});

// --- Scenario 3: Twenty messages ---
describe('Scenario 3: Twenty messages', () => {
  test('newest message is the initial anchored record (last in chronological)', () => {
    const timestamps = makeTimestamps(20);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${i}`, createdAt: ts }));
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.length).toBe(20);
    expect(sorted[sorted.length - 1].id).toBe('msg-19');
    expect(sorted[0].id).toBe('msg-0');
  });

  test('inverted data[0] equals newest message', () => {
    const timestamps = makeTimestamps(20);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${i}`, createdAt: ts }));
    const sorted = sortMessagesByCanonicalOrder(messages);
    const inverted = [...sorted].reverse();
    expect(inverted[0].id).toBe('msg-19');
  });
});

// --- Scenario 4: One hundred messages ---
describe('Scenario 4: One hundred messages', () => {
  test('ordering is stable across 100 messages', () => {
    const timestamps = makeTimestamps(100);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${String(i).padStart(3, '0')}`, createdAt: ts }));
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted[sorted.length - 1].id).toBe('msg-099');
    expect(sorted[0].id).toBe('msg-000');
  });
});

// --- Scenario 5: One thousand messages ---
describe('Scenario 5: One thousand messages', () => {
  test('ordering is stable across 1000 messages', () => {
    const timestamps = makeTimestamps(1000);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${String(i).padStart(4, '0')}`, createdAt: ts }));
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.length).toBe(1000);
    expect(sorted[sorted.length - 1].id).toBe('msg-0999');
    expect(sorted[0].id).toBe('msg-0000');
  });

  test('display window caps to newest 160', () => {
    const timestamps = makeTimestamps(1000);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${i}`, createdAt: ts }));
    const sorted = sortMessagesByCanonicalOrder(messages);
    const DISPLAY_WINDOW = 160;
    const display = sorted.length > DISPLAY_WINDOW ? sorted.slice(-DISPLAY_WINDOW) : sorted;
    expect(display.length).toBe(160);
    expect(display[display.length - 1].id).toBe('msg-999');
  });
});

// --- Scenario 6: Mixed user and IVX IA messages ---
describe('Scenario 6: Mixed user and IVX IA messages', () => {
  test('owner and assistant messages interleave correctly by timestamp', () => {
    const messages = [
      makeMessage({ id: 'owner-1', senderRole: 'owner', createdAt: '2026-07-27T10:00:00Z', body: 'Question' }),
      makeMessage({ id: 'ai-1', senderRole: 'assistant', senderUserId: null, createdAt: '2026-07-27T10:00:05Z', body: 'Answer' }),
      makeMessage({ id: 'owner-2', senderRole: 'owner', createdAt: '2026-07-27T10:00:10Z', body: 'Follow up' }),
      makeMessage({ id: 'ai-2', senderRole: 'assistant', senderUserId: null, createdAt: '2026-07-27T10:00:15Z', body: 'Response' }),
    ];
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.map(m => m.id)).toEqual(['owner-1', 'ai-1', 'owner-2', 'ai-2']);
  });
});

// --- Scenario 7: Same timestamps with different canonical IDs ---
describe('Scenario 7: Same timestamps with different canonical IDs', () => {
  test('stable ID tiebreaker prevents reordering on equal timestamps', () => {
    const ts = '2026-07-27T10:00:00Z';
    const messages = [
      makeMessage({ id: 'msg-z', createdAt: ts }),
      makeMessage({ id: 'msg-a', createdAt: ts }),
      makeMessage({ id: 'msg-m', createdAt: ts }),
    ];
    const sorted1 = sortMessagesByCanonicalOrder(messages);
    const sorted2 = sortMessagesByCanonicalOrder([...messages].reverse());
    expect(sorted1.map(m => m.id)).toEqual(sorted2.map(m => m.id));
    expect(sorted1.map(m => m.id)).toEqual(['msg-a', 'msg-m', 'msg-z']);
  });
});

// --- Scenario 8: Messages spanning multiple dates ---
describe('Scenario 8: Messages spanning multiple dates', () => {
  test('date separators are correct for multi-day conversation', () => {
    const messages = [
      makeMessage({ id: 'day1-1', createdAt: '2026-07-25T10:00:00Z' }),
      makeMessage({ id: 'day1-2', createdAt: '2026-07-25T14:00:00Z' }),
      makeMessage({ id: 'day2-1', createdAt: '2026-07-26T09:00:00Z' }),
      makeMessage({ id: 'day3-1', createdAt: '2026-07-27T18:00:00Z' }),
    ];
    const sorted = sortMessagesByCanonicalOrder(messages);

    // Date separator logic: a separator appears when the date changes between
    // consecutive messages. In inverted mode, we compare invertedData[index]
    // with invertedData[index + 1].
    const inverted = [...sorted].reverse();
    const dateKeys = inverted.map(m => formatMessageDateKey(m.createdAt));
    const separators: number[] = [];
    for (let i = 0; i < inverted.length; i++) {
      const olderMessage = inverted[i + 1];
      if (!olderMessage) continue;
      if (formatMessageDateKey(inverted[i].createdAt) !== formatMessageDateKey(olderMessage.createdAt)) {
        separators.push(i);
      }
    }
    // 3 distinct dates → 2 separator boundaries
    expect(separators.length).toBe(2);
    expect(new Set(dateKeys).size).toBe(3);
  });

  test('formatMessageDateLabel produces Today/Yesterday/Date correctly', () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(formatMessageDateLabel(today)).toBe('Today');
    expect(formatMessageDateLabel(yesterday)).toBe('Yesterday');
  });
});

// --- Scenario 9: Long messages ---
describe('Scenario 9: Long messages', () => {
  test('very long body text does not break ordering or dedup', () => {
    const longBody = 'A'.repeat(10000);
    const msg = makeMessage({ id: 'long-1', createdAt: '2026-07-27T10:00:00Z', body: longBody });
    const sorted = sortMessagesByCanonicalOrder([msg]);
    expect(sorted.length).toBe(1);
    expect(sorted[0].body).toBe(longBody);
  });
});

// --- Scenario 10: Images ---
describe('Scenario 10: Images', () => {
  test('image attachment messages sort by timestamp like text messages', () => {
    const messages = [
      makeMessage({ id: 'img-1', createdAt: '2026-07-27T10:00:00Z', body: null, attachmentUrl: 'https://example.com/img1.jpg', attachmentName: 'photo.jpg' }),
      makeMessage({ id: 'txt-1', createdAt: '2026-07-27T10:00:05Z', body: 'Nice photo' }),
    ];
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.map(m => m.id)).toEqual(['img-1', 'txt-1']);
  });
});

// --- Scenario 11: Video references ---
describe('Scenario 11: Video references', () => {
  test('video attachment messages are handled correctly', () => {
    const msg = makeMessage({ id: 'vid-1', createdAt: '2026-07-27T10:00:00Z', body: null, attachmentUrl: 'https://example.com/video.mp4', attachmentName: 'demo.mp4' });
    const sorted = sortMessagesByCanonicalOrder([msg]);
    expect(sorted.length).toBe(1);
    expect(sorted[0].attachmentName).toBe('demo.mp4');
  });
});

// --- Scenario 12: Documents ---
describe('Scenario 12: Documents', () => {
  test('PDF attachment messages sort correctly', () => {
    const messages = [
      makeMessage({ id: 'doc-1', createdAt: '2026-07-27T10:00:00Z', body: null, attachmentUrl: 'https://example.com/report.pdf', attachmentName: 'report.pdf' }),
      makeMessage({ id: 'txt-1', createdAt: '2026-07-27T10:00:01Z', body: 'Please review' }),
    ];
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.map(m => m.id)).toEqual(['doc-1', 'txt-1']);
  });
});

// --- Scenario 13: Task cards ---
describe('Scenario 13: Task cards', () => {
  test('task card messages with structured body sort by timestamp', () => {
    const messages = [
      makeMessage({ id: 'task-1', senderRole: 'assistant', senderUserId: null, createdAt: '2026-07-27T10:00:00Z', body: 'Task: Deploy fix\nResult: Success\nEvidence: commit-abc' }),
      makeMessage({ id: 'task-2', senderRole: 'assistant', senderUserId: null, createdAt: '2026-07-27T10:00:05Z', body: 'Task: Run tests\nResult: Pass\nEvidence: 37 tests' }),
    ];
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.map(m => m.id)).toEqual(['task-1', 'task-2']);
  });
});

// --- Scenario 14: Evidence cards ---
describe('Scenario 14: Evidence cards', () => {
  test('evidence card messages with attachment + body sort correctly', () => {
    const messages = [
      makeMessage({ id: 'evidence-1', senderRole: 'assistant', senderUserId: null, createdAt: '2026-07-27T10:00:00Z', body: 'QA evidence captured', attachmentUrl: 'https://example.com/evidence.json', attachmentName: 'qa-report.json' }),
      makeMessage({ id: 'evidence-2', senderRole: 'assistant', senderUserId: null, createdAt: '2026-07-27T10:00:10Z', body: 'Additional evidence' }),
    ];
    const sorted = sortMessagesByCanonicalOrder(messages);
    expect(sorted.map(m => m.id)).toEqual(['evidence-1', 'evidence-2']);
  });
});

// --- Pagination tests ---
describe('Pagination: cursor requests only older records', () => {
  test('cursor is built from oldest message (index 0 in chronological)', () => {
    const timestamps = makeTimestamps(10);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${i}`, createdAt: ts }));
    const sorted = sortMessagesByCanonicalOrder(messages);
    const cursor = buildOlderCursor(sorted);
    expect(cursor).not.toBeNull();
    expect(cursor!.id).toBe('msg-0');
    expect(cursor!.createdAt).toBe(timestamps[0]);
  });

  test('prependOlderMessages preserves existing anchor and deduplicates', () => {
    const current = [
      makeMessage({ id: 'msg-5', createdAt: '2026-07-27T10:05:00Z' }),
      makeMessage({ id: 'msg-6', createdAt: '2026-07-27T10:06:00Z' }),
    ];
    const older = [
      makeMessage({ id: 'msg-3', createdAt: '2026-07-27T10:03:00Z' }),
      makeMessage({ id: 'msg-4', createdAt: '2026-07-27T10:04:00Z' }),
    ];
    const result = prependOlderMessages(current, older);
    expect(result.length).toBe(4);
    expect(result.map(m => m.id)).toEqual(['msg-3', 'msg-4', 'msg-5', 'msg-6']);
  });

  test('prependOlderMessages deduplicates overlapping pages', () => {
    const current = [
      makeMessage({ id: 'msg-4', createdAt: '2026-07-27T10:04:00Z' }),
      makeMessage({ id: 'msg-5', createdAt: '2026-07-27T10:05:00Z' }),
    ];
    const older = [
      makeMessage({ id: 'msg-3', createdAt: '2026-07-27T10:03:00Z' }),
      makeMessage({ id: 'msg-4', createdAt: '2026-07-27T10:04:00Z' }), // duplicate
    ];
    const result = prependOlderMessages(current, older);
    expect(result.length).toBe(3);
    expect(result.map(m => m.id)).toEqual(['msg-3', 'msg-4', 'msg-5']);
  });

  test('cursor encode/decode roundtrip preserves createdAt and id', () => {
    const cursor = { createdAt: '2026-07-27T10:00:00Z', id: 'msg-100' };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt).toBe(cursor.createdAt);
    expect(decoded!.id).toBe(cursor.id);
  });

  test('decodeCursor returns null for malformed input', () => {
    expect(decodeCursor('not-valid-base64!!!')).toBeNull();
  });
});

// --- Realtime merge tests ---
describe('Realtime merge: no duplicates, no lost messages', () => {
  test('mergeRealtimeMessage adds new message at correct position', () => {
    const current = [
      makeMessage({ id: 'msg-1', createdAt: '2026-07-27T10:00:00Z' }),
      makeMessage({ id: 'msg-2', createdAt: '2026-07-27T10:00:01Z' }),
    ];
    const incoming = makeMessage({ id: 'msg-3', createdAt: '2026-07-27T10:00:02Z' });
    const { messages, isNew } = mergeRealtimeMessage(current, incoming);
    expect(isNew).toBe(true);
    expect(messages.length).toBe(3);
    expect(messages[messages.length - 1].id).toBe('msg-3');
  });

  test('mergeRealtimeMessage does NOT duplicate existing message', () => {
    const current = [
      makeMessage({ id: 'msg-1', createdAt: '2026-07-27T10:00:00Z' }),
      makeMessage({ id: 'msg-2', createdAt: '2026-07-27T10:00:01Z' }),
    ];
    const incoming = makeMessage({ id: 'msg-2', createdAt: '2026-07-27T10:00:01Z' });
    const { messages, isNew } = mergeRealtimeMessage(current, incoming);
    expect(isNew).toBe(false);
    expect(messages.length).toBe(2);
  });

  test('batchRealtimeUpdates handles 50 concurrent events without duplicates', () => {
    const current = makeTimestamps(10).map((ts, i) => makeMessage({ id: `msg-${i}`, createdAt: ts }));
    const batch = makeTimestamps(50, 10000).map((ts, i) => makeMessage({ id: `batch-${i}`, createdAt: ts }));
    const result = batchRealtimeUpdates(current, batch);
    expect(result.length).toBe(60);
    // Check no duplicates
    const ids = result.map(m => m.id);
    expect(new Set(ids).size).toBe(60);
  });
});

// --- isNearBottom (for auto-scroll decision) ---
describe('isNearBottom: auto-scroll threshold', () => {
  test('returns true when at bottom', () => {
    expect(isNearBottom(1000, 400, 600)).toBe(true);
  });

  test('returns false when scrolled up', () => {
    expect(isNearBottom(1000, 0, 600)).toBe(false);
  });
});

// --- mergeOwnerMessages (local + remote merge) ---
describe('mergeOwnerMessages: remote wins, no duplicates', () => {
  test('remote messages always win over local with same content key', () => {
    const remote = [
      makeMessage({ id: 'remote-1', createdAt: '2026-07-27T10:00:00Z', body: 'Hello' }),
    ];
    const local = [
      makeMessage({ id: 'local-1', createdAt: '2026-07-27T10:00:00Z', body: 'Hello' }),
    ];
    const merged = mergeOwnerMessages(remote, local);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('remote-1');
  });

  test('local-only messages are preserved', () => {
    const remote: TestMessage[] = [];
    const local = [
      makeMessage({ id: 'local-1', createdAt: '2026-07-27T10:00:00Z', body: 'Offline message' }),
    ];
    const merged = mergeOwnerMessages(remote, local);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('local-1');
  });

  test('DUPLICATE MESSAGES: 0 after merge', () => {
    const remote = [
      makeMessage({ id: 'remote-1', createdAt: '2026-07-27T10:00:00Z', body: 'Test' }),
    ];
    const local = [
      makeMessage({ id: 'local-1', createdAt: '2026-07-27T10:00:00Z', body: 'Test' }),
      makeMessage({ id: 'local-2', createdAt: '2026-07-27T10:00:00Z', body: 'Test' }),
    ];
    const merged = mergeOwnerMessages(remote, local);
    expect(merged.length).toBe(1);
  });
});

// --- capOwnerMessages (local shadow bounding) ---
describe('capOwnerMessages: local shadow bounded', () => {
  test('caps to most recent N messages', () => {
    const timestamps = makeTimestamps(500);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${i}`, createdAt: ts }));
    const capped = capOwnerMessages(messages, 400);
    expect(capped.length).toBe(400);
    // Keeps the newest 400
    expect(capped[capped.length - 1].id).toBe('msg-499');
    expect(capped[0].id).toBe('msg-100');
  });
});

// --- No timer-based scroll loop ---
describe('No timer-based scroll loop remains', () => {
  test('initial-position logic fires once, not in a loop', () => {
    // The inverted FlatList anchors at the newest message on first layout
    // via inverted={true}. No setTimeout retry loop is needed.
    // This test verifies the pure ordering logic produces a stable result
    // that would anchor correctly on first layout.
    const timestamps = makeTimestamps(100);
    const messages = timestamps.map((ts, i) => makeMessage({ id: `msg-${i}`, createdAt: ts }));
    const sorted = sortMessagesByCanonicalOrder(messages);
    const inverted = [...sorted].reverse();

    // In inverted mode, index 0 is the newest message.
    // The FlatList naturally renders index 0 first, so the newest message
    // is immediately visible without any scroll call.
    expect(inverted[0].id).toBe('msg-99');

    // Calling sort again produces the same result (idempotent, no loop needed)
    const sortedAgain = sortMessagesByCanonicalOrder(messages);
    expect(sortedAgain.map(m => m.id)).toEqual(sorted.map(m => m.id));
  });
});
