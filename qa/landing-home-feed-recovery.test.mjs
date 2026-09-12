import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('expo/ivxholding-landing/ivx-home-feed.js', 'utf8');
const feed = { blocks: [{ type: 'deal', deal: { id: 'published-deal' } }] };
const response = (status, body = feed, contentType = 'application/json', retryAfter = null) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Headers({ 'content-type': contentType, ...(retryAfter === null ? {} : { 'retry-after': retryAfter }) }), json: async () => body,
});

function fixture(respond) {
  const window = {}, errors = [], warnings = [], calls = [], timers = new Map(), deadlines = [];
  let clock = 1000, timerId = 0;
  vm.runInNewContext(source, {
    window, AbortController, URL,
    Date: { now: () => clock, parse: Date.parse },
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

test('recovery waits for the server Retry-After while the public cache warms', async () => {
  for (const retryAfter of ['3', 'Thu, 01 Jan 1970 00:00:04 GMT']) {
    const f = fixture(n => n === 1 ? response(200, { blocks: [], degraded: true }, 'application/json', retryAfter) : response(200));
    await settle();
    assert.equal(f.calls.length, 1, 'Do not spend the second attempt during the server backoff');
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'loading');
    f.advance(2999); await settle(); assert.equal(f.calls.length, 1);
    f.advance(1); await settle();
    assert.equal(f.calls.length, 2);
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
    assert.equal(f.window.__ivxHomeFeedStatus.blockCount, 1);
    assert.equal(f.timers.size, 0);
  }
});

test('server backoff cannot extend the total recovery budget or retry an authorization denial', async () => {
  for (const [status, delay] of [[503, '60'], [429, '18'], [403, '3'], [401, '3']]) {
    const f = fixture(() => response(status, {}, 'application/json', delay));
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
    assert.equal(f.timers.size, 0);
  }
});

test('a delayed retry callback cannot issue a request after the operation deadline', async () => {
  const f = fixture(() => response(503, {}, 'application/json', '3'));
  await settle(); f.advance(19000); await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(f.timers.size, 0);
});

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

test('HTTP 200 unavailable render structures cannot finish canonical feed recovery', async () => {
  for (const flags of [{ degraded: true }, { data_available: false }, { code: 'PUBLIC_DATA_UNAVAILABLE' }]) {
    let release;
    const f = fixture(n => n === 1 ? response(200, { blocks: [], ...flags })
      : new Promise(resolve => { release = resolve; }));
    await settle();
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'loading');
    assert.equal(f.calls.length, 2);
    release(response(200)); await settle();
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
    assert.equal(f.window.__ivxHomeFeedStatus.blockCount, 1);
    assert.equal(f.timers.size, 0);
  }
});

test('persistent degraded responses fail, while a real empty catalog remains valid', async () => {
  const failed = fixture(() => response(200, { blocks: [], degraded: true, data_available: false }));
  await settle();
  assert.equal(failed.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(failed.calls.length, 2);
  assert.equal(failed.timers.size, 0);
  const empty = fixture(() => response(200, { blocks: [], data_available: true }));
  await settle();
  assert.equal(empty.window.__ivxHomeFeedStatus.state, 'ready');
  assert.equal(empty.window.__ivxHomeFeedStatus.blockCount, 0);
  assert.equal(empty.calls.length, 1);
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

test('a cold producer recovers on the same host only after its advertised retry delay', async () => {
  let recovered = false;
  const f = fixture(() => recovered ? response(200)
    : response(200, { blocks: [], degraded: true, data_available: false }, 'application/json', '3'));
  await settle();
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(f.calls.length, attempt);
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'loading');
    f.advance(2999); await settle();
    assert.equal(f.calls.length, attempt, 'Do not retry before the server permits it');
    if (attempt === 3) recovered = true;
    f.advance(1); await settle();
  }
  assert.equal(f.calls.length, 4);
  assert.equal(new Set(f.calls.map(call => call.url)).size, 1);
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
  assert.equal(f.window.__ivxHomeFeedStatus.blockCount, 1);
  assert.equal(f.errors.length, 0); assert.equal(f.timers.size, 0);
});

test('Retry-After dates on 503 and 429 preserve the wait before a successful retry', async () => {
  for (const status of [503, 429]) {
    const f = fixture(n => n === 1 ? response(status, {}, 'application/json', 'Thu, 01 Jan 1970 00:00:04 GMT') : response(200));
    await settle(); f.advance(2999); await settle();
    assert.equal(f.calls.length, 1);
    f.advance(1); await settle();
    assert.equal(f.calls.length, 2);
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
    assert.equal(f.timers.size, 0);
  }
});

test('persistent advertised unavailability stops at four requests and never renders a fallback as ready', async () => {
  const f = fixture(() => response(200, { blocks: [], degraded: true }, 'application/json', '3'));
  await settle();
  for (let i = 0; i < 3; i++) { f.advance(3000); await settle(); }
  assert.equal(f.calls.length, 4);
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(f.window.__ivxHomeFeedStatus.blockCount, 0);
  assert.equal(f.errors.length, 1); assert.equal(f.timers.size, 0);
});

test('an advertised wait beyond the operation budget cannot cause an early retry on another host', async () => {
  for (const retryAfter of ['20', '9'.repeat(400)]) {
    const f = fixture(() => response(503, {}, 'application/json', retryAfter));
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
    assert.equal(f.timers.size, 0);
  }
});

test('malformed Retry-After values retain the bounded alternate-host recovery', async () => {
  for (const retryAfter of ['-1', '1.5', 'invalid date', 'Infinity']) {
    const f = fixture(n => n === 1 ? response(503, {}, 'application/json', retryAfter) : response(200));
    await settle();
    assert.equal(f.calls.length, 2);
    assert.notEqual(new URL(f.calls[0].url).host, new URL(f.calls[1].url).host);
    assert.equal(f.window.__ivxHomeFeedStatus.state, 'ready');
    assert.equal(f.timers.size, 0);
  }
});

test('a delayed retry callback cannot dispatch after the original deadline', async () => {
  const f = fixture(() => response(503, {}, 'application/json', '3'));
  await settle(); f.advance(19000); await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.window.__ivxHomeFeedStatus.state, 'failed');
  assert.equal(f.timers.size, 0);
});
