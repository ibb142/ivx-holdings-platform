import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('expo/ivxholding-landing/ivx-app.js', 'utf8');
const part = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const bootstrap = part('  // INSTANT CONFIG FETCH', '  var SESSION_ID');
const helpers = part('  function isPlaceholder(val)', '  // STEP 1:')
  + part('  function isValidSupabasePublicKey(key)', '  checkSupabaseReady();')
  + part('  function applyDiscoveredConfig(cfg)', '  function tryDiscoverCredentials(callback)');
const config = { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_synthetic_test_value_123456789' };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture(respond) {
  const timers = new Map(), calls = [];
  const context = vm.createContext({
    window: {}, console: { log() {}, warn() {} }, AbortController, URL,
    SUPABASE_URL: '__IVX_SUPABASE_URL__', SUPABASE_ANON_KEY: '__IVX_SUPABASE_ANON_KEY__',
    _supabaseReady: false, _INSTANT_CONFIG_FETCHED: false,
    _HARDCODED_BACKEND_URL: 'https://api.example.com', IVX_API_FALLBACKS: [],
    cacheCredentials() {},
    setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => { calls.push({ url, signal: options?.signal }); return respond(url, options); },
  });
  vm.runInContext(helpers + bootstrap, context);
  return { context, calls, timers, expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } } };
}

test('auth starts from the shipped public config even when the backend is unavailable', async () => {
  const f = fixture(url => url.startsWith('/ivx-config.json') ? json(config) : Promise.reject(new Error('backend unavailable')));
  await settle();
  assert.equal(f.context._supabaseReady, true);
  assert.equal(f.context.window.IVX_SUPABASE_URL, config.supabaseUrl);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /^\/ivx-config\.json/);
  assert.equal(f.timers.size, 0);
});

test('placeholder, incomplete and malformed config cannot stop discovery before a valid source', async () => {
  for (const invalid of [{}, null, { supabaseUrl: config.supabaseUrl },
    { ...config, supabaseAnonKey: '__IVX_SUPABASE_ANON_KEY__' },
    { ...config, supabaseUrl: 'http://insecure.example.com' }]) {
    let count = 0;
    const f = fixture(() => json(++count === 1 ? invalid : config));
    await settle();
    assert.equal(f.context._supabaseReady, true, JSON.stringify(invalid));
    assert.equal(f.calls.length, 2);
    assert.equal(f.context.window.IVX_SUPABASE_ANON_KEY, config.supabaseAnonKey);
  }
});

test('the deadline covers a stalled JSON body and recovery publishes only the successful response', async () => {
  let count = 0;
  const f = fixture((_url, options) => ++count > 1 ? json(config) : ({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('body timeout')))) }));
  await settle();
  assert.equal(f.context._supabaseReady, false);
  assert.equal(f.timers.size, 1, 'A response header must not clear the body deadline');
  f.expire(); await settle();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.context._supabaseReady, true);
  assert.equal(f.calls.length, 2);
});

test('all failed sources leave authentication unavailable and stop after bounded attempts', async () => {
  const f = fixture(() => json({}, 503));
  await settle();
  assert.equal(f.context._supabaseReady, false);
  assert.equal(f.context._INSTANT_CONFIG_FETCHED, false);
  assert.equal(f.calls.length, 3);
  assert.equal(f.timers.size, 0);
  assert.ok(f.calls.every(call => call.signal));
});
