import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { AppFactoryEngine } from '../backend/services/app-factory-engine';

// This destructive fixture is restricted to the disposable CI database.
const connectionString = process.env.IVX_FACTORY_TEST_DATABASE_URL;
const binding = new URL(connectionString ?? 'postgres://unconfigured');
assert(['postgres:', 'postgresql:'].includes(binding.protocol)
  && ['127.0.0.1', 'localhost'].includes(binding.hostname)
  && binding.pathname === '/ivx_factory_test', 'isolated factory test database required');
const pool = new Pool({ connectionString: connectionString!, max: 10, connectionTimeoutMillis: 5000 });
try {
  await pool.query('create role anon; create role authenticated; create role service_role bypassrls;');
  await pool.query(await readFile(new URL('../supabase/migrations/20260913234137_app_factory_registration.sql', import.meta.url), 'utf8'));
  const engine = new AppFactoryEngine(pool);
  const input = { requestId: randomUUID(), ownerId: 'isolated-owner', instructions: 'Build an isolated fixture.' };
  const startedAt = Date.now();
  const repeats = await Promise.allSettled(Array.from({ length: 100 }, () => engine.submitAppBuildTarget('Repeated fixture', 10, input)));
  assert.equal(repeats.filter(r => r.status === 'rejected').length, 0, 'concurrent retries must all resolve');
  const confirmed = repeats.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  assert.equal(confirmed.filter(r => !r.duplicate).length, 1);
  assert.equal(new Set(confirmed.map(r => r.targetDeadline)).size, 1);
  const distinct = await Promise.allSettled(Array.from({ length: 100 }, (_, index) =>
    engine.submitAppBuildTarget(`Isolated fixture ${index}`, 30, { ...input, requestId: randomUUID() })));
  assert.equal(distinct.filter(r => r.status === 'rejected').length, 0, 'independent requests must all resolve');
  const counts = (await pool.query<{ builds: number; tasks: number; premature: number }>(`select
    (select count(*)::int from factory_build_requests) as builds,
    (select count(*)::int from factory_tasks) as tasks,
    (select count(*)::int from factory_tasks where state<>'QUEUED' or payload->'evidence'<>'[]'::jsonb) as premature`)).rows[0];
  assert.deepEqual(counts, { builds: 101, tasks: 404, premature: 0 });
  console.log(JSON.stringify({ status: 'PASS', concurrentSubmissionsPerWave: 100,
    waves: 2, ...counts, elapsedMs: Date.now() - startedAt,
    modelCallsCreated: 0, workerConcurrencyCertified: false, latencySloCertified: false }));
} finally { await pool.end(); }
