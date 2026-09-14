import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureMediaWeight } from './ivx-media-weight';

const mediaFetch = (fn: (method: string) => Response) => (async (_url: unknown, init?: RequestInit) => fn(init?.method || 'GET')) as typeof fetch;

test('media with no HEAD content-length returns error', async () => {
  const result = await measureMediaWeight(mediaFetch((method) => new Response(method === 'HEAD' ? null : null, { headers: { 'content-type': 'image/png' } })), 'https://cdn.example/missing-content-length');
  assert.equal(result.bytes, 0);
  assert.match(result.error!, /missing content-length/);
});
