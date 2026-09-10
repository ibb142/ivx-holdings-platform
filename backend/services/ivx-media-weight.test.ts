import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { measureMediaWeight } from './ivx-media-weight';

const mediaFetch = (fn: (method: string) => Response) => (async (_url: unknown, init?: RequestInit) => fn(init?.method || 'GET')) as typeof fetch;
test('missing HEAD length falls back to the binary body, not UTF-8 text length', async () => {
  const result = await measureMediaWeight(mediaFetch((method) => new Response(method === 'HEAD' ? null : new Uint8Array([255, 254, 253]), { headers: { 'content-type': 'image/png' } })), 'https://cdn.example/image');
  assert.equal(result.bytes, 3);
});
test('partial range reports the complete object size, never the one byte sample', async () => {
  const result = await measureMediaWeight(mediaFetch((method) => method === 'HEAD' ? new Response(null, { status: 405 }) : new Response(new Uint8Array([1]), { status: 206, headers: { 'content-range': 'bytes 0-0/2000000', 'content-length': '1' } })), 'https://cdn.example/image');
  assert.equal(result.bytes, 2_000_000);
});
test('unknown range size stays uncertified', async () => {
  const result = await measureMediaWeight(mediaFetch((method) => method === 'HEAD' ? new Response(null) : new Response(new Uint8Array([1]), { status: 206, headers: { 'content-length': '1' } })), 'https://cdn.example/image');
  assert.equal(result.bytes, 0);
  assert.match(result.error!, /total size/);
});
test('ignored Range cannot download an unbounded stream', async () => {
  let cancelled = false;
  const result = await measureMediaWeight(mediaFetch((method) => method === 'HEAD' ? new Response(null) : new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)); }, cancel() { cancelled = true; } }))), 'https://cdn.example/image', 15);
  assert.equal(result.bytes, 20);
  assert.equal(cancelled, true);
});
test('a network failure during streaming never certifies a partial body', async () => {
  const result = await measureMediaWeight(mediaFetch((method) => method === 'HEAD' ? new Response(null) : new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.error(new Error('connection lost')); } }))), 'https://cdn.example/image');
  assert.equal(result.bytes, 0);
  assert.match(result.error!, /connection lost/);
});
