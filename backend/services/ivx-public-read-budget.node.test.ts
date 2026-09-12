import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { measuredReadFetch, newReadTimings, readTimings } from './ivx-read-timings';

test('Node production transport closes a stalled response and SDK does not retry', async () => {
  let requests = 0;
  let closeSocket!: () => void;
  const closed = new Promise<void>(resolve => { closeSocket = resolve; });
  const server = createServer((req, res) => {
    requests++;
    req.socket.once('close', closeSocket);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('[{"id":');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const sb = createClient(`http://127.0.0.1:${(server.address() as any).port}`, 'test-only', {
      auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: measuredReadFetch },
    });
    const result = await Promise.race([
      readTimings.run(newReadTimings(100), () => Promise.resolve(sb.from('project_videos').select('id'))),
      new Promise<never>((_, reject) => { guard = setTimeout(() => reject(new Error('SDK exceeded budget')), 1000); }),
    ]);
    assert.ok(result.error);
    await Promise.race([closed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Socket still open')), 500).unref())]);
    assert.equal(requests, 1);
  } finally {
    clearTimeout(guard);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
