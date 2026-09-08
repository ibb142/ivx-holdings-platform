import { expect, test } from 'bun:test';
import { updateRenderReplicas } from './ivx-render-replicas';
test('bounded scaling verifies the repository and absence of disks before the mutation', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    if (url.includes('/disks?')) return Response.json([]);
    if (url.endsWith('/scale')) { expect(JSON.parse(String(init.body))).toEqual({ numInstances: 2 }); return new Response(null, { status: 202 }); }
    return Response.json({ repo: 'https://github.com/ibb142/ivx-holdings-platform', branch: 'main', type: 'background_worker', serviceDetails: { numInstances: 1 } });
  }) as typeof fetch;
  expect((await updateRenderReplicas({ serviceId: 'srv-test', numInstances: 2 }, {}, fetcher)).liveVerified).toBe(false);
  expect(calls.filter(c => c.startsWith('POST'))).toHaveLength(1);
  expect(calls[2]).toBe('POST https://api.render.com/v1/services/srv-test/scale');
});
test('does not mutate for foreign repositories, attached disks or excessive counts', async () => {
  for (const blocked of ['repo', 'disk', 'count']) {
    let mutations = 0;
    const fetcher = (async (url: string, init: RequestInit) => {
      if (init.method === 'POST') mutations++;
      return Response.json(url.includes('/disks?') ? blocked === 'disk' ? [{ id: 'disk' }] : [] : {
        repo: blocked === 'repo' ? 'https://github.com/another/repo' : 'https://github.com/ibb142/ivx-holdings-platform',
        branch: 'main', type: 'web_service', serviceDetails: { numInstances: 1 },
      });
    }) as typeof fetch;
    await expect(updateRenderReplicas({ serviceId: 'srv-test', numInstances: blocked === 'count' ? 50 : 2 }, {}, fetcher)).rejects.toThrow();
    expect(mutations).toBe(0);
  }
});
