import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { newReadTimings, readTimings, timingHeaders } from './services/ivx-read-timings';
import { queryWithPostgresDeadline } from './services/ivx-postgres-deadline';
import { publicReadTimeout, publicMutationTimeout } from './services/ivx-public-timeout-response';

const readRoutes = ['/api/projects/:projectId/comments', '/api/ivx/properties/featured',
  '/api/ivx/featured-properties', '/api/ivx/jv-deals', '/api/ivx/deals', '/api/deals',
  '/api/published-jv-deals', '/api/landing-deals', '/api/ivx/properties', '/api/properties',
  '/api/ivx/videos/feed', '/api/ivx/video-platform/channels',
  '/api/ivx/video-platform/stories', '/api/ivx/video-platform/live'];
const writeRoutes = ['/api/projects/:projectId/like', '/api/projects/:projectId/share', '/api/projects/:projectId/save'];
const source = readFileSync(process.env.IVX_PUBLIC_TIMEOUT_SOURCE || new URL('./hono.ts', import.meta.url), 'utf8');

test('shipped middleware exposes SQL timings to the browser and preserves a failed database response', async () => {
  const app = new Hono();
  const begin = source.indexOf('const IVX_ALLOWED_ORIGINS = [');
  const end = source.indexOf('// ── Enterprise middleware stack ──', begin);
  if (begin < 0 || end < begin) throw Error('Missing shipped timing middleware');
  const middleware = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(begin, end));
  vm.runInNewContext(middleware, { app, cors, newReadTimings, readTimings, timingHeaders });
  let fail = false;
  const error = Object.assign(new Error('database unavailable'), { code: '57014' });
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      if (sql === 'select http' && fail) throw error;
      return { rows: [{ marker: 'actual-data' }] };
    }, release: () => {},
  });
  const pool = { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
  app.onError((caught, c) => { expect(caught).toBe(error); return c.json({ code: 'DB_FAILED' }, 503); });
  app.get('/api/deals', async c => c.json((await queryWithPostgresDeadline(pool, 'select http', [])).rows));
  for (const shouldFail of [false, true]) {
    fail = shouldFail;
    const response = await app.request('/api/deals', { headers: { Origin: 'https://ivxholding.com' } });
    expect(response.status).toBe(shouldFail ? 503 : 200);
    expect(await response.json()).toEqual(shouldFail ? { code: 'DB_FAILED' } : [{ marker: 'actual-data' }]);
    for (const header of ['X-Pool-Acquisition-Ms', 'X-SQL-Execution-Ms']) {
      expect(response.headers.get(header)).not.toBeNull();
      expect(Number(response.headers.get(header))).toBeGreaterThanOrEqual(0);
      expect(response.headers.get('access-control-expose-headers')).toContain(header);
    }
    expect(response.headers.get('X-IVX-Timing-Scope')).toContain('sql_completed=1; sql_pending=0');
  }
});

// Execute the shipped registrations and deadline with Hono, without booting
// production background workers or connecting unit tests to external services.
function fixture(mode: 'stalled' | 'success' | 'source-error' | 'late-success') {
  const app = new Hono();
  const pending: Array<() => void> = [];
  let attempts = 0, committed = 0;
  const begin = source.indexOf('async function withTimeout<');
  const end = source.indexOf('// NOTE: This is a static build label', begin);
  if (begin < 0 || end < begin) throw Error('Missing deployed deadline helper');
  const publicSource = readFileSync(new URL('./api/ivx-public-features.ts', import.meta.url), 'utf8');
  const budget = Number(/PUBLIC_DEALS_QUERY_TIMEOUT_MS = (\d+)/.exec(publicSource)?.[1]);
  if (!Number.isFinite(budget)) throw Error('Missing public deals source budget');
  // Scale real deadlines uniformly; keep the relationship between inner and outer.
  const context: Record<string, unknown> = { app, Response, readTimings,
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms / 100),
    clearTimeout, PUBLIC_DEALS_QUERY_TIMEOUT_MS: budget,
    SB_HARD_TIMEOUT_MS: 6000, publicReadTimeout, publicMutationTimeout };
  const registrations: string[] = [];
  for (const route of [...readRoutes, ...writeRoutes]) {
    const matches = source.split('\n').filter(line => line.startsWith('app.')
      && line.includes(`'${route}'`) && line.includes('withTimeout('));
    if (matches.length !== 1) throw Error(`Ambiguous route: ${route}`);
    registrations.push(matches[0]);
    const handler = /=> (handle\w+)\(/.exec(matches[0])?.[1];
    if (!handler) throw Error(`Missing handler: ${route}`);
    context[handler] = () => {
      attempts++;
      if (mode === 'late-success') return new Promise<Response>(resolve => setTimeout(() =>
        resolve(Response.json({ marker: 'late-valid-response' })), 75));
      if (mode === 'success') return Promise.resolve(Response.json({ marker: 'actual-response', items: ['retained'] }));
      if (mode === 'source-error') return Promise.resolve(Response.json({ code: 'SOURCE_FAILURE' }, { status: 503 }));
      return new Promise<Response>(resolve => pending.push(() => {
        committed++; resolve(Response.json({ committed: true }));
      }));
    };
  }
  const deadline = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(begin, end));
  vm.runInNewContext(deadline + '\n' + registrations.join('\n'), context);
  return { app, finish: () => pending.splice(0).forEach(resolve => resolve()),
    attempts: () => attempts, committed: () => committed };
}

