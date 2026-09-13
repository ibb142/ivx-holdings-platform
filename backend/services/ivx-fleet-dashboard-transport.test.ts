import { expect, test } from 'bun:test';

const cases = [
  { name: 'direct setup timeout', transport: 'direct', failureStage: 'setup', sqlState: null, status: 200 },
  { name: 'direct query timeout', transport: 'direct', failureStage: 'query', sqlState: null, status: 200 },
  { name: 'direct server cancellation', transport: 'direct', failureStage: 'query', sqlState: '57014', status: 200 },
  { name: 'direct success', transport: 'direct', failureStage: null, sqlState: null, status: 200 },
  { name: 'REST success', transport: 'rest', failureStage: null, sqlState: null, status: 200 },
  { name: 'REST outage with a rejected database binding', transport: 'rest', failureStage: null, sqlState: null, status: 503 },
  { name: 'REST authorization denial', transport: 'rest', failureStage: null, sqlState: null, status: 403 },
  { name: 'REST throttling', transport: 'rest', failureStage: null, sqlState: null, status: 429 },
] as const;

for (const scenario of cases) test(`fleet observation selects one transport: ${scenario.name}`, async () => {
  // Isolate module mocks from other backend tests. The real exported reader,
  // transport selection, deadline handling and connection cleanup all execute;
  // only PostgreSQL and HTTP network I/O are replaced.
  const child = Bun.spawn([process.execPath, '-e', `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    import { EventEmitter } from 'node:events';
    const scenario = ${JSON.stringify(scenario)};
    const stats = { pools: 0, connections: 0, setups: 0, reads: 0, commits: 0, rollbacks: 0, releases: [], rest: 0 };
    const snapshot = { measuredAt: '2026-09-12T22:30:00Z', agents: [{ agentNumber: 54, state: 'RUNNING' }] };
    const failure = Object.assign(new Error('Query read timeout'), scenario.sqlState ? { code: scenario.sqlState } : {});
    mock.module('pg', () => ({ Client: class {}, Pool: class extends EventEmitter {
      constructor() { super(); stats.pools++; }
      async connect() {
        stats.connections++;
        return Object.assign(new EventEmitter(), {
          query: async (sql) => {
            if (sql.startsWith('BEGIN')) {
              stats.setups++;
              if (scenario.failureStage === 'setup') throw failure;
            } else if (sql.includes('ivx_fleet_dashboard_observation')) {
              stats.reads++;
              if (scenario.failureStage === 'query') throw failure;
              return { rows: [{ result: snapshot }] };
            } else if (sql === 'COMMIT') stats.commits++;
            else if (sql === 'ROLLBACK') stats.rollbacks++;
            else throw new Error('Unexpected SQL in observation fixture');
            return { rows: [] };
          },
          release: destroyed => stats.releases.push(destroyed),
        });
      }
    }}));
    process.env.IVX_AUTONOMOUS_QUEUE_BACKEND = 'postgres_atomic';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://testproject.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-key';
    // The REST scenarios intentionally carry an unusable cross-project direct
    // binding. An HTTP error must not activate that rejected transport.
    process.env.SUPABASE_DB_URL = 'postgresql://postgres.'
      + (scenario.transport === 'direct' ? 'testproject' : 'otherproject')
      + ':fixture@aws-0-us-east-1.pooler.supabase.com/postgres';
    globalThis.fetch = async (input, init) => {
      stats.rest++;
      assert.equal(scenario.transport, 'rest', 'a direct read must not replay through REST');
      assert.equal(String(input), 'https://testproject.supabase.co/rest/v1/rpc/ivx_fleet_dashboard_observation');
      assert.equal(init.method, 'POST');
      return Response.json(scenario.status === 200 ? snapshot : { message: 'source unavailable' }, {
        status: scenario.status, headers: { 'Retry-After': '60' },
      });
    };
    const store = await import(${JSON.stringify(new URL('./ivx-postgres-autonomous-task-store.ts', import.meta.url).pathname)});
    assert.equal(store.preferDirectTransport(), scenario.transport === 'direct');
    if (scenario.failureStage) {
      await assert.rejects(store.readPostgresFleetDashboardObservation(), error => error === failure);
    } else if (scenario.status !== 200) {
      await assert.rejects(store.readPostgresFleetDashboardObservation(), new RegExp('HTTP ' + scenario.status));
    } else {
      assert.deepEqual(await store.readPostgresFleetDashboardObservation(), snapshot);
    }
    if (scenario.transport === 'direct') {
      assert.equal(stats.connections, 1, 'one observation must not repeat its direct checkout after failure');
      assert.equal(stats.setups, 1);
      assert.equal(stats.reads, scenario.failureStage === 'setup' ? 0 : 1);
      assert.equal(stats.rest, 0);
      assert.deepEqual(stats.releases, [Boolean(scenario.failureStage)]);
      assert.equal(stats.commits, scenario.failureStage ? 0 : 1);
      assert.equal(stats.rollbacks, scenario.sqlState ? 1 : 0);
    } else {
      assert.equal(stats.rest, 1, 'one observation must not amplify a failed HTTP read');
      assert.equal(stats.pools, 0, 'a rejected database binding must remain unused');
      assert.equal(stats.connections, 0);
    }
  `], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code, stderr).toBe(0);
});
