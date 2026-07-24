import { describe, expect, test } from 'bun:test';
import { sortMessagesByCanonicalOrder } from '../src/modules/chat/services/chatMessageUtils';

type TestMessage = {
  id: string;
  createdAt?: string | null;
  serverCreatedAt?: string | null;
};

describe('sortMessagesByCanonicalOrder', () => {
  test('orders out-of-order realtime arrivals by server-created timestamp', () => {
    const ordered = sortMessagesByCanonicalOrder<TestMessage>([
      { id: 'third', createdAt: '2026-07-24T10:03:00.000Z' },
      { id: 'first', createdAt: '2026-07-24T10:01:00.000Z' },
      { id: 'second', createdAt: '2026-07-24T10:02:00.000Z' },
    ]);

    expect(ordered.map((message: TestMessage) => message.id)).toEqual(['first', 'second', 'third']);
  });

  test('uses a server timestamp instead of an optimistic client timestamp', () => {
    const ordered = sortMessagesByCanonicalOrder<TestMessage>([
      { id: 'optimistic', createdAt: '2026-07-24T10:30:00.000Z', serverCreatedAt: '2026-07-24T10:00:00.000Z' },
      { id: 'remote', createdAt: '2026-07-24T10:05:00.000Z', serverCreatedAt: '2026-07-24T10:05:00.000Z' },
    ]);

    expect(ordered.map((message: TestMessage) => message.id)).toEqual(['optimistic', 'remote']);
  });

  test('uses a stable ID tiebreaker for same-time messages and duplicates', () => {
    const ordered = sortMessagesByCanonicalOrder<TestMessage>([
      { id: 'msg-b', createdAt: '2026-07-24T10:00:00.000Z' },
      { id: 'msg-a', createdAt: '2026-07-24T10:00:00.000Z' },
      { id: 'msg-b', createdAt: '2026-07-24T10:00:00.000Z' },
    ]);

    expect(ordered.map((message: TestMessage) => message.id)).toEqual(['msg-a', 'msg-b', 'msg-b']);
  });

  test('keeps undated optimistic messages after authoritative records', () => {
    const ordered = sortMessagesByCanonicalOrder<TestMessage>([
      { id: 'missing-date', createdAt: null },
      { id: 'dated', createdAt: '2026-07-24T10:00:00.000Z' },
      { id: 'invalid-date', createdAt: 'not-a-date' },
    ]);

    expect(ordered.map((message: TestMessage) => message.id)).toEqual(['dated', 'invalid-date', 'missing-date']);
  });
});
