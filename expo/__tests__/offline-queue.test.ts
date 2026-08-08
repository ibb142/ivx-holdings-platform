// @ts-nocheck
import { describe, expect, test, beforeEach, mock } from 'bun:test';

// Mock AsyncStorage before importing the queue module.
const memoryStore: Record<string, string> = {};
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => memoryStore[k] ?? null,
    setItem: async (k: string, v: string) => {
      memoryStore[k] = v;
    },
    removeItem: async (k: string) => {
      delete memoryStore[k];
    },
  },
}));

// Mock react-native AppState (no-op subscription).
mock.module('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  AppState: {
    addEventListener: () => ({ remove: () => {} }),
  },
  Linking: { canOpenURL: async () => true, openURL: async () => {}, addEventListener: () => ({ remove: () => {} }) },
}));

// Mock chatService so we control send behavior per test.
let sendImpl: (input: any) => Promise<any> = async (input) => ({ id: 'sent-1', ...input });
mock.module('../src/modules/chat/services/chatService', () => ({
  chatService: {
    sendMessage: (input: any) => sendImpl(input),
    listMessages: async () => [],
    subscribeToMessages: () => () => {},
  },
}));

const {
  isOfflineError,
  enqueueSend,
  flushQueue,
  getOfflineQueueSnapshot,
  sendWithOfflineQueue,
  __resetOfflineQueueForTests,
} = await import('../src/modules/chat/services/offlineQueueService');

describe('offlineQueueService', () => {
  beforeEach(() => {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    __resetOfflineQueueForTests();
    sendImpl = async (input: any) => ({ id: 'sent-1', ...input });
  });

  test('classifies network errors as offline', () => {
    expect(isOfflineError(new Error('Network request failed'))).toBe(true);
    expect(isOfflineError(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(isOfflineError(new Error('ECONNRESET'))).toBe(true);
    expect(isOfflineError(new Error('401 unauthorized'))).toBe(false);
    expect(isOfflineError(new Error('invalid payload'))).toBe(false);
  });

  test('enqueues and persists pending sends', async () => {
    await enqueueSend({ conversationId: 'room-1', senderId: 'u1', text: 'hello' });
    expect(getOfflineQueueSnapshot().size).toBe(1);
    expect(memoryStore['ivx.chat.offline-queue.v1']).toBeDefined();
  });

  test('flushQueue sends queued messages and clears them', async () => {
    let sent = 0;
    sendImpl = async (input: any) => {
      sent += 1;
      return { id: `sent-${sent}`, ...input };
    };
    await enqueueSend({ conversationId: 'r', senderId: 'u', text: 'a' });
    await enqueueSend({ conversationId: 'r', senderId: 'u', text: 'b' });
    const result = await flushQueue();
    expect(result.sent).toBe(2);
    expect(result.remaining).toBe(0);
    expect(getOfflineQueueSnapshot().size).toBe(0);
  });

  test('flushQueue keeps entries when still offline', async () => {
    sendImpl = async () => {
      throw new Error('Network request failed');
    };
    await enqueueSend({ conversationId: 'r', senderId: 'u', text: 'a' });
    const result = await flushQueue();
    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(1);
    expect(getOfflineQueueSnapshot().online).toBe(false);
  });

  test('flushQueue drops entries on non-recoverable errors', async () => {
    sendImpl = async () => {
      throw new Error('401 unauthorized');
    };
    await enqueueSend({ conversationId: 'r', senderId: 'u', text: 'a' });
    const result = await flushQueue();
    expect(result.remaining).toBe(0);
  });

  test('sendWithOfflineQueue enqueues on offline failure', async () => {
    sendImpl = async () => {
      throw new Error('Network request failed');
    };
    await expect(
      sendWithOfflineQueue({ conversationId: 'r', senderId: 'u', text: 'q' }),
    ).rejects.toThrow();
    expect(getOfflineQueueSnapshot().size).toBe(1);
  });

  test('sendWithOfflineQueue does NOT enqueue on auth failure', async () => {
    sendImpl = async () => {
      throw new Error('401 invalid token');
    };
    await expect(
      sendWithOfflineQueue({ conversationId: 'r', senderId: 'u', text: 'q' }),
    ).rejects.toThrow();
    expect(getOfflineQueueSnapshot().size).toBe(0);
  });
});