test('every public read alias returns uncached 503 when its source misses the deadline', async () => {
  const f = fixture('stalled');
  try {
    for (const route of readRoutes) {
      const response = await f.app.request(route.replace(':projectId', 'project-1'));
      expect(response.status, route).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('retry-after')).toBe('2');
      const body = await response.json();
      expect(body.code).toBe('PUBLIC_READ_TIMEOUT');
      expect(body.retryable).toBe(true);
      for (const key of ['deals', 'properties', 'videos', 'count', 'total', 'success']) expect(body).not.toHaveProperty(key);
    }
  } finally { f.finish(); }
});

test('a timed-out engagement operation can still commit, so its response stays unknown and is never replayed', async () => {
  const f = fixture('stalled');
  try {
    for (const route of writeRoutes) {
      const response = await f.app.request(route.replace(':projectId', 'project-1'), { method: 'POST' });
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.has('retry-after')).toBe(false);
      const body = await response.json();
      expect(body).toMatchObject({ code: 'ENGAGEMENT_OUTCOME_UNKNOWN', outcome: 'unknown', retryable: false });
      for (const key of ['liked', 'saved', 'success', 'like_count', 'save_count', 'share_count']) expect(body).not.toHaveProperty(key);
    }
    expect(f.committed()).toBe(0);
    f.finish();
    await Promise.resolve();
    expect(f.committed()).toBe(3);
    expect(f.attempts()).toBe(3);
  } finally { f.finish(); }
});

test('completed reads and explicit source errors keep their actual response', async () => {
  for (const mode of ['success', 'source-error'] as const) {
    const f = fixture(mode);
    const response = await f.app.request('/api/deals');
    expect(response.status).toBe(mode === 'success' ? 200 : 503);
    expect(await response.json()).toEqual(mode === 'success' ? { marker: 'actual-response', items: ['retained'] } : { code: 'SOURCE_FAILURE' });
    expect(f.attempts()).toBe(1);
  }
});

// 75ms represents 7.5s under the fixture's uniform deadline scaling.
test('public deals preserve valid responses after the old six-second deadline', async () => {
  const f = fixture('late-success');
  const response = await f.app.request('/api/landing-deals');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ marker: 'late-valid-response' });
  expect(f.attempts()).toBe(1);
});


test('public request budget ends a stalled route before its longer fallback timer', async () => {
  const f = fixture('stalled');
  try {
    const metrics = newReadTimings(20);
    const response = await readTimings.run(metrics, () => f.app.request('/api/landing-deals'));
    expect(response.status).toBe(503);
    expect(metrics.deadline?.aborted).toBe(true);
    expect(f.attempts()).toBe(1);
    expect(f.committed()).toBe(0);
  } finally { f.finish(); }
});

test('an expired public request budget starts no source work', async () => {
  const f = fixture('success');
  const metrics = newReadTimings();
  const stop = new AbortController(); stop.abort(); metrics.deadline = stop.signal;
  const response = await readTimings.run(metrics, () => f.app.request('/api/landing-deals'));
  expect(response.status).toBe(503);
  expect(f.attempts()).toBe(0);
});
