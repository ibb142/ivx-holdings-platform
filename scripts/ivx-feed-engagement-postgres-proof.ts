import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'bun:test';
import pg from 'pg';

const sourceUrl = new URL(process.env.IVX_HA_TEST_DATABASE_URL ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname) || sourceUrl.pathname !== '/ivx_ha_test') {
  throw new Error('Local ivx_ha_test database required');
}
const database = `ivx_feed_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(sourceUrl); testUrl.pathname = `/${database}`;
const connectionString = testUrl.toString();
// Only substitute the local connection configuration. Use the actual pool,
// role selection, SQL, transaction deadlines and PostgreSQL query planner.
mock.module('../backend/services/ivx-emergency-stop-postgres', () => ({
  emergencyStopPostgresConfig: () => ({ connectionString }),
}));
mock.module('../backend/services/ivx-supabase-postgres-tls', () => ({
  supabasePostgresTls: () => false, withoutPostgresUrlTlsOptions: (value: string) => value,
}));
process.env.SUPABASE_DB_URL = connectionString;
delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_KEY;
const { FEED_ENGAGEMENT_COUNTS_SQL, readFeedEngagementCounts } = await import('../backend/services/ivx-feed-engagement-counts');
const { getApiPool, resetDatabasePoolsForTests } = await import('../backend/services/ivx-database-pools');
const admin = new pg.Client({ connectionString: sourceUrl.toString() });
const fixture = new pg.Client({ connectionString });
const metrics = ['likes', 'comments', 'shares', 'saves'] as const;
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const empty = '00000000-0000-4000-8000-000000000003';
const ids = [a, b, empty];
const zero = () => ({ likes: 0, comments: 0, shares: 0, saves: 0 });
const noRest = { from: () => { throw new Error('Native SQL must not replay via REST'); } };
let created = false, connected = false;
await admin.connect();
try {
  await admin.query(`CREATE DATABASE ${database}`); created = true;
  await fixture.connect(); connected = true;
  for (const [index, metric] of metrics.entries()) {
    const table = `project_${metric}`;
    await fixture.query(`
      CREATE TABLE public.${table} (project_id uuid NOT NULL, visible boolean NOT NULL DEFAULT true,
        is_approved boolean NOT NULL DEFAULT true, deleted_at timestamptz);
      CREATE INDEX ${table}_project_idx ON public.${table}(project_id)
        ${metric === 'comments' ? 'WHERE is_approved = true AND deleted_at IS NULL' : ''};
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY public_rows ON public.${table} FOR SELECT TO anon USING (visible);
      GRANT SELECT ON public.${table} TO anon, service_role;
      INSERT INTO public.${table}(project_id) SELECT md5('noise:' || i)::uuid FROM generate_series(1,20000) i;`);
    await fixture.query(`INSERT INTO public.${table}(project_id) SELECT $1::uuid FROM generate_series(1,$2::int)`, [a, index + 2]);
    await fixture.query(`INSERT INTO public.${table}(project_id,visible) VALUES ($1,false),($2,true)`, [a, b]);
    if (metric === 'comments') {
      await fixture.query(`INSERT INTO public.project_comments(project_id,is_approved,deleted_at)
        VALUES ($1,false,null),($1,true,now())`, [a]);
    }
    await fixture.query(`ANALYZE public.${table}`);
  }
  let checkouts = 0;
  getApiPool().on('acquire', () => { checkouts++; });
  const counts = await readFeedEngagementCounts(noRest, [...ids, a]);
  assert.equal(checkouts, 1, 'all four metrics must share one existing-pool checkout');
  assert.deepEqual(counts, {
    [a]: { likes: 2, comments: 3, shares: 4, saves: 5 },
    [b]: { likes: 1, comments: 1, shares: 1, saves: 1 }, [empty]: zero(),
  }, 'RLS, missing rows and approved/non-deleted comment counts must survive');

  const baseline = Object.fromEntries(ids.map(id => [id, zero()]));
  let baselineBuffers = 0;
  await fixture.query('BEGIN; SET TRANSACTION READ ONLY; SET LOCAL ROLE anon');
  let plan: any;
  try {
    for (const metric of metrics) {
      const sql = `SELECT project_id FROM public.project_${metric} WHERE project_id::text = ANY($1::text[])
        ${metric === 'comments' ? 'AND is_approved = true AND deleted_at IS NULL' : ''}`;
      for (const row of (await fixture.query(sql, [ids])).rows) baseline[row.project_id][metric]++;
      const result = (await fixture.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, [ids])).rows[0]['QUERY PLAN'][0].Plan;
      baselineBuffers += (result['Shared Hit Blocks'] ?? 0) + (result['Shared Read Blocks'] ?? 0);
    }
    plan = (await fixture.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${FEED_ENGAGEMENT_COUNTS_SQL}`, [ids])).rows[0]['QUERY PLAN'][0].Plan;
  } finally { await fixture.query('ROLLBACK'); }
  assert.deepEqual(counts, baseline, 'optimized results must equal the former raw-row queries');
  const nodes = (node: any): any[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
  const indexReads = nodes(plan).filter(node => node['Index Cond']?.includes('project_id'));
  assert.equal(indexReads.length, 4, 'each metric must use its UUID index without a forced planner option');
  const aggregateBuffers = (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);
  assert(aggregateBuffers < baselineBuffers, 'aggregation must reduce buffer reads on the indexed fixture');
  assert(plan['Actual Rows'] <= ids.length * 4, 'transfer must be bounded by videos, not engagement history');

  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-fixture';
  const privileged = await readFeedEngagementCounts(noRest, ids);
  assert.deepEqual(privileged[a], { likes: 3, comments: 4, shares: 5, saves: 6 });
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fixture.query('BEGIN; LOCK TABLE public.project_comments IN ACCESS EXCLUSIVE MODE');
  let lockTimeoutCode: string | undefined;
  try {
    await assert.rejects(() => readFeedEngagementCounts(noRest, ids), (error: any) => {
      lockTimeoutCode = error.code; return error.code === '55P03';
    });
  } finally { await fixture.query('ROLLBACK'); }
  assert.deepEqual(await readFeedEngagementCounts(noRest, ids), baseline, 'read must recover after the lock timeout');
  console.log(JSON.stringify({ result: 'PASS', sourceSha: process.env.GITHUB_SHA,
    metrics: 4, checkoutsPerRead: 1, equivalentCounts: true, rlsPreserved: true,
    uuidIndexReads: indexReads.length, baselineBuffers, aggregateBuffers,
    returnedRows: plan['Actual Rows'], lockTimeoutCode, timeoutRecovery: true, productionRowsTouched: 0 }));
} finally {
  if (connected) await fixture.end();
  // Only the unique test database created by this process can be removed.
  if (created) { await getApiPool().end(); resetDatabasePoolsForTests(); await admin.query(`DROP DATABASE ${database}`); }
  await admin.end();
}
