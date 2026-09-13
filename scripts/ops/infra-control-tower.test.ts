import { expect, test } from 'bun:test';
import { collectInfraDiagnostic, diagnosticConfig } from './infra-control-tower';

const observedAt = '2026-09-13T21:00:00Z';
test('reports managed idle sessions and terminal tasks without certifying recovery', async () => {
  let reads = 0;
  const report = await collectInfraDiagnostic(async () => ({ rows: [{ report: ++reads === 1
    ? { observedAt, originalPurgeMatches: 17, originalPurgeMatchGroups: [{ application_name: 'Supavisor', connections: 3 }] }
    : { observedAt, tasks: [{ task_id: 'retained', version: '9007199254740993', retryAuthorized: false }] } }] }));
  expect(reads).toBe(2);
  expect(report.recoveryCertified).toBe(false);
  expect(report.connectionsTerminated).toBe(0);
  expect(report.tasksRequeued).toBe(0);
  expect(report.failedTasks.tasks).toEqual([{ task_id: 'retained', version: '9007199254740993', retryAuthorized: false }]);
});

test('a failed read aborts the diagnostic instead of producing zero counters or success', async () => {
  let reads = 0;
  await expect(collectInfraDiagnostic(async () => {
    reads++;
    throw new Error('query deadline');
  })).rejects.toThrow('query deadline');
  expect(reads).toBe(1);
});

test('a failed task read does not certify a partially successful diagnostic', async () => {
  let reads = 0;
  await expect(collectInfraDiagnostic(async () => {
    if (++reads === 2) throw new Error('task read timeout');
    return { rows: [{ report: { observedAt } }] };
  })).rejects.toThrow('task read timeout');
  expect(reads).toBe(2);
});

test('missing or malformed observation timestamps remain unavailable', async () => {
  for (const rows of [[], [{ report: {} }], [{ report: { observedAt: 'invalid' } }]]) {
    await expect(collectInfraDiagnostic(async () => ({ rows }))).rejects.toThrow('INFRA_DIAGNOSTIC_INCOMPLETE');
  }
});

test('the preferred budget binding must belong to the configured project', () => {
  expect(() => diagnosticConfig({
    SUPABASE_URL: 'https://fixtureproject.supabase.co',
    IVX_BUDGET_RECONCILIATION_DATABASE_URL: 'postgres://postgres:fixture@db.otherproject.supabase.co/postgres',
    SUPABASE_DB_URL: 'postgres://postgres:fixture@db.fixtureproject.supabase.co/postgres',
  })).toThrow('owner_control_direct_postgres_project_mismatch');
});

test('binding selection leaves the callers environment unchanged and uses one connection', () => {
  const env = {
    SUPABASE_URL: 'https://fixtureproject.supabase.co',
    IVX_BUDGET_RECONCILIATION_DATABASE_URL: 'postgres://postgres:fixture@db.fixtureproject.supabase.co/postgres',
    DATABASE_URL: 'original-value',
  };
  const before = { ...env };
  const config = diagnosticConfig(env);
  expect(env).toEqual(before);
  expect(config.host).toBe('db.fixtureproject.supabase.co');
  expect(config.max).toBe(1);
  expect(config.query_timeout).toBeGreaterThan(config.statement_timeout);
});
