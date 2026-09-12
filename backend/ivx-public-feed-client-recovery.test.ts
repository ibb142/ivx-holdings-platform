import { afterEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { QueryClient } from '@tanstack/query-core';
import { fetchHomeFeed } from '../expo/lib/home-feed';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('expo-file-system/legacy', () => ({}));
mock.module('expo-sharing', () => ({}));
const videoClient = await import('../expo/lib/video-feed');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const unavailable = { blocks: [], videos: [], degraded: true, data_available: false, code: 'PUBLIC_DATA_UNAVAILABLE' };

function serve(payload: unknown, status = 200) {
  globalThis.fetch = (async () => Response.json(payload, { status })) as typeof fetch;
}

for (const [name, load] of [
  ['native Home', fetchHomeFeed], ['legacy Home', videoClient.fetchHomeFeed],
  ['native videos', videoClient.fetchVideoFeed], ['native Reels', videoClient.fetchProjectReels],
] as const) {
  test(`${name} rejects unavailable 200 responses and preserves real empty catalogs`, async () => {
    serve(unavailable);
    await expect(load()).rejects.toThrow(/unavailable/i);
    serve({ blocks: [], videos: [], code: 'PUBLIC_DATA_UNAVAILABLE' });
    await expect(load()).rejects.toThrow(/unavailable/i);
    serve({ blocks: [], videos: [], data_available: true, degraded: true });
    await expect(load()).resolves.toBeDefined();
    serve(null);
    await expect(load()).rejects.toThrow();
    serve({ error: 'unauthorized' }, 401);
    await expect(load()).rejects.toThrow(/401/);
  });
}

test('failed Home refresh retains the query cache; a later real empty catalog replaces it', async () => {
  const client = new QueryClient();
  const key = ['ivx-home-feed'];
  const existing = { blocks: [{ type: 'deal', deal: { id: 'published' } }] };
  client.setQueryData(key, existing);
  try {
    serve(unavailable);
    await expect(client.fetchQuery({ queryKey: key, queryFn: () => fetchHomeFeed(), retry: false, staleTime: 0 })).rejects.toThrow(/unavailable/i);
    expect(client.getQueryData(key)).toEqual(existing);
    serve({ blocks: [], data_available: true });
    expect(await client.fetchQuery({ queryKey: key, queryFn: () => fetchHomeFeed(), retry: false, staleTime: 0 })).toEqual({ blocks: [] });
    expect(client.getQueryData(key)).toEqual({ blocks: [] });
  } finally { client.clear(); }
});

function landingClient(name: 'home' | 'reels', responses: object[]) {
  const file = name === 'home' ? 'ivx-home-feed.js' : 'ivx-reels.js';
  const source = readFileSync(new URL(`../expo/ivxholding-landing/${file}`, import.meta.url), 'utf8');
  const start = name === 'home' ? '  function fetchHomeFeed(' : '  function apiFetchJson(';
  const end = name === 'home' ? '  /* ---------- lazy HLS' : '  function fetchFeedPage(';
  const calls: string[] = [];
  const context = vm.createContext({
    API: 'https://primary.example', API_CANDIDATES: ['https://primary.example', 'https://secondary.example'],
    window: { __ivxHomeFeedStatus: { attempts: 0 } }, AbortController, Date, Promise,
    setTimeout, clearTimeout, console: { warn() {} },
    fetch: async (url: string) => { calls.push(url); return Response.json(responses[Math.min(calls.length - 1, responses.length - 1)]); },
  });
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  return { calls, load: () => vm.runInContext(name === 'home' ? 'fetchHomeFeed(0)' : "apiFetchJson('/api/reels', 0, 4000)", context) };
}

for (const name of ['home', 'reels'] as const) {
  test(`landing ${name} retries unavailable JSON and accepts only a real catalog`, async () => {
    const catalog = { blocks: [{ type: 'deal' }], videos: [{ id: 'published' }], data_available: true };
    const client = landingClient(name, [unavailable, catalog]);
    expect(await client.load()).toEqual(catalog);
    expect(client.calls).toHaveLength(2);
    const outage = landingClient(name, [unavailable]);
    await expect(outage.load()).rejects.toThrow(/unavailable/i);
    expect(outage.calls).toHaveLength(2);
    const empty = landingClient(name, [{ blocks: [], videos: [], data_available: true }]);
    await expect(empty.load()).resolves.toBeDefined();
    expect(empty.calls).toHaveLength(1);
  });
}
