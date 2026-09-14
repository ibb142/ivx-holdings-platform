import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelObsoleteApiBuild } from './cancel-obsolete-api-build.mjs';
const expectedMain = 'a'.repeat(40), deployId = 'dep-dak532dckfvc73ab4gd0';
function fixture(status = 'build_in_progress', successor = true, lostResponse = false, staleReads = 0) {
  const calls = []; let cancelled = false;
  return { calls, input: { token: 'fixture-key', expectedMain, now: () => 1_000_000, wait: async () => {},
    fetcher: async (url, options) => {
      calls.push(options.method);
      if (options.method === 'POST') { cancelled = true; if (lostResponse) throw new Error('connection reset'); return Response.json({}); }
      if (url.endsWith('/cancel')) throw new Error('unexpected cancel read');
      if (url.includes('?limit=')) return Response.json(successor ? [{ deploy: { id: 'dep-successor', status: 'queued', commit: { id: expectedMain } } }] : []);
      if (url.endsWith(deployId)) return Response.json({ id: deployId, commit: { id: 'b8778a5052ab5dab1502c5b22611d663e52e2a38' }, status: cancelled && staleReads-- <= 0 ? 'canceled' : status, startedAt: new Date(0).toISOString() });
      return Response.json({ repo: 'https://github.com/ibb142/ivx-holdings-platform', branch: 'main' });
    } } };
}
test('cancels only one obsolete build with a queued exact-source successor', async () => {
  const f = fixture(); const result = await cancelObsoleteApiBuild(f.input);
  assert.equal(result.changed, true); assert.equal(result.deploymentCreated, false);
  assert.equal(f.calls.filter(x => x === 'POST').length, 1);
});
test('never cancels the live or deploying release', async () => {
  for (const status of ['live', 'update_in_progress']) { const f = fixture(status);
    await assert.rejects(cancelObsoleteApiBuild(f.input)); assert.equal(f.calls.includes('POST'), false); }
});
test('refuses cancellation without a queued successor', async () => {
  const f = fixture('build_in_progress', false); await assert.rejects(cancelObsoleteApiBuild(f.input));
  assert.equal(f.calls.includes('POST'), false);
});
test('reconciles a lost response without replaying the cancellation', async () => {
  const f = fixture('build_in_progress', true, true); assert.equal((await cancelObsoleteApiBuild(f.input)).changed, true);
  assert.equal(f.calls.filter(x => x === 'POST').length, 1);
});
test('waits for asynchronous cancellation using only reads', async () => {
  const f = fixture('build_in_progress', true, false, 2);
  assert.equal((await cancelObsoleteApiBuild(f.input)).status, 'canceled');
  assert.equal(f.calls.filter(x => x === 'POST').length, 1);
});
test('an already cancelled build is read idempotently', async () => {
  const f = fixture('canceled');
  assert.equal((await cancelObsoleteApiBuild(f.input)).changed, false);
  assert.equal(f.calls.includes('POST'), false);
});
