import { expect, test } from 'bun:test';
import { createRefillWakeup } from './ivx-refill-wakeup';
function fixture() {
  let now = 0, calls = 0, id = 0;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const wakeup = createRefillWakeup({ now: () => now,
    schedule: (callback, delay) => { timers.set(++id, { callback, due: now + delay }); return id; },
    cancel: timer => { timers.delete(timer); }, run: () => { calls++; } });
  return { wakeup, timers, calls: () => calls, setNow: (value: number) => { now = value; } };
}
test('112 lane completions schedule one fleet refill', () => {
  const f = fixture();
  for (let i = 0; i < 112; i++) f.wakeup.request(250);
  expect(f.timers.size).toBe(1);
  const callback = [...f.timers.values()][0].callback;
  callback(); callback();
  expect(f.calls()).toBe(1);
});
test('an earlier completion advances the deadline; later work cannot postpone it', () => {
  const f = fixture();
  f.wakeup.request(30000);
  const cancelled = [...f.timers.values()][0].callback;
  f.setNow(100); f.wakeup.request(250); f.wakeup.request(15000);
  expect(f.timers.size).toBe(1);
  expect([...f.timers.values()][0].due).toBe(350);
  cancelled(); expect(f.calls()).toBe(0);
  [...f.timers.values()][0].callback(); expect(f.calls()).toBe(1);
});
test('stop invalidates an already queued callback and allows a later restart', () => {
  const f = fixture(); f.wakeup.request(250);
  const callback = [...f.timers.values()][0].callback;
  f.wakeup.clear(); callback();
  expect(f.calls()).toBe(0); expect(f.timers.size).toBe(0);
  f.wakeup.request(250); [...f.timers.values()][0].callback();
  expect(f.calls()).toBe(1);
});
