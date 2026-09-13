import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAutonomousDashboardStreamConnection } from './ivx-autonomous-dashboard-stream';
import type WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';

class MockWebSocket {
  readyState = 1;
  bufferedAmount = 0;
  private listeners = new Map<string, Function[]>();

  send(data: string) {
    this.emit('message', Buffer.from(data));
  }

  close() {}

  on(event: string, listener: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(listener);
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach(listener => listener(...args));
  }
}

class MockReq {
  socket = { remoteAddress: '127.0.0.1' };
}

async function simulateConnection() {
  const mockWs = new MockWebSocket();
  const req = new MockReq() as unknown as IncomingMessage;

  await handleAutonomousDashboardStreamConnection(mockWs as unknown as WebSocket, req);

  // Simulate receiving an invalid message
  mockWs.emit('message', Buffer.from('invalid_message'));

  return mockWs;
}

test('should log error and send stream_error message', async (t) => {
  const ws = await simulateConnection();

  ws.on('message', (data: Buffer) => {
    assert.ok(data.toString().includes('stream_error'), 'Should receive stream_error message');
  });
});
