import { describe, test, expect } from 'bun:test';
import { ownerChatFingerprint, ownerChatRequestKey, reconcileOwnerChatRequest, runOwnerChatOnce, type ChatRequestRecord, type ChatRequestStore } from './ivx-owner-chat-admission';

function fixture() {
  const rows = new Map<string, ChatRequestRecord>();
  const store = (): ChatRequestStore => ({
    async insert(key, row) { if (rows.has(key)) return false; rows.set(key, structuredClone(row)); return true; },
    async read(key) { return rows.has(key) ? structuredClone(rows.get(key)!) : null; },
    async complete(key, token, row) {
      const current = rows.get(key);
      if (current?.state !== 'running' || current.token !== token) return false;
      rows.set(key, structuredClone(row)); return true;
    },
  });
  const key = ownerChatRequestKey('owner-a', 'conversation-a', 'message-1');
  return { rows, store, key, requestId: 'message-1', fingerprint: ownerChatFingerprint({ message: 'hello' }) };
}

describe('owner chat admission and lost acknowledgement recovery', () => {
  test('overlapping replicas execute once and replay the exact persisted response', async () => {
    const f = fixture(); let calls = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execute = async () => { calls++; await gate; return Response.json({ status: 'ok', answer: 'real result', taskId: 'job-1' }); };
    const first = runOwnerChatOnce({ ...f, store: f.store(), execute });
    await Promise.resolve();
    const second = await runOwnerChatOnce({ ...f, store: f.store(), execute });
    expect(second.status).toBe(409);
    release();
    const firstBody = await (await first).text();
    const replay = await runOwnerChatOnce({ ...f, store: f.store(), execute });
    expect(await replay.text()).toBe(firstBody);
    expect(replay.headers.get('X-IVX-Request-Replayed')).toBe('true');
    expect(calls).toBe(1);
  });

  test('lost INSERT acknowledgement permits only its own committed token', async () => {
    const f = fixture(); const store = f.store(); let calls = 0;
    store.insert = async (key, row) => { f.rows.set(key, row); throw new Error('ack lost'); };
    const result = await runOwnerChatOnce({ ...f, store, execute: async () => { calls++; return Response.json({ answer: 'saved' }); } });
    expect(result.status).toBe(200); expect(calls).toBe(1);
  });

  test('unconfirmed admission fails closed before any provider or tool executes', async () => {
    const f = fixture(); const store = f.store(); let calls = 0;
    store.insert = async () => { throw new Error('timeout'); };
    const result = await runOwnerChatOnce({ ...f, store, execute: async () => { calls++; return Response.json({ answer: 'bad' }); } });
    expect(result.status).toBe(503); expect(calls).toBe(0);
    expect((await result.json()).executionOutcome).toBe('unknown');
  });

  test('an unavailable reconciliation read does not create another execution', async () => {
    const f = fixture(); const store = f.store(); let calls = 0;
    store.insert = async () => false; store.read = async () => { throw new Error('read unavailable'); };
    const result = await runOwnerChatOnce({ ...f, store, execute: async () => { calls++; return Response.json({}); } });
    expect(result.status).toBe(503); expect(calls).toBe(0);
  });

  test('a lost completion acknowledgement reuses the saved result', async () => {
    const f = fixture(); const store = f.store(); const complete = store.complete; let calls = 0;
    store.complete = async (...args) => { await complete(...args); throw new Error('completion ack lost'); };
    const execute = async () => { calls++; return Response.json({ answer: 'persisted result' }); };
    expect((await runOwnerChatOnce({ ...f, store, execute })).status).toBe(200);
    expect((await runOwnerChatOnce({ ...f, store: f.store(), execute })).status).toBe(200);
    expect(calls).toBe(1);
  });

  test('a provider result without confirmed persistence stays an error and cannot be regenerated', async () => {
    const f = fixture(); const store = f.store(); let calls = 0;
    store.complete = async () => { throw new Error('database unavailable'); };
    const execute = async () => { calls++; return Response.json({ answer: 'uncertain result' }); };
    expect((await runOwnerChatOnce({ ...f, store, execute })).status).toBe(503);
    expect((await runOwnerChatOnce({ ...f, store: f.store(), execute })).status).toBe(409);
    expect(calls).toBe(1);
  });

  test('a process restart cannot take over a stale in-flight provider call', async () => {
    const f = fixture(); let calls = 0;
    f.rows.set(f.key, { version: 1, fingerprint: f.fingerprint, token: 'previous-process', state: 'running', startedAt: '2000-01-01T00:00:00Z' });
    const result = await runOwnerChatOnce({ ...f, store: f.store(), execute: async () => { calls++; return Response.json({}); } });
    expect(result.status).toBe(409); expect(calls).toBe(0);
  });

  test('the same message identity rejects changed content', async () => {
    const f = fixture(); let calls = 0;
    const execute = async () => { calls++; return Response.json({ answer: 'first' }); };
    await runOwnerChatOnce({ ...f, store: f.store(), execute });
    const conflict = await runOwnerChatOnce({ ...f, fingerprint: ownerChatFingerprint({ message: 'different' }), store: f.store(), execute });
    expect(conflict.status).toBe(409); expect(calls).toBe(1);
    expect((await conflict.json()).code).toBe('OWNER_CHAT_IDENTITY_CONFLICT');
  });

  test('owners, conversations and equal-text distinct messages keep separate identities', () => {
    const keys = [ownerChatRequestKey('a', 'c', 'm'), ownerChatRequestKey('b', 'c', 'm'), ownerChatRequestKey('a', 'd', 'm'), ownerChatRequestKey('a', 'c', 'n')];
    expect(new Set(keys).size).toBe(4);
    expect(ownerChatFingerprint({ message: 'hi', traceId: 'one', requestId: 'm' })).toBe(ownerChatFingerprint({ requestId: 'm', traceId: 'two', message: 'hi' }));
    expect(() => ownerChatRequestKey('', 'c', 'm')).toThrow();
  });

  test('durable recovery polls the original result with its message link', async () => {
    const f = fixture();
    await runOwnerChatOnce({ ...f, store: f.store(), execute: async () => Response.json({ status: 'ok', answer: 'original', assistantMessageId: 'assistant-1', assistantPersisted: true }) });
    const task = await reconcileOwnerChatRequest(f.store(), f.key, 'owner-request:message-1');
    expect(task?.answer).toBe('original'); expect(task?.assistantMessageId).toBe('assistant-1');
    expect(task?.checkpoint).toBe('ORIGINAL_RESPONSE_RECONCILED');
    expect(task?.terminal).toBe(true);
  });

  test('HTTP 200 error envelopes are never reported as recovered success', async () => {
    const f = fixture();
    await runOwnerChatOnce({ ...f, store: f.store(), execute: async () => Response.json({ status: 'error', answer: 'provider failed' }) });
    const task = await reconcileOwnerChatRequest(f.store(), f.key, 'owner-request:message-1');
    expect(task?.status).toBe('FAILED'); expect(task?.answer).toBeNull();
  });

  test('completed error responses are replayed without repeating an uncertain provider call', async () => {
    const f = fixture(); let calls = 0;
    const execute = async () => { calls++; return Response.json({ error: 'provider timeout' }, { status: 504 }); };
    expect((await runOwnerChatOnce({ ...f, store: f.store(), execute })).status).toBe(504);
    expect((await runOwnerChatOnce({ ...f, store: f.store(), execute })).status).toBe(504);
    expect(calls).toBe(1);
  });
});
