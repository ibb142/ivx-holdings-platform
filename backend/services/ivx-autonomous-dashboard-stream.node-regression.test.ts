import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardStreamFixture } from './test-support/dashboard-stream-fixture';

test('auth precedes a dashboard snapshot and ranges preserve increasing sequence numbers', async () => {
  const f = await dashboardStreamFixture();
  try {
    const snapshot = f.next('snapshot');
    f.receive({ type: 'auth', token: 'owner-fixture', range: 'today' });
    const first = await snapshot;
    assert.deepEqual(f.sent.map(message => message.type), ['hello', 'auth_ok', 'snapshot']);
    assert.equal(f.authCalls.length, 1);
    assert.equal(f.authCalls[0].headers.get('Authorization'), 'Bearer owner-fixture');
    assert.deepEqual(first.dashboard, { jobs: [{ id: 'fixture-job', state: 'RUNNING' }] });
    assert.equal(first.sequence, 1);
    assert.equal(first.intervalMs, 1000);
    assert.ok(Number.isFinite(Date.parse(first.serverTime)));
    const changed = f.next('snapshot');
    f.receive({ type: 'set_range', range: '7d' });
    assert.equal((await changed).sequence, 2);
    assert.equal(new URL(f.snapshotCalls[1].url).searchParams.get('range'), '7d');
  } finally { f.close(); }
});

test('an unauthenticated request never reaches the dashboard provider', async () => {
  const f = await dashboardStreamFixture();
  try {
    f.receive({ type: 'set_range', range: 'today' });
    assert.equal(f.closeCode, 4401);
    assert.equal(f.snapshotCalls.length, 0);
    assert.equal(f.sent.some(message => message.type === 'snapshot'), false);
  } finally { f.close(); }
});

test('closing during an in-flight snapshot prevents late data and polling', async () => {
  let resolveSnapshot!: (response: Response) => void;
  const f = await dashboardStreamFixture({ snapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }) });
  try {
    const auth = f.next('auth_ok');
    f.receive({ type: 'auth', token: 'owner-fixture' });
    await auth;
    f.close();
    resolveSnapshot(Response.json({ ok: true, dashboard: { late: true } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.sent.some(message => message.type === 'snapshot'), false);
    assert.equal(f.intervalCount(), 0);
  } finally { f.close(); }
});
