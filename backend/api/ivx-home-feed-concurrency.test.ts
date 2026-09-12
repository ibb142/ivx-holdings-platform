import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./ivx-video-platform.ts', import.meta.url), 'utf8');
const begin = source.indexOf('export async function handlePlatformHomeFeed');
const end = source.indexOf('\n/**', begin);
const handler = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(begin, end).replace('export async', 'async'));

async function run(failedSource?: string) {
  const started: string[] = [];
  let pending: Array<() => void> = [];
  let result: Response | undefined;
  const read = (name: string, value: unknown) => {
    started.push(name);
    return new Promise(resolve => pending.push(() => resolve(name === failedSource ? { error: { message: 'source unavailable' } } : value)));
  };
  const sb = { from: (table: string) => {
    const builder: any = {};
    for (const key of ['select', 'eq', 'order', 'limit']) builder[key] = () => builder;
    builder.then = (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
      read(table, { data: table === 'jv_deals' ? [{ id: 'published-deal', status: 'active' }] : [] }).then(resolve, reject);
    return builder;
  }};
  const context = { URL, Date, Response, Set, Map, Number, String,
    withFeedCache: (_: Request, work: () => Promise<Response>) => work(),
    getSB: async () => sb,
    getDealMetaDoc: () => read('deal-meta', {}),
    loadPlaybackIndex: () => read('playback', {}),
    getMetaDoc: () => read('video-meta', {}),
    getAnalyticsDoc: () => read('analytics', { videos: {} }),
    loadEngagementCounts: () => read('counts', {}),
    normalizeDealMeta: () => ({}), isDealMetaVisible: () => true,
    toHomeFeedDeal: (row: unknown) => row, sortHomeFeedDeals: (rows: unknown) => rows,
    normalizeVideoMeta: () => ({}), isMetaVisible: () => true,
    canonicalSort: (rows: unknown) => rows,
    composeInvestorFirstHome: (deals: unknown[]) => deals.map(deal => ({ type: 'deal', deal })),
    json: (value: unknown, status = 200) => Response.json(value, { status }),
    VIDEO_PLATFORM_MARKER: 'test',
  };
  vm.createContext(context);
  vm.runInContext(handler, context);
  const response = (context as any).handlePlatformHomeFeed(new Request('https://example.test/home-feed')).then((r: Response) => { result = r; });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  await flush();
  const initial = [...started].sort();
  let waves = 0;
  while (!result && waves < 5) {
    waves++;
    const batch = pending; pending = [];
    batch.forEach(finish => finish());
    await flush();
  }
  await response;
  return { initial, waves, response: result! };
}

test('home feed starts independent sources together and preserves real deal blocks', async () => {
  const r = await run();
  expect(r.initial).toEqual(['analytics', 'deal-meta', 'jv_deals', 'playback', 'project_videos', 'video-meta']);
  expect(r.waves).toBe(2);
  expect(r.response.status).toBe(200);
  const body = await r.response.json();
  expect(body.deal_count).toBe(1);
  expect(body.blocks[0].deal.id).toBe('published-deal');
});

test('home feed never reports an unavailable deal or video source as an empty success', async () => {
  for (const source of ['jv_deals', 'project_videos']) {
    const r = await run(source);
    expect(r.response.status).toBe(500);
    expect(await r.response.json()).toMatchObject({ error: 'source unavailable' });
  }
});
