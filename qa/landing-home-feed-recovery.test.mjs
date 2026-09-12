import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('expo/ivxholding-landing/ivx-home-feed.js', 'utf8');
const feed = { blocks: [{ type: 'deal', deal: { id: 'published-deal' } }] };
const response = (status, body = feed, contentType = 'application/json') => ({
  ok: status >= 200 && status < 300, status,
  headers: new Headers({ 'content-type': contentType }), json: async () => body,
});

function fixture(respond) {
  const window = {}, errors = [], warnings = [], calls = [], timers = new Map(), deadlines = [];
  let clock = 1000, timerId = 0;
  vm.runInNewContext(source, {
    window, AbortController, URL,
    Date: { now: () => clock },
    document: { readyState: 'complete', createElement: () => ({}), head: { appendChild() {} }, getElementById: () => null },
    console: { error: (...args) => errors.push(args), warn: (...args) => warnings.push(args), log() {} },
    fetch: async (url, options) => { calls.push({ url, signal: options.signal }); return respond(calls.length, options.signal); },
    setTimeout: (callback, ms) => { const id = ++timerId; deadlines.push(ms); timers.set(id, { callback, at: clock + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return { window, errors, warnings, calls, timers, deadlines,
    advance(ms) { clock += ms; for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.callback(); } },
  };
}
async function settle() { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)); }

test('a successful canonical response completes in one request', async () => {
  const f = fixture(() => response(200)); await settle();
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
  assert.equal(f.window.__ivxHomeFeedStatus.blockCount, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.errors.length, 0);
  assert.equal(f.warnings.length, 0); assert.equal(f.timers.size, 0);
});

for (const [name, unavailable] of [
  ['data_available=false', response(200, { blocks: [], data_available: false })],
  ['unavailable code', response(200, { blocks: [], code: 'PUBLIC_DATA_UNAVAILABLE' })],
  ['unavailable header', { ...response(200, { blocks: [] }), headers: new Headers({ 'content-type': 'application/json', 'X-IVX-Data-State': 'unavailable' }) }],
]) {
  test(`Home retries HTTP 200 with ${name} and requires an available response`, async () => {
    const recovered = fixture(n => n === 1 ? unavailable : response(200));
    await settle();
    assert.equal(recovered.calls.length, 2);
    assert.equal(recovered.window.__ivxHomeFeedStatus.state, 'ready');
    assert.equal(recovered.window.__ivxHomeFeedStatus.blockCount, 1);
    assert.equal(recovered.timers.size, 0);

    const outage = fixture(() => unavailable);
    await settle();
    assert.equal(outage.calls.length, 2);
    assert.equal(outage.window.__ivxHomeFeedStatus.state, 'failed');
    assert.equal(outage.window.__ivxHomeFeedStatus.blockCount, 0);
    assert.equal(outage.timers.size, 0);
  });
}

test('an available empty Home catalog remains valid even when served stale', async () => {
  const f = fixture(() => response(200, { blocks: [], data_available: true, degraded: true }));
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
  assert.equal(f.window.__ivxHomeFeedStatus.blockCount, 0);
});

test('a 503 is recovered only after the alternate host returns a valid feed', async () => {
  let release;
  const f = fixture(n => n === 1 ? response(503) : new Promise(resolve => { release = resolve; }));
  await settle();
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'loading');
  assert.equal(f.calls.length, 2);
  assert.notEqual(new URL(f.calls[0].url).host, new URL(f.calls[1].url).host);
  release(response(200)); await settle();
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
  assert.equal(f.window.__ivxHomeFeedStatus.attempts, 2);
  assert.equal(f.warnings.length, 1); assert.equal(f.errors.length, 0);
  assert.equal(f.timers.size, 0);
});

test('persistent 503s remain a terminal runtime error and cannot loop', async () => {
  const f = fixture(() => response(503)); await settle();
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(f.calls.length, 2); assert.equal(f.errors.length, 1);
  assert.equal(f.window.__ivxHomeFeedStatus.blockCount, 0);
  assert.equal(f.timers.size, 0);
});

test('malformed JSON shape or HTML cannot masquerade as a successful feed', async () => {
  for (const bad of [response(200, {}), response(200, feed, 'text/html'), { ...response(200), json: async () => { throw new SyntaxError('invalid JSON'); } }]) {
    const f = fixture(() => bad); await settle();
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
    assert.equal(f.calls.length, 2); assert.equal(f.errors.length, 1);
    assert.equal(f.timers.size, 0);
  }
});

test('a hung request is aborted before fallback and a healthy second request recovers', async () => {
  const f = fixture((n, signal) => n === 1 ? new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
  }) : response(200));
  await settle(); f.advance(9000); await settle();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
  assert.equal(f.errors.length, 0); assert.equal(f.timers.size, 0);
});

test('both hung hosts stop within one total 18-second operation budget', async () => {
  const f = fixture((_, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
  }));
  await settle(); f.advance(9000); await settle(); f.advance(9000); await settle();
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(f.calls.length, 2); assert.equal(f.errors.length, 1);
  assert.ok(f.calls.every(call => call.signal.aborted));
  assert.deepEqual(f.deadlines, [9000, 9000]); assert.equal(f.timers.size, 0);
});

test('an elapsed deadline cannot start a new request after a delayed abort callback', async () => {
  const f = fixture((_, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
  }));
  await settle(); f.advance(19000); await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(f.errors.length, 1); assert.equal(f.timers.size, 0);
});

test('the request deadline remains active while the response body is being read', async () => {
  const f = fixture((_, signal) => ({ ...response(200), json: () => new Promise((__, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
  }) }));
  await settle(); f.advance(9000); await settle(); f.advance(9000); await settle();
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(f.calls.length, 2); assert.equal(f.errors.length, 1);
  assert.equal(f.timers.size, 0);
});
