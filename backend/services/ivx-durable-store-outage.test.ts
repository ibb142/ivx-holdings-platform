import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DurableStore } from './ivx-durable-store';
const originalFetch = globalThis.fetch;
const names = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
let env: Array<string | undefined>;
beforeEach(() => {
  env = names.map(name => process.env[name]);
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://durable-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  names.forEach((name, i) => { if (env[i] === undefined) delete process.env[name]; else process.env[name] = env[i]; });
});
describe('durable store outage handling', () => {
  it('does not bootstrap tables when PostgREST cannot query its schema cache', async () => {
    const methods: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      methods.push(String(init?.method));
      return Response.json({ code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, { status: 503 });
    }) as typeof fetch;
    await expect(new DurableStore().readJson('queue', { jobs: [] })).rejects.toThrow('DDL suppressed');
    expect(methods).toEqual(['GET']);
  });
  it('does not reload schema or replay writes on a schema-cache outage after startup', async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (url) => {
      paths.push(String(url));
      return paths.length === 1 ? Response.json([])
        : Response.json({ code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, { status: 503 });
    }) as typeof fetch;
    await expect(new DurableStore().writeJson('queue', { jobs: [] })).rejects.toThrow('Could not query');
    expect(paths).toHaveLength(2);
    expect(paths.some(url => url.includes('/rpc/'))).toBe(false);
  });
  it('rejects empty and malformed successful document reads instead of manufacturing an empty queue', async () => {
    for (const body of ['', '<html>upstream failure</html>', '{"message":"unavailable"}']) {
      let calls = 0;
      globalThis.fetch = (async () => ++calls === 1 ? Response.json([]) : new Response(body)) as typeof fetch;
      await expect(new DurableStore().readJson('queue', { jobs: [] })).rejects.toThrow('durable state was not replaced');
    }
  });
  it('uses the fallback only when the document query returns a valid empty array', async () => {
    globalThis.fetch = (async () => Response.json([])) as typeof fetch;
    expect(await new DurableStore().readJson('queue', { jobs: [] })).toEqual({ jobs: [] });
  });
});
