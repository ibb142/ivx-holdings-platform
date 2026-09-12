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

for (const scenario of ['overlapping callers', 'independent dependencies']) {
  test(`deferred analytics bounds database work: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import assert from 'node:assert/strict';
      import { mock } from 'bun:test';
      const scenario = ${JSON.stringify(scenario)};
      const a='00000000-0000-4000-8000-00000000000a', hidden='00000000-0000-4000-8000-00000000000b';
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const reads = { catalog:0, metadata:0, analytics:0 };
      mock.module('@supabase/supabase-js',()=>({createClient:()=>({from:()=>{
        const q={select:()=>q,in:()=>q,eq:()=>q,then:(resolve,reject)=>{
          reads.catalog++;
          return gate.then(()=>({data:[{id:a},{id:hidden}],error:null})).then(resolve,reject);
        }};return q;
      }})}));
      const real=await import('./backend/services/ivx-video-platform-store');
      mock.module('./backend/services/ivx-video-platform-store',()=>({...real,
        getMetaDoc:async()=>{reads.metadata++;await gate;return {[a]:{status:'published'},[hidden]:{status:'draft'}};},
        getAnalyticsDoc:async()=>{reads.analytics++;return {videos:{[a]:{views:12,viewer_ids:['private-viewer']}},history:{private:[]}};},
      }));
      const {handleDeferredVideoAnalytics}=await import('./backend/api/ivx-video-platform');
      const count=scenario==='overlapping callers'?30:1;
      const requests=Array.from({length:count},(_,i)=>handleDeferredVideoAnalytics(new Request(
        'https://example.test/api/videos/analytics?ids='+encodeURIComponent(i%2?hidden+','+a.toUpperCase()+','+a:a+','+hidden))));
      const outcomes=Promise.all(requests);
      await new Promise(resolve=>setImmediate(resolve));
      const beforeRelease={...reads};
      release();
      const responses=await outcomes;
      if(scenario==='overlapping callers') {
        assert.equal(beforeRelease.catalog,1,'Equivalent ID sets must issue one catalog read');
        assert.equal(reads.metadata,2,'The shared operation warms metadata, then rechecks publication once');
        assert.equal(reads.analytics,1,'Analytics must be shared across the aggregate operation');
      } else assert.equal(beforeRelease.analytics,1,'Independent analytics must start before the catalog and metadata finish');
      for(const response of responses) {
        assert.equal(response.status,200);
        assert.deepEqual(await response.json(),{videos:[{id:a,view_count:12}]});
      }
      console.log(JSON.stringify({scenario,reads,passed:true}));
    `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (out.trim()) console.info(out.trim());
    expect(code, err).toBe(0);
  });
}

for (const scenario of ['scope and publication', 'publication during shared read', 'failed read recovery']) {
  test(`deferred analytics preserves ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import assert from 'node:assert/strict';
      import { mock } from 'bun:test';
      const scenario=${JSON.stringify(scenario)};
      const a='00000000-0000-4000-8000-00000000000a', b='00000000-0000-4000-8000-00000000000b';
      let release, failed=scenario==='failed read recovery';
      const gate=new Promise(resolve=>{release=resolve;});
      let catalogReads=0, analyticsReads=0;
      const meta={[a]:{status:'published'},[b]:{status:'published'}};
      const stats={videos:{[a]:{views:12},[b]:{views:21}},history:{private:[]}};
      mock.module('@supabase/supabase-js',()=>({createClient:()=>({from:()=>{
        let ids;
        const q={select:()=>q,in:(_column,values)=>{ids=values;return q;},eq:()=>q,then:(resolve,reject)=>{
          catalogReads++;
          return Promise.resolve({data:ids.map(id=>({id})),error:failed?new Error('private database detail'):null}).then(resolve,reject);
        }};return q;
      }})}));
      const real=await import('./backend/services/ivx-video-platform-store');
      mock.module('./backend/services/ivx-video-platform-store',()=>({...real,
        getMetaDoc:async()=>structuredClone(meta),
        getAnalyticsDoc:async()=>{analyticsReads++;await gate;return structuredClone(stats);},
      }));
      const {handleDeferredVideoAnalytics}=await import('./backend/api/ivx-video-platform');
      const read=ids=>handleDeferredVideoAnalytics(new Request('https://example.test/api/videos/analytics?ids='+ids));
      if(scenario==='scope and publication') {
        const first=read(a), second=read(b);
        await new Promise(resolve=>setImmediate(resolve));release();
        assert.deepEqual(await (await first).json(),{videos:[{id:a,view_count:12}]});
        assert.deepEqual(await (await second).json(),{videos:[{id:b,view_count:21}]});
        assert.equal(catalogReads,2);
        meta[a].status='draft';stats.videos[b].views=42;
        assert.deepEqual(await (await read(a+','+b)).json(),{videos:[{id:b,view_count:42}]});
        assert.equal(catalogReads,3,'Completed aggregate data cannot hide a publication change');
      } else if(scenario==='publication during shared read') {
        const first=read(a);
        await new Promise(resolve=>setImmediate(resolve));
        meta[a].status='draft';
        const second=read(a);
        release();
        for(const response of await Promise.all([first,second])) {
          assert.equal(response.status,200);
          assert.deepEqual(await response.json(),{videos:[]},'A publication change during slow counters must still hide the video');
        }
        assert.equal(catalogReads,1);assert.equal(analyticsReads,1);
      } else {
        const first=read(a);
        await new Promise(resolve=>setImmediate(resolve));
        const second=read(a);
        await new Promise(resolve=>setImmediate(resolve));
        const beforeRelease={catalogReads,analyticsReads};release();
        for(const response of await Promise.all([first,second])) {
          assert.equal(response.status,200);
          assert.deepEqual(await response.json(),{videos:[],degraded:true,data_available:false,code:'ANALYTICS_UNAVAILABLE'},'A database failure must remain explicitly unavailable');
        }
        assert.deepEqual(beforeRelease,{catalogReads:1,analyticsReads:1},'An early failure cannot release a still-running source');
        failed=false;stats.videos[a].views=18;
        assert.deepEqual(await (await read(a)).json(),{videos:[{id:a,view_count:18}]});
        assert.equal(catalogReads,2);assert.equal(analyticsReads,2);
      }
      console.log(JSON.stringify({scenario,catalogReads,analyticsReads,passed:true}));
    `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (out.trim()) console.info(out.trim());
    expect(code, err).toBe(0);
  });
}
