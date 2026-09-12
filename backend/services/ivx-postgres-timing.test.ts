import { expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { Pool } from 'pg';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { newReadTimings, readTimings, timingHeaders } from './ivx-read-timings';

const sql = 'select $1::text';
type Stage = 'success' | 'checkout' | 'setup' | 'query' | 'commit';

function fixture(stage: Stage, advance: (ms: number) => void) {
  const error = Object.assign(new Error('private provider error'), { code: '57014' });
  const calls: string[] = [], releases: boolean[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (text: string) => {
      calls.push(text);
      const current = text.startsWith('BEGIN') ? 'setup' : text === sql ? 'query' : 'commit';
      advance(current === 'setup' ? 40 : current === 'query' ? 60 : 90);
      if (text !== 'ROLLBACK' && current === stage) throw error;
      return { rows: [{ value: 'retained' }] };
    },
    release: (destroy: boolean) => releases.push(destroy),
  });
  const pool = { connect: async () => {
    advance(15);
    if (stage === 'checkout') throw error;
    return client;
  } } as unknown as Pick<Pool, 'connect'>;
  return { pool, client, error, calls, releases };
}

for (const stage of ['success', 'checkout', 'setup', 'query', 'commit'] as const) {
  test(`SQL timing separates checkout/setup/commit and preserves ${stage} outcome`, async () => {
    let now = 0;
    const clock = spyOn(performance, 'now').mockImplementation(() => now);
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    const f = fixture(stage, ms => { now += ms; });
    const metrics = newReadTimings();
    try {
      const result = readTimings.run(metrics, () => queryWithPostgresDeadline(f.pool, sql, ['private argument']));
      if (stage === 'success') expect((await result).rows).toEqual([{ value: 'retained' }]);
      else await expect(result).rejects.toBe(f.error);
      const headers = timingHeaders(metrics);
      const queried = !['checkout', 'setup'].includes(stage);
      expect(headers['X-Pool-Acquisition-Ms']).toBe('15.0');
      expect(headers['X-SQL-Execution-Ms']).toBe(queried ? '60.0' : 'unavailable');
      expect(headers['X-IVX-SQL-Timing-Scope']).toBe(
        `request-owned-pg-roundtrip-sum; completed=${Number(queried)}; failed=${Number(stage === 'query')}; pending=0`);
      expect(JSON.stringify(headers)).not.toContain('private');
      expect(f.calls.filter(call => call === sql)).toHaveLength(Number(queried));
      expect(f.releases).toEqual(stage === 'checkout' ? [] : [stage !== 'success']);
      expect(f.client.listenerCount('error')).toBe(0);
    } finally { clock.mockRestore(); logger.mockRestore(); }
  });
}

test('pending SQL and parallel requests retain their own timing context', async () => {
  let now = 0;
  const clock = spyOn(performance, 'now').mockImplementation(() => now);
  const a = newReadTimings(), b = newReadTimings();
  let entered!: () => void, finish!: (value: { rows: unknown[] }) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<{ rows: unknown[] }>(resolve => { finish = resolve; });
  const makePool = (query: () => Promise<{ rows: unknown[] }>) => ({ connect: async () =>
    Object.assign(new EventEmitter(), {
      query: (text: string) => text === sql ? query() : Promise.resolve({ rows: [] }), release: () => {},
    }) }) as unknown as Pick<Pool, 'connect'>;
  const pending = readTimings.run(a, () => queryWithPostgresDeadline(makePool(() => { entered(); return delayed; }), sql, []));
  try {
    await started;
    expect(timingHeaders(a)['X-SQL-Execution-Ms']).toBe('unavailable');
    expect(timingHeaders(a)['X-IVX-SQL-Timing-Scope']).toContain('completed=0; failed=0; pending=1');
    await readTimings.run(b, () => queryWithPostgresDeadline(makePool(async () => { now = 20; return { rows: [] }; }), sql, []));
    expect(timingHeaders(b)['X-SQL-Execution-Ms']).toBe('20.0');
    expect(timingHeaders(a)['X-SQL-Execution-Ms']).toBe('unavailable');
    now = 50; finish({ rows: [] }); await pending;
    expect(timingHeaders(a)['X-SQL-Execution-Ms']).toBe('50.0');
    expect(timingHeaders(b)['X-SQL-Execution-Ms']).toBe('20.0');
    expect(timingHeaders(newReadTimings())['X-SQL-Execution-Ms']).toBe('unavailable');
  } finally { finish({ rows: [] }); await pending; clock.mockRestore(); }
});

test('shipped HTTP timing middleware exposes SQL metrics on success and failure', async () => {
  const source = readFileSync(new URL('../hono.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const IVX_ALLOWED_ORIGINS =');
  const end = source.indexOf('// ── Enterprise middleware stack', start);
  expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start);
  const middleware = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end));
  for (const stage of ['success', 'query'] as const) {
    let now = 0;
    const clock = spyOn(performance, 'now').mockImplementation(() => now);
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    const app = new Hono(), f = fixture(stage, ms => { now += ms; });
    vm.runInNewContext(middleware, { app, cors, newReadTimings, readTimings, timingHeaders });
    app.get('/api/reels', async c => {
      try { return c.json((await queryWithPostgresDeadline(f.pool, sql, [])).rows); }
      catch { return c.json({ code: 'DATABASE_UNAVAILABLE' }, 503); }
    });
    try {
      const response = await app.request('/api/reels', { headers: { Origin: 'https://ivxholding.com' } });
      expect(response.status).toBe(stage === 'success' ? 200 : 503);
      expect(response.headers.get('X-Pool-Acquisition-Ms')).toBe('15.0');
      expect(response.headers.get('X-SQL-Execution-Ms')).toBe('60.0');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ivxholding.com');
      const exposed = response.headers.get('Access-Control-Expose-Headers')!.toLowerCase().split(',');
      expect(exposed).toContain('x-sql-execution-ms');
      expect(exposed).toContain('x-ivx-sql-timing-scope');
      expect(response.headers.get('X-IVX-SQL-Timing-Scope')).toContain(`failed=${Number(stage === 'query')}`);
      expect(f.releases).toEqual([stage === 'query']);
    } finally { clock.mockRestore(); logger.mockRestore(); }
  }
});
