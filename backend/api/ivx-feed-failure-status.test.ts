import { expect, test } from 'bun:test';

test('both shipped feed handlers return 503 on dependency failure without an empty success catalog', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import {mock} from 'bun:test';
    import {strict as assert} from 'node:assert';
    mock.module('@supabase/supabase-js',()=>({createClient:()=>{throw Error('DATABASE_PRESSURE');}}));
    globalThis.fetch=async()=>{throw Error('No production network allowed');};
    const {handlePlatformFeed,handlePlatformHomeFeed}=await import('./backend/api/ivx-video-platform.ts');
    for(const handler of [handlePlatformFeed,handlePlatformHomeFeed]) {
      const response=await handler(new Request('https://api.example.test/'+handler.name));
      assert.equal(response.status,503);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
      assert.equal(response.headers.get('Retry-After'),'3');
      const body=await response.json();
      assert.equal(body.code,'FEED_UNAVAILABLE');
      assert.equal(body.videos,undefined);
    }
  `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(stderr || 'Feed handler child failed');
  expect(code).toBe(0);
});
