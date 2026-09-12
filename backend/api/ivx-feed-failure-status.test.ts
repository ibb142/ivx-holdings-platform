import { expect, test } from 'bun:test';

test('both shipped feed handlers mark render fallback unavailable on dependency failure', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import {mock} from 'bun:test';
    import {strict as assert} from 'node:assert';
    mock.module('@supabase/supabase-js',()=>({createClient:()=>{throw Error('DATABASE_PRESSURE');}}));
    globalThis.fetch=async()=>{throw Error('No production network allowed');};
    const {handlePlatformFeed,handlePlatformHomeFeed}=await import('./backend/api/ivx-video-platform.ts');
    for(const handler of [handlePlatformFeed,handlePlatformHomeFeed]) {
      const home=handler===handlePlatformHomeFeed;
      const response=await handler(new Request('https://api.example.test/api/ivx/video-platform/'+(home?'home-feed':'feed')));
      assert.equal(response.status,200);assert.equal(response.headers.get('X-IVX-Data-State'),'unavailable');
      assert.equal(response.headers.get('Cache-Control'),'no-store');
      assert.equal(response.headers.get('Retry-After'),'3');
      const body=await response.json();
      assert.equal(body.code,'PUBLIC_DATA_UNAVAILABLE');
      assert.equal(body.degraded,true);assert.equal(body.data_available,false);assert.deepEqual(body[home?'blocks':'videos'],[]);
    }
  `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(stderr || 'Feed handler child failed');
  expect(code).toBe(0);
});
