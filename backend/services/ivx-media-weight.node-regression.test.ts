import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureMediaWeight } from './ivx-media-weight';

const mediaFetch = (fn: (method: string) => Response) => (async (_url: unknown, init?: RequestInit) => fn(init?.method || 'GET')) as typeof fetch;

test('measureMediaWeight returns error for 404 status', async () => {
  const result = await measureMediaWeight(mediaFetch((method) => new Response(null, { status: 404 })), 'https://cdn.example/nonexistent-image');
  assert.equal(result.status, 404);
  assert.match(result.error!, /resource not found/);
});
