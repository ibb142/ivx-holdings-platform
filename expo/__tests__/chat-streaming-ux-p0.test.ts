import { describe, it, expect, mock } from 'bun:test';

// Mock React Native before any imports.
mock.module('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }), currentState: 'active' },
  Platform: { OS: 'ios' },
  Linking: { canOpenURL: async () => true, openURL: async () => {}, addEventListener: () => ({ remove: () => {} }) },
  TurboModuleRegistry: { get: () => ({}) },
  NativeModules: {},
  NativeEventEmitter: class { addListener() { return { remove: () => {} }; } removeAllListeners() {} },
  StyleSheet: { create: (s: Record<string, unknown>) => s, flatten: (s: Record<string, unknown>) => s },
}));

mock.module('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));

mock.module('@/lib/ivx-supabase-client', () => ({
  getIVXSupabaseClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    }),
  }),
  getIVXAccessToken: async () => 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvd25lci0xIiwiZW1haWwiOiJvd25lckBpdnhob2xkaW5nLmNvbSIsImlzcyI6Imh0dHBzOi8va3ZjbGNkam1qZ2huZHhzbmdmemIuc3VwYWJhc2UuY28iLCJleHAiOjIwMDAwMDAwMDB9.test-signature',
  getIVXOwnerAIConfigAudit: () => ({
    activeEndpoint: 'https://api.ivxholding.com/api/ivx/owner-ai',
    activeBaseUrl: 'https://api.ivxholding.com',
    blocksRemoteRequests: false,
    candidateEndpoints: ['https://api.ivxholding.com/api/ivx/owner-ai'],
    fallbackEndpoint: null,
  }),
  getIVXOwnerAICandidateEndpoints: () => ['https://api.ivxholding.com/api/ivx/owner-ai'],
  getIVXOwnerAIEndpoint: () => 'https://api.ivxholding.com/api/ivx/owner-ai',
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    }),
  },
}));

// ivxOwnerMemoryService is NOT mocked — AsyncStorage is already mocked above,
// so the real service works fine without leaking a process-global mock that
// breaks ivx-multimodal-upload.test.ts in the full suite.
const { ivxAIRequestService } = await import('@/src/modules/ivx-owner-ai/services/ivxAIRequestService');

function buildSSEResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

describe('P0 chat streaming UX', () => {
  it('calls onProgress for every SSE delta without waiting for the full response', async () => {
    const events = [
      'data: {"type":"start","startedAt":"2026-08-10T12:00:00.000Z"}\n\n',
      'data: {"type":"delta","delta":"Hello "}\n\n',
      'data: {"type":"delta","delta":"world"}\n\n',
      `data: {"type":"final","status":200,"ok":true,"body":{"ok":true,"status":"ok","answer":"Hello world","source":"chatgpt","model":"openai/gpt-4o","requestId":"req-123","conversationId":"conv-123","assistantMessageId":"msg-123","assistantPersisted":true}}\n\n`,
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => buildSSEResponse(events);

    try {
      const deltas: string[] = [];
      const result = await ivxAIRequestService.requestOwnerAI(
        { conversationId: 'conv-123', message: 'Say hello', senderLabel: 'Test', mode: 'chat' },
        {
          onProgress: (event) => {
            if (event.type === 'delta') deltas.push(event.delta);
          },
        },
      );

      expect(deltas).toEqual(['Hello ', 'world']);
      expect(result.answer).toBe('Hello world');
      expect(result.source).toBe('remote_api');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not buffer: first delta reaches onProgress before final event', async () => {
    const events = [
      'data: {"type":"start","startedAt":"2026-08-10T12:00:00.000Z"}\n\n',
      'data: {"type":"delta","delta":"First"}\n\n',
      'data: {"type":"delta","delta":"Second"}\n\n',
      'data: {"type":"delta","delta":"Third"}\n\n',
      `data: {"type":"final","status":200,"ok":true,"body":{"ok":true,"status":"ok","answer":"FirstSecondThird","source":"chatgpt","model":"openai/gpt-4o","requestId":"req-456","conversationId":"conv-456","assistantMessageId":"msg-456","assistantPersisted":true}}\n\n`,
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => buildSSEResponse(events);

    try {
      const order: string[] = [];
      await ivxAIRequestService.requestOwnerAI(
        { conversationId: 'conv-456', message: 'Count to three', senderLabel: 'Test', mode: 'chat' },
        {
          onProgress: (event) => {
            order.push(event.type);
          },
        },
      );

      const firstDeltaIndex = order.indexOf('delta');
      const finalIndex = order.indexOf('final');
      expect(firstDeltaIndex).toBeGreaterThanOrEqual(0);
      expect(finalIndex).toBeGreaterThan(firstDeltaIndex);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
