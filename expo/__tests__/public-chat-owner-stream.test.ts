import { afterEach, describe, expect, mock, test } from 'bun:test';

let accessToken: string | null = 'test-owner-session';
mock.module('@/lib/api-base', () => ({ getDirectApiBaseUrl: () => 'https://api.example.test' }));
mock.module('@/lib/ivx-supabase-client', () => ({ getIVXAccessToken: async () => accessToken }));
mock.module('expo/fetch', () => ({ fetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init) }));
const { streamPublicChatMessage } = await import('../lib/public-chat-stream');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('public stream owner handoff', () => {
  test.each([true, false])('forwards the actual session and preserves worker events (signed in: %s)', async signedIn => {
    accessToken = signedIn ? 'test-owner-session' : null;
    let headers: Headers | null = null;
    const terminal = { type: 'response.completed', text: 'Task received', model: 'autonomous', source: 'autonomous', requestId: 'turn-1', sessionId: 'thread-1', jobId: 'real-job-1' };
    const events = [
      { type: 'response.autonomous_task', ok: true, jobId: 'real-job-1', status: 'QUEUED', stage: 'QUEUED' },
      terminal,
    ];
    globalThis.fetch = mock(async (_url, init) => {
      headers = new Headers(init?.headers);
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;
    const received: unknown[] = [];
    const completed = mock(() => {});
    const failed = mock(() => {});
    await streamPublicChatMessage({ message: 'Audit the code', history: [], requestId: 'turn-1', sessionId: 'thread-1', clientId: 'device-1' }, {
      onEvent: event => received.push(event), onComplete: completed, onError: failed,
    });
    expect((headers as unknown as Headers).get('Authorization')).toBe(signedIn ? 'Bearer test-owner-session' : null);
    expect((headers as unknown as Headers).get('x-ivx-client-id')).toBe('device-1');
    expect(received).toEqual(events);
    expect(completed).toHaveBeenCalledWith('Task received', 'autonomous', 'autonomous');
    expect(failed).not.toHaveBeenCalled();
  });
});
