import assert from 'node:assert/strict';
import pg from 'pg';
import { observePostgresPoolErrors, queryWithPostgresDeadline } from '../backend/services/ivx-postgres-deadline';
const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local test database required');
// Deliberately no startup statement_timeout: emulate a pooler ignoring it.
const pool = new pg.Pool({ connectionString, max: 1, query_timeout: 7000, application_name: 'ivx_deadline_fixture' });
observePostgresPoolErrors(pool, 'deadline-fixture');
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
  const disconnected = assert.rejects(queryWithPostgresDeadline(pool, 'select pg_sleep(20) /* ivx_disconnect_fixture */', []),
    (error: any) => error.code === '57P01' || /connection.*terminated|terminating connection/i.test(error.message));
  let victim = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const active = await locker.query("select pid from pg_stat_activity where application_name='ivx_deadline_fixture' and state='active' and query like '%ivx_disconnect_fixture%'");
    victim = active.rows[0]?.pid ?? 0;
    if (victim) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert(victim, 'The isolated fixture query must be active before terminating it');
  assert.equal((await locker.query('select pg_terminate_backend($1)', [victim])).rows[0].pg_terminate_backend, true);
  await disconnected;
  const recovered = await queryWithPostgresDeadline(pool, 'select pg_backend_pid() as pid, 112 as lanes', []);
  assert.equal(recovered.rows[0].lanes, 112);
  assert.notEqual(recovered.rows[0].pid, victim);
  // No test error listener: the production pool observer must handle this
  // idle socket failure without an uncaught EventEmitter error killing Node.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const removed = new Promise<void>(resolve => pool.once('remove', () => resolve()));
  await locker.query('select pg_terminate_backend($1)', [recovered.rows[0].pid]);
  try {
    await Promise.race([removed, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Failed idle connection was not removed')), 2_000);
    })]);
  } finally { clearTimeout(timeout); }
  const afterIdle = await queryWithPostgresDeadline(pool, 'select 112 as lanes', []);
  assert.equal(afterIdle.rows[0].lanes, 112);
  console.log(JSON.stringify({ok:true,runtime:process.release.name,nodeVersion:process.version,
    serverStatementDeadline:true,serverLockDeadline:true,recoveredAfterCancellation:true,
    activeDisconnectRejected:true,idleDisconnectHandled:true,processSurvived:true,reconnected:true,productionRowsTouched:0}));
} finally { await locker.end(); await pool.end(); }
