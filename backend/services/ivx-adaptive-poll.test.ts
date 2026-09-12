import { expect, test } from 'bun:test';
import { PollBackoff, startAdaptivePoll } from './ivx-adaptive-poll';

test('idle and error delay grows exponentially, caps, adds jitter and resets on admission', () => {
  let now = 0;
  const backoff = new PollBackoff(1000, 10_000, () => now, () => 0.5);
  for (const expected of [1100, 2200, 4400, 8800, 10000, 10000]) {
    backoff.defer(); expect(backoff.remainingMs()).toBe(expected); now += expected;
  }
  backoff.reset(); expect(backoff.remainingMs()).toBe(0);
  backoff.defer(); expect(backoff.remainingMs()).toBe(1100);
});

test('a stalled recovery never overlaps and shutdown cannot schedule another tick', async () => {
  let calls = 0, finish!: (productive: boolean) => void;
  const stop = startAdaptivePoll(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, 5, 20, true);
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(calls).toBe(1);
  stop(); finish(false);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(calls).toBe(1);
});
