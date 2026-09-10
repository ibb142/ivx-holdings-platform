import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(process.env.ANALYTICS_SOURCE_FILE || 'expo/ivxholding-landing/ivx-app.js', 'utf8');
const begin = source.indexOf('  var _analyticsQueue = [];');
const end = source.indexOf('  var _funnelOrigOpen = window.openFunnel;', begin);
assert.ok(begin >= 0 && end > begin);
function fixture(key = 'sb_publishable_isolated_analytics_fixture') {
  const requests = [], beacons = [], listeners = {};
  const window = { location: { pathname: '/qa' }, addEventListener(name, fn) { (listeners[name] ||= []).push(fn); } };
  const context = vm.createContext({
    window, Blob, Date, Math, Object, JSON,
    document: { title: 'QA', referrer: '', addEventListener() {} },
    navigator: { userAgent: 'QA', sendBeacon: (...args) => { beacons.push(args); return true; } },
    localStorage: { getItem: () => null },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {},
    console: { log() {}, warn() {} },
    SUPABASE_URL: 'https://ivx-qa-fixture.supabase.co', SUPABASE_ANON_KEY: key,
    SESSION_ID: 'qa-isolated', VISIT_COUNT: 1, FUNNEL_STEP: 0, ENGAGEMENT_SCORE: 0,
    UTM_DATA: {}, GEO_DATA: null, PAGE_START: Date.now(),
    isPlaceholder: value => !value || value.startsWith('__IVX_'),
    fetch: (url, options) => { requests.push({ url, options }); return Promise.resolve({ ok: true, status: 201 }); }
  });
  vm.runInContext(source.slice(begin, end), context);
  return { context, requests, beacons, exit: () => { for (const fn of listeners.beforeunload || []) fn(); } };
}
test('reload sends session_end through credential-free keepalive with a publishable header', () => {
  const f = fixture(); f.exit();
  assert.equal(f.beacons.length, 0, 'Credentialed beacon cannot satisfy wildcard CORS');
  assert.equal(f.requests.length, 1);
  const { url, options } = f.requests[0];
  assert.equal(new URL(url).search, '');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.keepalive, true);
  assert.equal(options.headers.apikey, 'sb_publishable_isolated_analytics_fixture');
  assert.equal(options.headers.Authorization, undefined);
  assert.ok(JSON.parse(options.body).some(row => row.event === 'session_end'));
});
test('normal analytics delivery uses the same publishable-key header contract', () => {
  const f = fixture(); f.context.flushAnalytics();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.credentials, 'omit');
  assert.equal(f.requests[0].options.headers.Authorization, undefined);
  assert.ok(JSON.parse(f.requests[0].options.body).some(row => row.event === 'page_view'));
});
test('legacy anon JWTs keep their bearer header without sending browser cookies', () => {
  const f = fixture('eyJhbGciOiJIUzI1NiJ9.legacy-anon.signature'); f.exit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.headers.Authorization, 'Bearer eyJhbGciOiJIUzI1NiJ9.legacy-anon.signature');
  assert.equal(f.requests[0].options.credentials, 'omit');
});
test('exit batch is bounded in UTF-8 bytes and does not duplicate drained events', () => {
  const f = fixture();
  for (let i = 0; i < 7; i++) f.context.ivxTrack('bounded', { detail: 'é'.repeat(7000) });
  f.exit();
  assert.equal(f.requests.length, 1);
  assert.ok(new Blob([f.requests[0].options.body]).size <= 60 * 1024);
  assert.ok(JSON.parse(f.requests[0].options.body).length > 0);
  assert.ok(f.context._analyticsQueue.length > 0, 'Unsent events remain available to the normal flush');
  assert.ok(f.context._analyticsQueue.length < 9, 'Sent events must leave the queue');
});
test('failed regular delivery preserves the batch for retry', async () => {
  const f = fixture();
  f.context.fetch = (url, options) => { f.requests.push({ url, options }); return Promise.reject(new Error('offline')); };
  f.context.flushAnalytics();
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.context._analyticsFlushing, false);
  assert.equal(f.context._analyticsQueue.length, 1);
  assert.equal(f.context._analyticsQueue[0].event, 'page_view');
});
test('unconfigured analytics performs no network write', () => {
  const f = fixture('__IVX_SUPABASE_ANON_KEY__'); f.exit();
  assert.equal(f.requests.length, 0);
  assert.equal(f.beacons.length, 0);
});
