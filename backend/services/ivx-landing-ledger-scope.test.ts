import { afterEach, expect, test } from 'bun:test';
import { readPostgresLandingTasks, readPostgresAutonomousTaskIndex, resetPostgresAutonomousTaskStoreForTests } from './ivx-postgres-autonomous-task-store';
const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
const sha = 'a'.repeat(40);
function configure() {
  process.env.SUPABASE_URL = 'https://ledger-fixture.invalid';
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  for (const key of ['SUPABASE_DB_URL','DATABASE_URL','POSTGRES_URL','SUPABASE_POOLER_URL']) delete process.env[key];
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
}
afterEach(() => { process.env = { ...savedEnv }; globalThis.fetch = savedFetch; resetPostgresAutonomousTaskStoreForTests(); });

test('reads current audit, repair and patrol evidence in one bounded query after ledger growth', async () => {
  configure(); let calls = 0;
  globalThis.fetch = (async input => {
    calls++;
    const url = new URL(String(input));
    expect(url.searchParams.get('or')).toBe(`(idempotency_key.like.landing-p0:${sha}:*,idempotency_key.like.landing-p0-repair:${sha}:*,idempotency_key.like.landing-p0-patrol:${sha}:*)`);
    expect(url.searchParams.get('limit')).toBe('1000');
    expect(url.searchParams.has('offset')).toBe(false);
    return Response.json([{ payload: { taskId: 'current-failed-unit', state: 'BLOCKED', evidence: [{ summary: 'retained failure' }] } }]);
  }) as typeof fetch;
  const tasks = await readPostgresLandingTasks(sha);
  expect(tasks[0].state).toBe('BLOCKED');
  expect(tasks[0].evidence[0].summary).toBe('retained failure');
  expect(calls).toBe(1);
});

test('planning excludes old campaigns and inspections while retaining business work and ownership', async () => {
  configure();
  globalThis.fetch = (async input => {
    const url = new URL(String(input));
    const filter = url.searchParams.get('or')!;
    const observedAt = /lease_expires_at\.gt\.([^,)]+)/.exec(filter)?.[1];
    expect(Number.isFinite(Date.parse(observedAt ?? ''))).toBe(true);
    expect(filter).toBe(`(and(idempotency_key.not.like.landing-p0:*,idempotency_key.not.like.landing-p0-repair:*,idempotency_key.not.like.landing-p0-patrol:*,idempotency_key.not.like.module-audit:*,idempotency_key.not.like.autonomous-secondary:*),idempotency_key.like.landing-p0:${sha}:*,idempotency_key.like.landing-p0-repair:${sha}:*,idempotency_key.like.landing-p0-patrol:${sha}:*,idempotency_key.like.module-audit:${sha}:*,idempotency_key.like.autonomous-secondary:${sha}:*,state.in.(LEASED,RUNNING,PAUSED,EXECUTION_COMPLETED,QA_IN_PROGRESS,READY_FOR_DEPLOYMENT,DEPLOYING,DEPLOYED,PRODUCTION_VERIFYING),and(lease_holder.not.is.null,or(state.eq.QUEUED,lease_expires_at.is.null,lease_expires_at.gt.${observedAt})))`);
    return Response.json([{ task_id: 'business-task', idempotency_key: 'owner-task:keep', assigned_agent_number: 1, state: 'QUEUED', title: 'Keep owner work' }]);
  }) as typeof fetch;
  expect((await readPostgresAutonomousTaskIndex(sha))[0].taskId).toBe('business-task');
});

test('refuses incomplete evidence or invalid SHA rather than issuing a certificate', async () => {
  configure();
  globalThis.fetch = (async () => Response.json(Array.from({ length: 1000 }, () => ({ payload: {} })))) as typeof fetch;
  await expect(readPostgresLandingTasks(sha)).rejects.toThrow('Incomplete');
  await expect(readPostgresLandingTasks('unknown')).rejects.toThrow('Invalid');
  await expect(readPostgresAutonomousTaskIndex('a:*')).rejects.toThrow('Invalid');
});
