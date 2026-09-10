import assert from 'node:assert/strict';
import pg from 'pg';
import { queryWithPostgresDeadline } from '../backend/services/ivx-postgres-deadline';
const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local test database required');
// Deliberately no startup statement_timeout: emulate a pooler ignoring it.
const pool = new pg.Pool({ connectionString, max: 1, query_timeout: 7000 });
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
  console.log(JSON.stringify({ok:true,serverStatementDeadline:true,serverLockDeadline:true,recoveredAfterCancellation:true,productionRowsTouched:0}));
} finally { await locker.end(); await pool.end(); }
