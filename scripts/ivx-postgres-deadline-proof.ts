import assert from 'node:assert/strict';
import pg from 'pg';
import { queryWithPostgresDeadline } from '../backend/services/ivx-postgres-deadline';
const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local test database required');
// Deliberately no startup statement_timeout: emulate a pooler ignoring it.
const pool = new pg.Pool({ connectionString, max: 1, query_timeout: 7000, application_name: 'ivx_deadline_disconnect_fixture' });
const locker = new pg.Client({ connectionString });
await locker.connect();
try {
  let started = Date.now();
  await assert.rejects(queryWithPostgresDeadline(pool, 'select pg_sleep(20)', []),
    (error: unknown) => (error as {code:string}).code === '57014');
  assert(Date.now()-started < 6500, 'PostgreSQL must cancel before the client timeout');
  await locker.query('select pg_advisory_lock(9811595)');
  started = Date.now();
  await assert.rejects(queryWithPostgresDeadline(pool, 'select pg_advisory_xact_lock(9811595)', []),
    (error: unknown) => (error as {code:string}).code === '55P03');
  assert(Date.now()-started < 4000, 'Blocked RPC must release transaction before the statement deadline');
  await locker.query('select pg_advisory_unlock(9811595)');
  const next = await queryWithPostgresDeadline(pool, 'select 112 as lanes', []);
  assert.equal(next.rows[0].lanes, 112, 'Pool must recover after server cancellation');
  // A checked-out pg Client emits an error independently of query rejection.
  // Terminate a real local backend while the helper owns it: the process must
  // survive, the operation must fail, and the next operation must reconnect.
  const interrupted = assert.rejects(queryWithPostgresDeadline(pool, 'select pg_sleep(20)', []),
    (error: unknown) => ['57P01', 'ECONNRESET'].includes(String((error as {code?:string}).code))
      || /terminated|closed|connection/i.test(String(error)));
  let targetPid: number | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    targetPid = (await locker.query("select pid from pg_stat_activity where application_name='ivx_deadline_disconnect_fixture' and wait_event='PgSleep'")).rows[0]?.pid;
    if (targetPid) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert(targetPid, 'the fixture must find its own active query before terminating it');
  await locker.query('select pg_terminate_backend($1)', [targetPid]);
  await interrupted;
  assert.equal((await queryWithPostgresDeadline(pool, 'select 112 as lanes', [])).rows[0].lanes, 112);
  console.log(JSON.stringify({ ok: true, activeConnectionLossHandled: 'PASS',
    processSurvived: true, reconnectedAfterConnectionLoss: true, productionRowsTouched: 0 }));
  console.log(JSON.stringify({ok:true,serverStatementDeadline:true,serverLockDeadline:true,recoveredAfterCancellation:true,productionRowsTouched:0}));
} finally { await locker.end(); await pool.end(); }
