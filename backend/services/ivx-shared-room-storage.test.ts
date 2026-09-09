import { expect, test } from 'bun:test';
import type { ChatStorage } from '../chat-storage';
import { SharedRoomStorage } from './ivx-shared-room-storage';

test('two API adapters share confirmed history and never fall back to a local write on DB failure', async () => {
  const names = ['IVX_REQUIRE_SHARED_STATE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
  const previous = names.map(n => process.env[n]);
  process.env.IVX_REQUIRE_SHARED_STATE = 'true'; process.env.SUPABASE_URL = 'https://test.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key';
  let localWrites = 0, unavailable = false;
  const local = { createMessage() { localWrites++; }, listMessages() { throw new Error('Local read forbidden'); } } as unknown as ChatStorage;
  const rows: Record<string, unknown>[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    if (unavailable) return new Response(null, { status: 503 });
    if (init.method === 'POST') { const row = { ...JSON.parse(String(init.body)), id: 'db-id', created_at: new Date().toISOString() }; rows.push(row); return Response.json([row]); }
    if (init.method === 'HEAD') return new Response(null, { headers: { 'content-range': `0-0/${rows.length}` } });
    return Response.json(rows.toReversed());
  }) as typeof fetch;
  try {
    const a = new SharedRoomStorage(local, fetcher), b = new SharedRoomStorage(local, fetcher);
    const saved = await a.createMessage({ roomId: 'main', username: 'fixture', text: 'shared message', source: 'user' });
    expect((await b.listMessages('main', 20))[0]).toEqual(saved);
    expect(await b.getRoomMessageCount('main')).toBe(1);
    unavailable = true;
    await expect(a.createMessage({ roomId: 'main', username: 'fixture', text: 'must fail', source: 'user' })).rejects.toThrow('503');
    await expect(b.listMessages('main', 20)).rejects.toThrow('503');
    expect(localWrites).toBe(0); expect(rows).toHaveLength(1);
  } finally { names.forEach((n, i) => { if (previous[i] === undefined) delete process.env[n]; else process.env[n] = previous[i]; }); }
});
