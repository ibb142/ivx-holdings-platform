import { describe, expect, test } from 'bun:test';
import {
  buildOwnerMessageContentKey,
  mergeOwnerMessages,
  type MergeableOwnerMessage,
} from '../src/modules/ivx-owner-ai/services/ivxChatMessageMerge';

const msg = (overrides: Partial<MergeableOwnerMessage>): MergeableOwnerMessage => ({
  id: 'id',
  conversationId: 'room-a',
  senderUserId: null,
  senderRole: 'assistant',
  body: '3 active properties in production right now.',
  attachmentUrl: null,
  attachmentName: null,
  createdAt: '2026-08-26T14:00:00.000Z',
  ...overrides,
});

describe('IVX Owner AI turn isolation', () => {
  test('content identity survives canonical conversation-id rotation', () => {
    expect(buildOwnerMessageContentKey(msg({ conversationId: 'room-a' }))).toBe(
      buildOwnerMessageContentKey(msg({ conversationId: 'room-b' })),
    );
  });

  test('does not re-inject an old assistant reply from local mirror after conversation-id rotation', () => {
    const remote = msg({ id: 'remote-new', conversationId: 'room-b', createdAt: '2026-08-26T14:02:00.000Z' });
    const staleLocal = msg({ id: 'local-old', conversationId: 'room-a', createdAt: '2026-08-26T14:00:00.000Z' });
    const merged = mergeOwnerMessages([remote], [staleLocal]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('remote-new');
  });
});
