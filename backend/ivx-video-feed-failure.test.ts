import { expect, test } from 'bun:test';

test('feed exceptions remain unavailable and cannot poison the cache as empty success', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    let mode='throw', reads=0, clock=Date.now();
    Date.now=()=>clock;
    mock.module('@supabase/supabase-js',()=>({createClient:()=>({from:()=>{
      reads++;
      if(mode==='throw') throw new Error('synthetic-private-detail');
      const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,in:()=>q,is:()=>q,
        then:resolve=>Promise.resolve({data:[]}).then(resolve)};
      return q;
    }})}));
    const realStore=await import('./backend/services/ivx-video-platform-store');
    mock.module('./backend/services/ivx-video-platform-store',()=>({...realStore,
      getMetaDoc:async()=>({}), getAnalyticsDoc:async()=>({}), getDealMetaDoc:async()=>({})}));
    mock.module('./backend/services/ivx-video-pipeline',()=>({getPlaybackIndex:async()=>({})}));
    const {handlePlatformFeed,handlePlatformHomeFeed}=await import('./backend/api/ivx-video-platform');
    for(const [name,handler] of [['feed',handlePlatformFeed],['home-feed',handlePlatformHomeFeed]]) {
      mode='throw';
      const req=new Request('https://example.com/api/'+name);
      const failed=await Promise.all([handler(req),handler(req)]);
      for(const response of failed) {
        assert.equal(response.status,503,name);
        assert.equal(response.headers.get('cache-control'),'no-store');
        const text=await response.text();
        assert.equal(text.includes('synthetic-private-detail'),false);
        const body=JSON.parse(text);
        assert.ok(body.error);
        assert.equal('videos' in body || 'blocks' in body || 'count' in body,false);
      }
      const before=reads; mode='empty';
      const restored=await handler(req);
      assert.equal(restored.status,200,name);
      assert.ok(reads>before,'A failure must not be reused as a successful empty cache entry');
      assert.equal((await restored.json()).count,0,'An actually empty upstream collection remains authoritative');
      mode='throw'; clock+=31000;
      const recent=await handler(req);
      assert.equal(recent.status,200,'A recent successful response can cover a transient failure');
      clock+=60001;
      const expired=await handler(req);
      assert.equal(expired.status,503,'Recovery cannot indefinitely extend old publication state');
      assert.equal(expired.headers.get('cache-control'),'no-store');
    }
  `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exit, stderr).toBe(0);
}, 20000);
