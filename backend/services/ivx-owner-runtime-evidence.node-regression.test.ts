import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('Node HTTP preserves current serving evidence through JSON replay, SSE and middleware body access', () => {
  // The Node adapter replaces global Response. Bun-only tests cannot exercise
  // its lazy header/body conversion, so run the actual production transport.
  const result = spawnSync('node', ['--import', 'tsx', '--input-type=module', '-'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, RENDER_GIT_COMMIT: 'a'.repeat(40) },
    input: `
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { withOwnerRuntimeEvidence } = require('./backend/services/ivx-owner-runtime-evidence.ts');
const { runOwnerChatOnce } = require('./backend/services/ivx-owner-chat-admission.ts');
const app = new Hono(), records = new Map();
let executions = 0;
const store = {
  async insert(key, record) { if (records.has(key)) return false; records.set(key, record); return true; },
  async read(key) { return records.get(key) ?? null; },
  async complete(key, token, record) { if (records.get(key)?.token !== token) return false; records.set(key, record); return true; },
};
// CORS prepares c.res before route completion, as it does in production.
app.use('*', cors({ origin: origin => origin, exposeHeaders: ['Content-Type'] }));
app.get('/json', async () => withOwnerRuntimeEvidence(await runOwnerChatOnce({
  key: 'fixture', requestId: 'fixture', fingerprint: 'same-input', store,
  execute: async () => { executions++; return Response.json({ ok: true, answer: 'fixture' }); },
})));
app.get('/sse', () => withOwnerRuntimeEvidence(new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\\n\\n'));
    controller.enqueue(new TextEncoder().encode('data: {"type":"final"}\\n\\n'));
    controller.close();
  },
}), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })));
app.get('/error', async () => {
  const response = withOwnerRuntimeEvidence(new Response('{"ok":false}', {
    status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
  }));
  assert.equal(await response.clone().text(), '{"ok":false}');
  return response;
});
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
let instance;
try {
  for (const [index, path] of ['/json', '/json', '/json', '/sse', '/error'].entries()) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.headers.get('x-ivx-serving-commit'), 'a'.repeat(40), path + ': serving SHA lost');
    const observed = response.headers.get('x-ivx-serving-instance');
    assert.match(observed ?? '', /^[a-f0-9-]{36}$/);
    instance ??= observed; assert.equal(observed, instance);
    if (path === '/json') {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-ivx-request-replayed'), index ? 'true' : null);
      assert.deepEqual(await response.json(), { ok: true, answer: 'fixture' });
    } else if (path === '/sse') {
      assert.match(response.headers.get('content-type'), /text\\/event-stream/);
      assert.equal(await response.text(), 'data: {"type":"start"}\\n\\ndata: {"type":"final"}\\n\\n');
    } else {
      assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '5');
      assert.deepEqual(await response.json(), { ok: false });
    }
  }
  assert.equal(executions, 1, 'Replays must not execute the provider again');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
`,
  });
  expect({ status: result.status, signal: result.signal, error: result.error?.message,
    output: result.stdout + result.stderr }).toMatchObject({ status: 0, signal: null, error: undefined });
}, 25_000);
