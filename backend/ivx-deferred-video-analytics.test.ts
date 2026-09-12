import { expect, test } from 'bun:test';

test('deferred analytics exposes only public counters and isolates failure', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    const a='00000000-0000-4000-8000-000000000001', hidden='00000000-0000-4000-8000-000000000002';
    let reads=0, unavailable=false, hanging=false;
    mock.module('@supabase/supabase-js',()=>({createClient:()=>({from:()=>{
      const q={select:()=>q,in:()=>q,eq:()=>q,then:resolve=>Promise.resolve({data:[{id:a},{id:hidden}],error:null}).then(resolve)};return q;
    }})}));
    const real=await import('./backend/services/ivx-video-platform-store');
    mock.module('./backend/services/ivx-video-platform-store',()=>({...real,
      getMetaDoc:async()=>({[a]:{status:'published'},[hidden]:{status:'draft'}}),
      getAnalyticsDoc:async()=>{reads++;if(hanging)return new Promise(()=>{});if(unavailable)throw Error('private failure');return {videos:{[a]:{views:12,viewer_ids:['private-viewer'],watch_ms:10}},history:{private:[]}};},
    }));
    const {handleDeferredVideoAnalytics}=await import('./backend/api/ivx-video-platform');
    const read=ids=>handleDeferredVideoAnalytics(new Request('https://example.test/api/videos/analytics?ids='+ids));
    assert.equal((await read('invalid')).status,400);assert.equal(reads,0);
    const r=await read(a+','+hidden);assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{videos:[{id:a,view_count:12}]});
    unavailable=true;const failure=await read(a);assert.equal(failure.status,200);
    assert.equal(failure.headers.get('cache-control'),'no-store');
    assert.deepEqual(await failure.clone().json(),{videos:[],degraded:true,data_available:false,code:'ANALYTICS_UNAVAILABLE'});
    assert.equal((await failure.text()).includes('private'),false);
    unavailable=false;hanging=true;const started=performance.now();
    const timed=await read(a);const elapsed=performance.now()-started;
    assert(elapsed>=2400 && elapsed<3500,'response must meet the 2.5s deadline');
    assert.equal(timed.status,200);assert.equal((await timed.json()).data_available,false);
  `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code, stderr).toBe(0);
});
