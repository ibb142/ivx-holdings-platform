import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { AUDIT_SQL, connectionConfig, interpretSnapshot, main, runConnectionAudit } from './audit-connection-leakage.mjs';

const env = { DATABASE_URL: 'postgres://audit:fixture-password@localhost/postgres' };
const snapshot = () => ({ captured_at: '2026-09-13T20:08:14Z', database_name: 'postgres', audit_pid: 99,
  max_connections: 60, superuser_reserved_connections: 3, reserved_connections: 0,
  client_connections: 41, database_client_connections: 41, idle_clients: 37,
  active_clients: 4, idle_in_transaction_clients: 0, lock_waiting_clients: 0,
  hidden_state_clients: 0, other_backends: 10, unclassified_backends: 0,
  application_groups: [], sessions_to_review: [] });

function fixture({ failAt, closeError, eventAt, rows = [snapshot()] } = {}) {
  const calls = [];
  class Client extends EventEmitter {
    async connect() { calls.push('connect'); if (failAt === 'connect') throw dbError(); }
    async query(sql) {
      const stage = sql === AUDIT_SQL ? 'capture' : sql === 'COMMIT' ? 'commit' : 'setup';
      calls.push(stage);
      if (eventAt === stage) this.emit('error', dbError());
      if (failAt === stage) throw dbError();
      return { rows: stage === 'capture' ? rows : [] };
    }
    async end() { calls.push('end'); if (closeError) throw closeError; }
  }
  return { Client, calls };
}
function dbError() { return Object.assign(new Error('private SQL and fixture-password'), { code: '57014' }); }

test('client capacity excludes internal backends and accounts for reserved slots', () => {
  const report = interpretSnapshot(snapshot());
  assert.equal(report.client_capacity_percent, 68.3);
  assert.equal(report.nominal_general_connection_slots, 57);
  assert.equal(report.nominal_general_slots_remaining, 16);
  assert.equal(report.audit_status, 'complete');
  assert.deepEqual(report.findings, []);
});

test('many idle connections are reported without diagnosing a leak', () => {
  const row = snapshot();
  row.application_groups = [{ application_name: 'api', connection_count: 30, idle_count: 30 }];
  const report = interpretSnapshot(row);
  assert.equal(report.leak_status, 'not_proven_by_snapshot');
  assert.deepEqual(report.findings, []);
});

test('pressure threshold scales with measured capacity, not a fixed 45 or 60 slots', () => {
  const large = { ...snapshot(), max_connections: 300, client_connections: 100 };
  assert.deepEqual(interpretSnapshot(large).findings, []);
  const small = { ...snapshot(), max_connections: 30, client_connections: 25 };
  assert.ok(interpretSnapshot(small).findings.includes('GENERAL_CONNECTION_CAPACITY_PRESSURE'));
});

test('limited statistics visibility produces partial output and exit code 2', async () => {
  const partial = { ...snapshot(), hidden_state_clients: 3 };
  const f = fixture({ rows: [partial] });
  const output = [];
  assert.equal(await main({ args: [], env, ClientClass: f.Client, emit: s => output.push(JSON.parse(s)) }), 2);
  assert.equal(output[0].audit_status, 'partial');
  assert.ok(output[0].findings.includes('ACTIVITY_VISIBILITY_INCOMPLETE'));
});

test('transaction durations preserve days and hours; long age alone is not a lock diagnosis', () => {
  const row = snapshot();
  row.sessions_to_review = [{ pid: 12, transaction_age_seconds: 90_061, wait_event_type: 'Client', blocking_pids: [] }];
  const report = interpretSnapshot(row);
  assert.equal(report.sessions_to_review[0].transaction_age_seconds, 90_061);
  assert.ok(!report.findings.includes('LOCK_WAITS_OBSERVED'));
  assert.ok(report.findings.includes('LONG_TRANSACTIONS_OR_LOCK_WAITS_REQUIRE_REVIEW'));
});

test('capped details disclose truncation instead of presenting a complete list', () => {
  const row = snapshot();
  row.application_groups = Array.from({ length: 51 }, (_, pid) => ({ pid }));
  row.sessions_to_review = Array.from({ length: 51 }, (_, pid) => ({ pid }));
  const report = interpretSnapshot(row);
  assert.equal(report.groups_truncated, true);
  assert.equal(report.sessions_truncated, true);
  assert.equal(report.sessions_to_review.length, 50);
});

test('connection, query and commit errors close the client, fail, and suppress sensitive error text', async () => {
  for (const failAt of ['connect', 'capture', 'commit']) {
    const f = fixture({ failAt });
    const out = [], errors = [];
    assert.equal(await main({ args: [], env, ClientClass: f.Client, emit: s => out.push(s), emitError: s => errors.push(s) }), 1);
    assert.equal(f.calls.at(-1), 'end');
    assert.deepEqual(out, []);
    assert.equal(JSON.parse(errors[0]).code, '57014');
    assert.ok(!errors.join('').includes('fixture-password'));
    assert.ok(!errors.join('').includes('private SQL'));
  }
});

test('disconnect failures and asynchronous client errors never produce a success report', async () => {
  for (const options of [{ closeError: new Error('private shutdown error') }, { eventAt: 'commit' }]) {
    const f = fixture(options);
    await assert.rejects(runConnectionAudit({ env, ClientClass: f.Client }));
    assert.equal(f.calls.at(-1), 'end');
  }
});

test('missing or malformed snapshots fail instead of reporting zero problems', async () => {
  for (const rows of [[], [null], [{ ...snapshot(), client_connections: null }]]) {
    const f = fixture({ rows });
    await assert.rejects(runConnectionAudit({ env, ClientClass: f.Client }), /INVALID_SNAPSHOT/);
  }
});

test('URL options cannot override diagnostic timeouts and Supabase TLS stays verified', () => {
  const config = connectionConfig({ DATABASE_URL: 'postgres://audit:fixture@db.example.supabase.co/postgres?sslmode=disable&query_timeout=0&connectionTimeoutMillis=0&options=-c%20statement_timeout%3D0&application_name=other' });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.query_timeout, 4000);
  assert.equal(config.application_name, 'ivx_connection_audit');
  assert.equal(new URL(config.connectionString).search, '');
  assert.equal(new URL(connectionConfig({ IVX_BUDGET_RECONCILIATION_DATABASE_URL: '  ', ...env }).connectionString).hostname, 'localhost');
});

test('actual CLI fails with nonzero exit when credentials are missing and cannot announce completion', () => {
  const cleanEnv = { ...process.env };
  for (const key of ['IVX_CONNECTION_AUDIT_DATABASE_URL', 'IVX_BUDGET_RECONCILIATION_DATABASE_URL', 'DATABASE_URL']) delete cleanEnv[key];
  const result = spawnSync(process.execPath, [new URL('./audit-connection-leakage.mjs', import.meta.url).pathname], { env: cleanEnv, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, 'MISSING_DATABASE_URL');
});
