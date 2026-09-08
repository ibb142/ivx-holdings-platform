import { test } from 'bun:test';
import assert from 'node:assert/strict';

const { completeLandingInvalidation } = await import(new URL('../scripts/landing-cloudfront-invalidation.mjs', import.meta.url).href);

test('creating an invalidation never reports completion before the matching AWS operation completes', async () => {
  let clock = 0;
  let creates = 0;
  const reads: string[] = [];
  const events: string[] = [];
  const result = await completeLandingInvalidation({
    create: async () => { creates += 1; return { Id: 'synthetic-invalidation', Status: 'InProgress' }; },
    read: async (id: string) => { reads.push(id); return { Id: id, Status: reads.length === 2 ? 'Completed' : 'InProgress' }; },
    onCreated: (id: string) => events.push(id),
    now: () => clock,
    sleep: async (ms: number) => { clock += ms; },
  });
  assert.deepEqual(result, { id: 'synthetic-invalidation', status: 'Completed' });
  assert.equal(creates, 1);
  assert.deepEqual(reads, ['synthetic-invalidation', 'synthetic-invalidation']);
  assert.deepEqual(events, ['synthetic-invalidation']);
  assert.equal(clock, 6_000);
});

test('an invalidation that never completes fails at the deadline', async () => {
  let clock = 0;
  let creates = 0;
  await assert.rejects(completeLandingInvalidation({
    create: async () => { creates += 1; return { Id: 'synthetic-invalidation', Status: 'InProgress' }; },
    read: async (id: string) => ({ Id: id, Status: 'InProgress' }),
    now: () => clock,
    sleep: async (ms: number) => { clock += ms; },
    timeoutMs: 5_000,
    pollMs: 2_000,
  }), /did not complete within 5000ms/);
  assert.equal(clock, 5_000);
  assert.equal(creates, 1);
});

test('AWS create/read errors remain deployment failures', async () => {
  await assert.rejects(completeLandingInvalidation({ create: async () => { throw new Error('synthetic AWS denied'); } }), /synthetic AWS denied/);
  await assert.rejects(completeLandingInvalidation({
    create: async () => ({ Id: 'synthetic-invalidation', Status: 'InProgress' }),
    read: async () => { throw new Error('synthetic read denied'); },
    sleep: async () => {},
  }), /synthetic read denied/);
});

test('missing and mismatched operation identities never produce a success receipt', async () => {
  await assert.rejects(completeLandingInvalidation({ create: async () => ({ Status: 'Completed' }) }), /no invalidation ID/);
  await assert.rejects(completeLandingInvalidation({
    create: async () => ({ Id: 'synthetic-invalidation', Status: 'InProgress' }),
    read: async () => ({ Id: 'other-invalidation', Status: 'Completed' }),
    sleep: async () => {},
  }), /identity mismatch/);
});

test('a completed AWS operation needs no extra poll and invalid timing cannot create one', async () => {
  assert.deepEqual(await completeLandingInvalidation({ create: async () => ({ Id: 'synthetic-invalidation', Status: 'Completed' }) }), { id: 'synthetic-invalidation', status: 'Completed' });
  for (const timeoutMs of [0, -1, Infinity, NaN]) {
    await assert.rejects(completeLandingInvalidation({ create: async () => assert.fail('must not create an invalidation'), timeoutMs }), /finite positive/);
  }
});
