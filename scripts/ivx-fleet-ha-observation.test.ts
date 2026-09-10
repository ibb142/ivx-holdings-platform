import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProbeHttpError, readRecoveringSharedObservation } from './ivx-fleet-ha-observation';

test('an unavailable observation cannot pass and the next loop can observe recovery', async () => {
  let calls = 0;
  const evidence = { ready: true, instanceIds: ['new-a', 'new-b'] };
  const read = async () => { if (++calls === 1) throw new ProbeHttpError(503, '/ha'); return evidence; };
  assert.equal(await readRecoveringSharedObservation(read), null);
  assert.equal(calls, 1, 'the read must not retry inside the health-probe loop');
  assert.equal(await readRecoveringSharedObservation(read), evidence);
});

test('persistent outages remain unavailable on every attempt', async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(await readRecoveringSharedObservation(async () => { throw new ProbeHttpError(status, '/ha'); }), null);
  }
  for (const name of ['TimeoutError', 'AbortError']) {
    assert.equal(await readRecoveringSharedObservation(async () => { throw new DOMException('deadline', name); }), null);
  }
});

test('denied credentials and invalid evidence fail immediately', async () => {
  for (const error of [new ProbeHttpError(401, '/ha'), new ProbeHttpError(403, '/ha'),
    new SyntaxError('malformed JSON'), new Error('wrong SHA'), new Error('Stale HA observation')]) {
    await assert.rejects(readRecoveringSharedObservation(async () => { throw error; }), received => received === error);
  }
});
