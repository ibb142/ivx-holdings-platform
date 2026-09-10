import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile('expo/ivxholding-landing/ivx-app.js', 'utf8');
const analytics = app.slice(app.indexOf('  var _analyticsQueue = []'), app.indexOf("  ivxTrack('page_view'"));
const exitHandler = app.slice(app.indexOf("  window.addEventListener('beforeunload'"), app.indexOf('  var _funnelOrigOpen'));
function fixture(key = 'sb_publishable_fixture') {
  const calls = [], handlers = {};
  const context = vm.createContext({
    SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: key,
    SESSION_ID: 'session', VISIT_COUNT: 1, FUNNEL_STEP: 0, ENGAGEMENT_SCORE: 0,
    UTM_DATA: {}, GEO_DATA: {}, PAGE_START: Date.now(), Blob,
    isPlaceholder: value => !value,
    navigator: { userAgent: 'test', sendBeacon() { throw new Error('Credentialed beacon cannot use wildcard CORS'); } },
    document: { referrer: '' },
    window: { location: { pathname: '/' }, addEventListener: (event, fn) => { handlers[event] = fn; } },
    console: { log() {}, warn() {} }, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => { calls.push({ url, ...options }); return { ok: true, status: 201 }; },
  });
  vm.runInContext(analytics + exitHandler, context);
  return { calls, context, exit: () => handlers.beforeunload(), track: props => context.ivxTrack('test', props) };
}

test('page exit sends queued events with a credential-free keepalive request', async () => {
  const f = fixture(); f.track({}); f.exit();
  await Promise.resolve();
  assert.equal(f.calls.length, 1, 'Exit must actually send the queued events');
  const call = f.calls[0];
  assert.equal(call.credentials, 'omit');
  assert.equal(call.keepalive, true);
  assert.equal(call.headers.apikey, 'sb_publishable_fixture');
  assert.equal(call.headers.Authorization, undefined, 'Publishable keys are not JWTs');
  assert.ok(!call.url.includes('?apikey='));
  assert.deepEqual(JSON.parse(call.body).map(e => e.event), ['test', 'session_end']);
});

test('normal flush shares the same transport and supports legacy JWT keys', async () => {
  for (const key of ['sb_publishable_fixture', 'eyJ.fixture.signature']) {
    const f = fixture(key); f.track({}); f.context.flushAnalytics();
    await Promise.resolve();
    assert.equal(f.calls[0].credentials, 'omit');
    assert.equal(f.calls[0].headers.Authorization, key.startsWith('eyJ') ? 'Bearer ' + key : undefined);
  }
});

test('exit at the automatic flush threshold uses keepalive and does not duplicate events', async () => {
  const f = fixture(); for (let i = 0; i < 9; i++) f.track({ i });
  f.exit(); await Promise.resolve();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].keepalive, true);
  assert.equal(JSON.parse(f.calls[0].body).length, 10);
});

test('exit respects the browser keepalive byte budget, including multibyte data', async () => {
  const f = fixture(); for (let i = 0; i < 8; i++) f.track({ value: 'á'.repeat(6000) });
  f.exit(); await Promise.resolve();
  assert.equal(f.calls.length, 1);
  assert.ok(new Blob([f.calls[0].body]).size <= 48 * 1024);
  assert.ok(JSON.parse(f.calls[0].body).length > 0);
});
