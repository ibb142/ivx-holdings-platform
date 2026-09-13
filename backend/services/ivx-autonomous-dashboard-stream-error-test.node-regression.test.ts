import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardStreamFixture } from './test-support/dashboard-stream-fixture';

test('a provider exception produces one error log and an awaited stream_error, then recovers', async () => {
  let failing = true;
  const f = await dashboardStreamFixture({ snapshot: async () => {
    if (failing) throw new Error('fixture snapshot failure');
    return Response.json({ ok: true, dashboard: { recovered: true } });
  } });
  try {
    const error = f.next('stream_error');
    f.receive({ type: 'auth', token: 'owner-fixture' });
    assert.equal((await error).error, 'fixture snapshot failure');
    assert.equal(f.snapshotCalls.length, 1);
    assert.deepEqual(f.errors, [['Push snapshot error:', 'fixture snapshot failure']]);
    assert.equal(f.sent.some(message => message.type === 'snapshot'), false);
    failing = false;
    const snapshot = f.next('snapshot');
    f.receive({ type: 'set_range', range: 'today' });
    assert.deepEqual((await snapshot).dashboard, { recovered: true });
  } finally { f.close(); }
});

test('invalid JSON is a protocol error, not a fabricated snapshot error', async () => {
  const f = await dashboardStreamFixture();
  try {
    const error = f.next('protocol_error');
    f.ws.emit('message', Buffer.from('invalid_message'));
    assert.equal((await error).error, 'invalid json');
    assert.equal(f.authCalls.length, 0);
    assert.equal(f.snapshotCalls.length, 0);
    assert.equal(f.errors.length, 0);
  } finally { f.close(); }
});

test('expired owner authorization closes the stream without publishing data', async () => {
  const f = await dashboardStreamFixture({ snapshot: async () => Response.json({ error: 'expired' }, { status: 403 }) });
  try {
    const error = f.next('auth_error');
    f.receive({ type: 'auth', token: 'owner-fixture' });
    assert.equal((await error).status, 403);
    assert.equal(f.closeCode, 4401);
    assert.equal(f.sent.some(message => message.type === 'snapshot'), false);
    assert.equal(f.intervalCount(), 0);
  } finally { f.close(); }
});
