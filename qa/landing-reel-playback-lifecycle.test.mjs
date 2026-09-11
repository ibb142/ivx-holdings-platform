import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Execute the actual production functions with deterministic media events.
// These tests cover lifecycle races; the browser gate separately decodes media.
const source = readFileSync(process.env.IVX_REELS_SOURCE || new URL('../expo/ivxholding-landing/ivx-reels.js', import.meta.url), 'utf8');
function section(start, end, optional = false) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (optional && from < 0) return '';
  assert.ok(from >= 0 && to > from, `Missing production section: ${start}`);
  return source.slice(from, to);
}

function fixture() {
  const listeners = new Map(), videos = [], calls = { loads: 0, profiles: 0 };
  const classes = new Set();
  const document = {
    hidden: false, documentElement: { style: { overflow: 'clip' } }, body: { style: { overflow: 'auto' } },
    querySelectorAll: () => videos,
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, target, extra = {}) { listeners.get(type)?.({ target, ...extra }); },
  };
  function control(modal) {
    return { modal, isConnected: true, tabIndex: 0, disabled: false,
      getClientRects: () => [{}], focus() { document.activeElement = this; } };
  }
  const launcher = control(false), close = control(true), last = control(true);
  document.activeElement = launcher;
  const root = {
    classList: { contains: (x) => classes.has(x), add: (x) => classes.add(x), remove: (x) => classes.delete(x) },
    contains: (x) => !!x?.modal, querySelectorAll: () => [close, last],
  };
  const state = { activeSlide: null, activeSince: 0, muted: false, storyMode: false };
  const context = vm.createContext({
    document, root, state, el: () => close,
    window: { innerHeight: 800, innerWidth: 400, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) },
    setTimeout: () => 1, clearTimeout() {},
    feedEl: { children: [] }, sheetEl: { classList: { remove() {} } },
    track(ev) { if (ev.type === 'profile') calls.profiles++; }, flushEvents() {},
    loadStoriesAndLive() {}, loadMore() { calls.loads++; }, resetFeed() {}, preloadUpcoming() {},
  });
  vm.runInContext(
    section('  /* ---------- page playback ownership ---------- */', '  /* ---------- tabs ---------- */', true)
    + section('  function activateSlide(slide)', '  /* ---------- upload')
    + section('  function openReels()', "  launch.addEventListener('click'")
    + section("  document.addEventListener('visibilitychange'", "  window.addEventListener('pagehide'")
    + section("  document.addEventListener('keydown'", '  /* deep link:'), context);
  function video(modal = false) {
    const v = { modal, tagName: 'VIDEO', paused: true, isConnected: true, muted: false, plays: 0,
      bounds: { top: 50, left: 0, right: 300, bottom: 250, width: 300, height: 200 },
      getBoundingClientRect() { return this.bounds; },
      pause() { this.paused = true; },
      play() { this.plays++; this.paused = false; document.emit('play', this); return this.pending || Promise.resolve(); },
    };
    videos.push(v);
    return v;
  }
  const slide = (v) => ({ modal: true, __vid: v, __video: { id: 'local-lifecycle-reel' } });
  return { context, document, root, state, calls, video, slide, launcher, close, last };
}

test('opening reels pauses the background and late background autoplay stays paused', async () => {
  const f = fixture(), background = f.video();
  await background.play();
  f.context.openReels();
  assert.equal(background.paused, true);
  await background.play();
  assert.equal(background.paused, true);
  const reel = f.video(true);
  f.context.activateSlide(f.slide(reel));
  assert.equal(reel.paused, false);
  assert.equal(background.paused, true);
});

test('play events give playback to only one video on the page', async () => {
  const f = fixture(), a = f.video(), b = f.video();
  await a.play(); await b.play();
  assert.equal(a.paused, true);
  assert.equal(b.paused, false);
});

test('double open preserves launcher and original overflow; close restores visible background', async () => {
  const f = fixture(), background = f.video();
  await background.play();
  f.context.openReels(); f.context.openReels();
  assert.equal(f.calls.profiles, 1);
  assert.equal(f.document.activeElement, f.close);
  f.context.closeReels();
  assert.equal(f.document.documentElement.style.overflow, 'clip');
  assert.equal(f.document.body.style.overflow, 'auto');
  assert.equal(f.document.activeElement, f.launcher);
  assert.equal(background.paused, false);
});

test('close never resumes background that is now offscreen or was manually paused', async () => {
  const f = fixture(), background = f.video();
  await background.play();
  f.context.openReels();
  background.bounds.top = 1200;
  f.context.closeReels();
  assert.equal(background.paused, true);
  background.bounds.top = 50;
  f.context.openReels(); f.context.closeReels();
  assert.equal(background.paused, true);
});

test('a closed modal rejects observer activation and late native play events', async () => {
  const f = fixture(), reel = f.video(true);
  f.context.activateSlide(f.slide(reel));
  assert.equal(reel.plays, 0);
  await reel.play();
  assert.equal(reel.paused, true);
});

test('rejected play promise cannot restart a reel after close', async () => {
  const f = fixture(), reel = f.video(true);
  let reject;
  reel.pending = new Promise((_, r) => { reject = r; });
  f.context.openReels(); f.context.activateSlide(f.slide(reel));
  f.context.closeReels();
  reject(new Error('interrupted playback'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(reel.plays, 1);
  assert.equal(reel.paused, true);
});

test('rejected play from an old slide cannot steal playback from the next slide', async () => {
  const f = fixture(), a = f.video(true), b = f.video(true);
  let reject;
  a.pending = new Promise((_, r) => { reject = r; });
  f.context.openReels(); f.context.activateSlide(f.slide(a)); f.context.activateSlide(f.slide(b));
  reject(new Error('old playback interrupted'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(a.plays, 1);
  assert.equal(a.paused, true);
  assert.equal(b.paused, false);
});

test('hidden document pauses playback; return resumes only a previously playing slide', () => {
  const f = fixture(), reel = f.video(true), slide = f.slide(reel);
  f.context.openReels(); f.context.activateSlide(slide);
  f.document.hidden = true; f.document.emit('visibilitychange');
  assert.equal(reel.paused, true);
  f.document.hidden = false; f.document.emit('visibilitychange');
  assert.equal(reel.paused, false);
  reel.pause();
  f.document.hidden = true; f.document.emit('visibilitychange');
  f.document.hidden = false; f.document.emit('visibilitychange');
  assert.equal(reel.paused, true);
});

test('tab remains within the modal and Escape restores the launcher', () => {
  const f = fixture(); let prevented = 0;
  f.context.openReels();
  f.document.emit('keydown', f.close, { key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(f.document.activeElement, f.last);
  f.document.emit('keydown', f.last, { key: 'Tab', shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(f.document.activeElement, f.close);
  assert.equal(prevented, 2);
  f.document.emit('keydown', f.close, { key: 'Escape' });
  assert.equal(f.root.classList.contains('open'), false);
  assert.equal(f.document.activeElement, f.launcher);
});
