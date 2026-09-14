import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { getApiPool, resetDatabasePoolsForTests } from './ivx-database-pools';
import { readFeedEngagementCounts } from './ivx-feed-engagement-counts';

const saved = { ...process.env };
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const zero = { likes: 0, comments: 0, shares: 0, saves: 0 };
afterEach(() => { resetDatabasePoolsForTests(); process.env = { ...saved }; });
function configure(direct = false) {
  for (const key of ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'IVX_PG_API_MAX_CONNECTIONS',
    'IVX_PG_TASKS_MAX_CONNECTIONS', 'IVX_PG_PROCESS_CONNECTION_LIMIT']) delete process.env[key];
  process.env.NODE_ENV = 'test';
  if (direct) {
    process.env.SUPABASE_DB_URL = 'postgresql://postgres:test@db.example.supabase.co:5432/postgres';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  }
}
function restClient(result: (table: string) => any) {
  const calls: Array<{ table: string; filters: unknown[] }> = [];
  return {
    calls,
    from(table: string) {
      const call = { table, filters: [] as unknown[] }; calls.push(call);
      const query: any = {
        select: (...args: unknown[]) => { call.filters.push(['select', ...args]); return query; },
        in: (...args: unknown[]) => { call.filters.push(['in', ...args]); return query; },
        eq: (...args: unknown[]) => { call.filters.push(['eq', ...args]); return query; },
        is: (...args: unknown[]) => { call.filters.push(['is', ...args]); return query; },
        then: (resolve: any, reject: any) => Promise.resolve(result(table)).then(resolve, reject),
      };
      return query;
    },
  };
}
test('one shared-pool checkout returns all metrics with anon role and existing deadlines', async () => {
  configure(true);
  const calls: Array<{ sql: string; values: unknown[] }> = [], released: boolean[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return { rows: sql.startsWith('select row_to_json') ? [
        { value: { project_id: a, metric: 'likes', amount: '1001' } },
        { value: { project_id: a, metric: 'comments', amount: '2' } },
        { value: { project_id: b, metric: 'saves', amount: '3' } },
      ] : [] };
    },
    release: (destroy: boolean) => released.push(destroy),
  });
  const checkout = spyOn(getApiPool(), 'connect').mockResolvedValue(client as any);
  const sb = restClient(() => { throw new Error('SQL must not replay through REST'); });
  try {
    expect(await readFeedEngagementCounts(sb, [a, b, a])).toEqual({
      [a]: { ...zero, likes: 1001, comments: 2 }, [b]: { ...zero, saves: 3 },
    });
    expect(checkout).toHaveBeenCalledTimes(1);
    expect(calls[0].sql).toContain('SET LOCAL ROLE anon');
    expect(calls[0].sql).toContain('SET TRANSACTION READ ONLY');
    expect(calls[0].sql).toContain("statement_timeout = '2500ms'");
    expect(calls.filter(call => call.sql.startsWith('select row_to_json'))).toHaveLength(1);
    expect(calls[1].values).toEqual([[a, b]]);
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    expect(released).toEqual([false]); expect(sb.calls).toHaveLength(0);
  } finally { checkout.mockRestore(); }
});
test('a cancelled SQL read is rolled back and rejected without extra checkouts or REST replay', async () => {
  configure(true);
  const calls: string[] = [], released: boolean[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('select row_to_json')) throw Object.assign(new Error('cancelled'), { code: '57014' });
      return { rows: [], command: sql === 'ROLLBACK' ? 'ROLLBACK' : 'SELECT' };
    },
    release: (destroy: boolean) => released.push(destroy),
  });
  const checkout = spyOn(getApiPool(), 'connect').mockResolvedValue(client as any);
  const sb = restClient(() => ({ data: [] }));
  try {
    await expect(readFeedEngagementCounts(sb, [a])).rejects.toThrow('cancelled');
    expect(checkout).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toBe('ROLLBACK'); expect(released).toEqual([false]);
    expect(sb.calls).toHaveLength(0);
  } finally { checkout.mockRestore(); }
});
test('REST counts retain comment moderation filters and distinguish absent engagements', async () => {
  configure();
  const sb = restClient(table => {
    const data = table === 'project_likes' ? [{ project_id: a }, { project_id: a }] : [];
    return { data, error: null, count: data.length };
  });
  expect(await readFeedEngagementCounts(sb, [a, b, a])).toEqual({ [a]: { ...zero, likes: 2 }, [b]: zero });
  expect(sb.calls).toHaveLength(4);
  expect(sb.calls.find(call => call.table === 'project_comments')?.filters).toEqual([
    ['select', 'project_id', { count: 'exact' }], ['in', 'project_id', [a, b]],
    ['eq', 'is_approved', true], ['is', 'deleted_at', null],
  ]);
});
for (const [name, result, reason] of [
  ['upstream error', { data: [], error: { message: 'offline' } }, 'UNAVAILABLE'],
  ['missing data', { data: null }, 'UNAVAILABLE'],
  ['truncated rows', { data: [{ project_id: a }], count: 1001 }, 'INCOMPLETE'],
  ['unverified row limit', { data: Array.from({ length: 1000 }, () => ({ project_id: a })) }, 'INCOMPLETE'],
  ['unexpected identity', { data: [{ project_id: b }], count: 1 }, 'INVALID_FEED_ENGAGEMENT_RESULT'],
] as const) test(`REST ${name} cannot become a successful zero`, async () => {
  configure();
  await expect(readFeedEngagementCounts(restClient(() => result), [a])).rejects.toThrow(reason);
});
test('empty selections need no connection and oversized selections fail before reading', async () => {
  configure(); const sb = restClient(() => ({ data: [] }));
  expect(await readFeedEngagementCounts(sb, [])).toEqual({});
  await expect(readFeedEngagementCounts(sb, Array.from({ length: 201 }, (_, i) => String(i)))).rejects.toThrow('IDENTITIES');
  expect(sb.calls).toHaveLength(0);
});
