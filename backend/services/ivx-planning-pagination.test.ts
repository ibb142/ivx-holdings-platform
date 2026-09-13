import { afterEach, expect, test } from 'bun:test';
import { readPostgresAutonomousTaskIndex, resetPostgresAutonomousTaskStoreForTests } from './ivx-postgres-autonomous-task-store';

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
afterEach(() => {
  process.env = { ...savedEnv };
  globalThis.fetch = savedFetch;
  resetPostgresAutonomousTaskStoreForTests();
});

function configure() {
  for (const key of ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL']) delete process.env[key];
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://planning-fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
}

test('planning does not skip later work when earlier-page tasks leave the mission', async () => {
  configure();
  const at = '2026-09-13T00:00:00.000001+00:00';
  const first = Array.from({ length: 1000 }, (_, i) => ({ task_id: `old-${String(i).padStart(4, '0')}`,
    idempotency_key: `module-audit:${'b'.repeat(40)}:${i}`, assigned_agent_number: i % 112 + 1, state: 'RUNNING', created_at: at }));
  const survivor = { task_id: 'later-work', idempotency_key: `module-audit:${'a'.repeat(40)}:later`, assigned_agent_number: 112,
    state: 'QUEUED', created_at: '2026-09-13T00:00:00.000002+00:00' };
  const queries: URLSearchParams[] = [];
  globalThis.fetch = (async input => {
    const q = new URL(String(input)).searchParams;
    queries.push(q);
    // These tasks become ineligible between pages. OFFSET would now skip the
    // surviving row; a cursor still reads work beyond the prior boundary.
    const eligible = queries.length === 1 ? [...first, survivor] : [survivor];
    return Response.json(eligible.slice(Number(q.get('offset') ?? 0), Number(q.get('offset') ?? 0) + 1000));
  }) as typeof fetch;
  const result = await readPostgresAutonomousTaskIndex('a'.repeat(40));
  expect(result).toHaveLength(1001);
  expect(result.at(-1)?.taskId).toBe('later-work');
  expect(queries).toHaveLength(2);
  expect(queries[1].has('offset')).toBe(false);
  expect(queries[1].get('and')).toContain(at);
  expect(queries[1].get('and')).toContain('old-0999');
  expect(queries.every(q => q.get('select') === 'task_id,idempotency_key,assigned_agent_number,state,created_at')).toBe(true);
  expect(Object.keys(result[0]).sort()).toEqual(['assignedAgentNumber', 'idempotencyKey', 'state', 'taskId']);
});

test('an invalid or repeated page boundary cannot certify a complete planning read', async () => {
  configure();
  const page = Array.from({ length: 1000 }, (_, i) => ({ task_id: `task-${i}`, idempotency_key: `owner:${i}`,
    assigned_agent_number: 1, state: 'QUEUED', created_at: 'invalid' }));
  globalThis.fetch = (async () => Response.json(page)) as typeof fetch;
  await expect(readPostgresAutonomousTaskIndex()).rejects.toThrow('planning cursor');
  for (const row of page) row.created_at = '2026-09-13T00:00:00.123456Z';
  await expect(readPostgresAutonomousTaskIndex()).rejects.toThrow('planning cursor');
});
