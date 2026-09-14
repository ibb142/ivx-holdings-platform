import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureMediaWeight } from './ivx-media-weight';

const mediaFetch = (fn: (method: string) => Response) => (async (_url: unknown, init?: RequestInit) => fn(init?.method || 'GET')) as typeof fetch;

test('should return error for unavailable media responses', async () => {
  const result = await measureMediaWeight(mediaFetch(() => new Response(null, { status: 404 })), 'https://cdn.example/missing-image');
  assert.equal(result.bytes, 0);
  assert.match(result.error!, /response not ok: 404/);
});
