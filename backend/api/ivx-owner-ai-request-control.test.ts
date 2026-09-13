import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

// Shared durable-store fixture. Each HTTP call gets a separate client facade.
const rows = new Map<string, any>();
let ownerId = 'owner-a';
let unavailable = false;
let loseInsertAck = false;
let loseUpdateAck = false;
let authStatus = 0;
function client() {
  return { from() {
    let operation = 'read'; let payload: any; const filters: [string, unknown][] = [];
    let single = false;
    const query: any = {
      insert(value: any) { operation = 'insert'; payload = value; return query; },
      update(value: any) { operation = 'update'; payload = value; return query; },
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      limit() { return query; }, abortSignal() { return query; }, maybeSingle() { single = true; return query; },
      then(resolve: (value: any) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          if (unavailable) throw new Error('storage offline');
          if (operation === 'insert') {
            if (rows.has(payload.doc_key)) return { data: null, error: { code: '23505' } };
            rows.set(payload.doc_key, structuredClone(payload));
            if (loseInsertAck) { loseInsertAck = false; throw new Error('insert acknowledgement lost'); }
            return { data: [{ doc_key: payload.doc_key }], error: null };
          }
          const matches = [...rows.values()].filter(row => filters.every(([key, value]) =>
            (key.startsWith('value->>') ? String(row.value[key.slice(8)]) : row[key]) === value));
          if (operation === 'update') {
            for (const row of matches) rows.set(row.doc_key, { ...row, ...structuredClone(payload) });
            if (loseUpdateAck) { loseUpdateAck = false; throw new Error('update acknowledgement lost'); }
            return { data: matches.map(row => ({ doc_key: row.doc_key })), error: null };
          }
          return { data: single ? structuredClone(matches[0] ?? null) : structuredClone(matches), error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  } };
}

mock.module('./owner-only', () => ({
  assertIVXOwnerOnly: async () => {
    if (authStatus) throw Object.assign(new Error('auth rejected'), { status: authStatus });
    return { userId: ownerId, client: client() };
  },
  ownerOnlyJson: (body: unknown, status = 200) => Response.json(body, { status }),
  ownerOnlyOptions: () => new Response(null, { status: 204 }),
}));
const { handleIVXOwnerAIRequestCreate: create, handleIVXOwnerAIRequestStatus: status,
  handleIVXOwnerAIRequestCancel: cancel, handleIVXOwnerAIRequestRetry: retry } = await import('./ivx-owner-ai-request-control');
const request = (body: unknown = {}) => new Request('https://example.test/api/ivx/owner-ai/request', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const body = (key = randomUUID()) => ({ message: 'Audit the bounded repair', conversationId: 'room-1', idempotencyKey: key });
beforeEach(() => { rows.clear(); ownerId = 'owner-a'; unavailable = false; loseInsertAck = false; loseUpdateAck = false; authStatus = 0; });

describe('owner request control durable idempotency', () => {
  test('overlapping pending submissions return one immutable request identity', async () => {
    const input = body();
    const responses = await Promise.all(Array.from({ length: 8 }, () => create(request(input))));
    const receipts = await Promise.all(responses.map(response => response.json()));
    expect(new Set(receipts.map(receipt => receipt.requestId)).size).toBe(1);
    expect(responses.filter(response => response.status === 202).length).toBe(1);
    expect(receipts.filter(receipt => receipt.duplicate).length).toBe(7);
    expect(rows.size).toBe(1);
  });
  test('a reused key with different content or conversation is rejected', async () => {
    const input = body(); await create(request(input));
    expect((await create(request({ ...input, message: 'Different repair' }))).status).toBe(409);
    expect((await create(request({ ...input, conversationId: 'another-room' }))).status).toBe(409);
  });
  test('a stable explicit key is required before admission', async () => {
    for (const idempotencyKey of [undefined, '', '  ', 7, 'x'.repeat(513)]) {
      expect((await create(request({ ...body(), idempotencyKey }))).status).toBe(400);
    }
    expect(rows.size).toBe(0);
  });
  test('owner identities isolate creation, lookup, retry and cancellation', async () => {
    const input = body(); const first = await (await create(request(input))).json();
    ownerId = 'owner-b';
    expect((await status(request(), first.traceId)).status).toBe(404);
    expect((await cancel(request(), first.traceId)).status).toBe(404);
    expect((await retry(request(), first.traceId)).status).toBe(404);
    const second = await (await create(request(input))).json();
    expect(second.traceId).not.toBe(first.traceId);
    expect(second.requestId).not.toBe(first.requestId);
  });
  test('storage failure cannot return a false accepted receipt', async () => {
    unavailable = true;
    expect((await create(request(body()))).status).toBe(503);
  });
  test('a lost insert acknowledgement is reconciled against the same durable identity', async () => {
    loseInsertAck = true; const input = body();
    const first = await (await create(request(input))).json();
    const second = await (await create(request(input))).json();
    expect(second.requestId).toBe(first.requestId);
    expect(second.duplicate).toBe(true);
    expect(rows.size).toBe(1);
  });
  test('a caller trace cannot overwrite an earlier distinct request', async () => {
    const first = await (await create(request({ ...body(), traceId: 'caller-trace' }))).json();
    const second = await (await create(request({ ...body(), traceId: 'caller-trace' }))).json();
    expect(second.traceId).not.toBe(first.traceId);
    expect((await (await status(request(), first.traceId)).json()).requestId).toBe(first.requestId);
  });
  test('a cancelled request stays cancelled on submission retry', async () => {
    const input = body(); const first = await (await create(request(input))).json();
    expect((await cancel(request(), first.traceId)).status).toBe(200);
    const replay = await (await create(request(input))).json();
    expect(replay.requestId).toBe(first.requestId);
    expect(replay.status).toBe('cancelled');
    expect(replay.duplicate).toBe(true);
  });
  test('concurrent explicit retries admit one state transition', async () => {
    const first = await (await create(request(body()))).json();
    await cancel(request(), first.traceId);
    const results = await Promise.all([retry(request(), first.traceId), retry(request(), first.traceId)]);
    expect(results.map(result => result.status).sort()).toEqual([202, 409]);
    expect((await (await status(request(), first.traceId)).json()).retryCount).toBe(1);
  });
  test('lost cancellation acknowledgement is read back without undoing state', async () => {
    const input = body(); const first = await (await create(request(input))).json();
    loseUpdateAck = true;
    expect((await cancel(request(), first.traceId)).status).toBe(200);
    expect((await (await create(request(input))).json()).status).toBe('cancelled');
  });
  test('malformed bodies cannot reach storage', async () => {
    for (const input of [null, [], 42, { ...body(), message: {} }, { ...body(), conversationId: [] }]) {
      expect((await create(request(input))).status).toBe(400);
    }
    expect(rows.size).toBe(0);
  });
  test('authentication failures are preserved before storage access', async () => {
    for (const code of [401, 403, 503]) {
      authStatus = code;
      expect((await create(request(body()))).status).toBe(code);
      expect((await status(request(), 'some-trace')).status).toBe(code);
    }
    expect(rows.size).toBe(0);
  });
  test('a recorded provider execution cannot be declared cancelled or retried', async () => {
    const first = await (await create(request(body()))).json();
    const stored = [...rows.values()][0];
    stored.value.record.status = 'in_flight'; stored.value.record.providerRequestId = 'provider-receipt';
    expect((await cancel(request(), first.traceId)).status).toBe(409);
    stored.value.record.status = 'failed';
    expect((await retry(request(), first.traceId)).status).toBe(409);
    expect(stored.value.record.retryCount).toBe(0);
  });
});
