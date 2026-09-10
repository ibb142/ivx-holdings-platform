import { expect, test } from 'bun:test';
import { RefillBackoff } from './ivx-refill-backoff';

test('five-second scheduler cannot hammer a failed database; recovery resumes automatically', async () => {
  let now = 0, calls = 0, available = false;
  const backoff = new RefillBackoff(() => now, () => 0);
  const operation = async () => { calls++; if (!available) throw new Error('Query read timeout'); };
  await expect(backoff.run(operation)).rejects.toThrow('Query read timeout');
  now = 5000; await backoff.run(operation); expect(calls).toBe(1);
  now = 10000; await expect(backoff.run(operation)).rejects.toThrow();
  now = 15000; await backoff.run(operation); expect(calls).toBe(2);
  available = true;
  now = 30000; await backoff.run(operation); expect(calls).toBe(3);
  expect(backoff.status()).toEqual({ consecutiveFailures: 0, nextAttemptAt: null, remainingMs: 0 });
  now = 35000; await backoff.run(operation); expect(calls).toBe(4);
});

test('persistent outage has bounded retry delay with replica jitter', async () => {
  let now = 0;
  const backoff = new RefillBackoff(() => now, () => 0.5);
  for (const delay of [12500,22500,42500,62500,62500]) {
    await expect(backoff.run(async () => { throw new Error('connection timeout'); })).rejects.toThrow();
    expect(backoff.status().remainingMs).toBe(delay);
    now += delay;
  }
});
