import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(process.env.LANDING_BOOTSTRAP_HTML || 'expo/ivxholding-landing/index.html', 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("var v = document.getElementById('homeFeedReel')"));
assert.ok(source, 'The shipped homepage must initialize its project reel');

const reel = { video_url: 'https://ivxholding.com/videos/example.mp4', webm_url: '/media/reels/example.webm', thumbnail_url: '/same-reel.jpg' };
function fixture(respond, now = Date.now, manualTimers = false) {
  const elements = [], deadlines = [];
  const timers = new Map(); let timerId = 0;
  const window = {};
  function element(tagName) {
    const e = { tagName, children: [], listeners: {}, hidden: false, style: {}, attributes: {},
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
      emit(name) { for (const fn of this.listeners[name] || []) fn(); },
      appendChild(child) { child.parentNode = this; this.children.push(child); },
      remove() { this.parentNode.children = this.parentNode.children.filter(e => e !== this); },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      querySelectorAll(tag) { return this.children.filter(e => e.tagName === tag); },
    };
    elements.push(e); return e;
  }
  const card = element('div'), video = element('video');
  card.appendChild(video);
  let calls = 0, loads = 0;
  video.load = () => loads++;
  video.play = () => Promise.resolve();
  vm.runInNewContext(source, {
    document: { getElementById: () => video, createElement: element },
    URL, AbortController, window, Date: { now, parse: Date.parse },
    fetch: async (_url, options) => { assert.ok(options?.signal || process.env.LANDING_BOOTSTRAP_HTML, 'Fetch must have a deadline'); return respond(++calls); },
    // Advance backoff without waiting; network-deadline expiry is covered by
    // the aborted-request case. Cancelled deadline callbacks must not execute.
    setTimeout: (fn, ms) => {
      if (ms >= 4000) deadlines.push(ms);
      const id = ++timerId; timers.set(id, { fn, at: now() + ms });
      if (!manualTimers && ms < 4000) queueMicrotask(() => { if (timers.delete(id)) fn(); });
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  return { video, window, deadlines, timers, flushTimers() {
    for (const [id, timer] of timers) if (timer.at <= now()) { timers.delete(id); timer.fn(); }
  }, get calls() { return calls; }, get loads() { return loads; },
    button: () => elements.find(e => e.tagName === 'button') };
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
async function settle() { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)); }

test('homepage reel waits for Retry-After without attaching the unavailable response', async () => {
  let clock = 1000;
  const f = fixture(n => n === 1 ? { ...json(200, { videos: [], degraded: true }), headers: { get: () => '3' } }
    : json(200, { videos: [reel] }), () => clock, true);
  await settle(); assert.equal(f.calls, 1); assert.equal(f.loads, 0);
  clock += 2999; f.flushTimers(); await settle(); assert.equal(f.calls, 1);
  clock += 1; f.flushTimers(); await settle();
  assert.equal(f.calls, 2); assert.equal(f.loads, 1); assert.equal(f.timers.size, 0);
});

test('homepage reel cannot wait beyond its operation budget or retry a denied request', async () => {
  for (const [status, delay] of [[503, '60'], [401, '3'], [403, '3']]) {
    const f = fixture(() => ({ ...json(status, {}), headers: { get: () => delay } }), () => 1000, true);
    await settle();
    assert.equal(f.calls, 1); assert.equal(f.loads, 0);
    assert.equal(f.timers.size, 0); assert.equal(f.button()?.hidden, false);
  }
});

test('a temporary feed failure recovers and keeps both formats attached to the same reel', async () => {
  const f = fixture(n => n === 1 ? json(503, {}) : json(200, { videos: [reel] }));
  await settle();
  assert.equal(f.calls, 2);
  assert.equal(f.loads, 1);
  assert.deepEqual(f.video.children.map(s => s.src), ['https://api.ivxholding.com/media/reels/example.webm', reel.video_url]);
  assert.equal(f.video.attributes.poster, reel.thumbnail_url);
});

test('persistent failure stops after two requests and a user can retry', async () => {
  let restored = false;
  const f = fixture(() => restored ? json(200, { videos: [reel] }) : json(500, {}));
  await settle();
  assert.equal(f.calls, 2);
  assert.equal(f.loads, 0);
  assert.equal(f.button()?.hidden, false);
  restored = true;
  f.button().emit('click');
  f.button().emit('click');
  await settle();
  assert.equal(f.calls, 3, 'A double click must not issue duplicate requests');
  assert.equal(f.loads, 1);
  assert.equal(f.button().hidden, true);
  assert.equal(f.button().style.display, 'none');
});

test('degraded HTTP 200 retries before attaching or sharing a reel', async () => {
  for (const flags of [{ degraded: true }, { data_available: false }, { code: 'PUBLIC_DATA_UNAVAILABLE' }]) {
    const f = fixture(n => n === 1 ? json(200, { videos: [], ...flags }) : json(200, { videos: [reel] }));
    await settle();
    assert.equal(f.calls, 2);
    assert.equal(f.loads, 1);
    assert.equal(f.video.children[1].src, reel.video_url);
  }
  const unavailable = { videos: [reel], degraded: true, personalized: false,
    feed_type: 'unified', ordering: 'canonical-unified-v2' };
  const f = fixture(() => json(200, unavailable)); await settle();
  assert.equal(f.calls, 2);
  assert.equal(f.loads, 0);
  assert.equal(f.window.__ivxPublicReels, undefined);
  assert.equal(f.button()?.hidden, false);
});

test('aborted requests get bounded recovery instead of an infinite loop', async () => {
  const f = fixture(() => { throw new DOMException('Timed out', 'AbortError'); });
  await settle();
  assert.equal(f.calls, 2);
  assert.equal(f.button()?.hidden, false);
});

test('a permanent client error or empty feed offers manual recovery', async () => {
  for (const response of [json(404, {}), json(200, { videos: [] })]) {
    const f = fixture(() => response);
    await settle();
    assert.equal(f.calls, 1);
    assert.equal(f.loads, 0);
    assert.equal(f.button()?.hidden, false);
  }
});

test('exhausting this reel formats offers retry without borrowing another reel', async () => {
  const f = fixture(() => json(200, { videos: [reel, { video_url: 'https://ivxholding.com/another-property.mp4' }] }));
  await settle();
  f.video.children[0].emit('error');
  assert.equal(f.button(), undefined);
  f.video.children[1].emit('error');
  assert.equal(f.button()?.hidden, false);
  assert.equal(f.calls, 1);
  assert.equal(f.video.children[1].src, reel.video_url);
});

test('a successful anonymous canonical catalog is retained as a separate recent page snapshot', async () => {
  const data = { videos: [{ ...reel, id: 'same-reel', video_type: 'reel' }],
    total: 1, next_cursor: null, personalized: false, channel: null,
    ordering: 'canonical-unified-v2', feed_type: 'unified' };
  const f = fixture(() => json(200, data)); await settle();
  assert.equal(f.window.__ivxPublicReels?.data.videos[0].video_url, reel.video_url);
  assert.ok(Date.now() - f.window.__ivxPublicReels.at < 1000);
  assert.notEqual(f.window.__ivxPublicReels.data, data);
});

test('a viewer-specific response is never published as a shared public snapshot', async () => {
  const f = fixture(() => json(200, { videos: [reel], personalized: true })); await settle();
  assert.equal(f.loads, 1);
  assert.equal(f.window.__ivxPublicReels, undefined);
});


test('slow reads share one 18-second budget across retry attempts', async () => {
  let clock = 0;
  const f = fixture(n => {
    if (n === 1) { clock = 14000; return json(503, {}); }
    return json(200, { videos: [reel] });
  }, () => clock);
  await settle();
  assert.equal(f.calls, 2);
  assert.equal(f.loads, 1);
  assert.deepEqual(f.deadlines, [18000, 4000]);
});

test('an exhausted request budget cannot start a new automatic request', async () => {
  let clock = 0;
  const f = fixture(() => { clock = 18000; return json(503, {}); }, () => clock);
  await settle();
  assert.equal(f.calls, 1);
  assert.equal(f.loads, 0);
  assert.equal(f.button()?.hidden, false);
});
