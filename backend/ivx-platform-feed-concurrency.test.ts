import { expect, test } from 'bun:test';

test('real feed handler coalesces public reads and preserves each viewer and fresh publication state', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002';
    const hidden='00000000-0000-4000-8000-000000000003';
    const counts={catalog:0,meta:0,analytics:0,deals:0,media:0,profile:0};
    const metadata={ [a]:{video_type:'reel',display_order:1,creator_id:'creator-a'},
      [b]:{video_type:'reel',display_order:2}, [hidden]:{status:'draft',video_type:'reel'} };
    const rows={project_videos:[a,b,hidden].map(id=>({id,project_id:id,title:id,video_url:'https://media.example.test/'+id+'.mp4',
      is_approved:true,is_pinned:false,created_at:'2026-09-12T00:00:00Z',video_type:'reel'})),
      project_likes:[{project_id:a,guest_id:'guest-a'}], project_saves:[{project_id:b,guest_id:'guest-b'}],
      project_comments:[],project_shares:[],jv_deals:[]};
    let rejectCatalog=false;
    mock.module('@supabase/supabase-js',()=>({createClient:()=>({from:table=>{
      const filters=[];
      const q={select:()=>q,order:()=>q,limit:()=>q,
        eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},
        in:(key,values)=>{filters.push(row=>values.includes(row[key]));return q;},
        is:(key,value)=>{filters.push(row=>row[key]==value);return q;},
        then:(resolve,reject)=>Promise.resolve().then(async()=>{
          if(table==='project_videos') counts.catalog++;
          if(table==='jv_deals') counts.deals++;
          await new Promise(done=>setTimeout(done,15));
          if(table==='project_videos'&&rejectCatalog) return {data:null,error:{code:'57014',message:'private upstream detail'}};
          return {data:rows[table].filter(row=>filters.every(check=>check(row))),error:null};
        }).then(resolve,reject)};
      return q;
    }})}));
    const realStore=await import('./backend/services/ivx-video-platform-store');
    mock.module('./backend/services/ivx-video-platform-store',()=>({...realStore,
      getMetaDoc:async()=>{counts.meta++;return structuredClone(metadata);},
      getAnalyticsDoc:async()=>{counts.analytics++;return {videos:{},history:{}};},
      getFollowState:async viewer=>({following:viewer==='guest-a'?['creator-a']:[]}),
      getViewerProfile:async()=>{counts.profile++;throw Error('Unused viewer profile must not block canonical feed');}}));
    mock.module('./backend/services/ivx-video-pipeline',()=>({getPlaybackIndex:async()=>({})}));
    globalThis.fetch=async(url,init)=>{
      assert.equal(init.method,'HEAD'); assert.ok(String(url).startsWith('https://media.example.test/'));
      assert.ok(!String(url).includes(hidden),'Draft footage must not be probed');
      counts.media++;return new Response(null,{headers:{'content-type':'video/mp4'}});
    };
    const {handlePlatformFeed}=await import('./backend/api/ivx-video-platform');
    const read=viewer=>handlePlatformFeed(new Request('https://example.test/api/reels?type=reel&limit=2&viewer_id='+viewer));
    const responses=await Promise.all(Array.from({length:30},(_,i)=>read(i%2?'guest-b':'guest-a')));
    console.log(JSON.stringify({test:'feed-public-read-burst',requests:30,reads:counts}));
    for(let i=0;i<responses.length;i++) {
      const response=responses[i];assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      const body=await response.json(); assert.deepEqual(body.videos.map(video=>video.id),[a,b]);
      assert.equal(body.videos[0].viewer_liked,i%2===0);
      assert.equal(body.videos[1].viewer_saved,i%2===1);
      assert.equal(body.videos[0].viewer_following_creator,i%2===0);
      assert.equal(body.videos[0].like_count,1);assert.equal(body.videos[1].save_count,1);
    }
    assert.deepEqual(counts,{catalog:1,meta:1,analytics:1,deals:1,media:2,profile:0});
    metadata[a].status='draft'; rows.project_saves=[];
    const fresh=await read('guest-b');assert.equal(fresh.status,200);
    const body=await fresh.json();assert.deepEqual(body.videos.map(video=>video.id),[b]);
    assert.equal(body.videos[0].viewer_saved,false);assert.equal(body.videos[0].save_count,0);
    assert.equal(counts.catalog,2);assert.equal(counts.meta,2);
    rejectCatalog=true;
    const unavailable=await read('guest-b');assert.equal(unavailable.status,503);
    const failure=await unavailable.text();assert.equal(failure.includes('private upstream detail'),false);
    assert.equal(failure.includes('"videos"'),false);
    rejectCatalog=false;assert.equal((await read('guest-b')).status,200);
  `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
  const [code, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
  if (stdout.trim()) console.info(stdout.trim());
  expect(code, stderr).toBe(0);
}, 20000);

test('home and Reels share pending public reads while preserving deal ordering and attachment', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    const video='00000000-0000-4000-8000-000000000001';
    const unrelated='00000000-0000-4000-8000-000000000002';
    const calls={catalog:0,meta:0,analytics:0,playback:0,dealMeta:0};
    let releaseDeals;
    const dealGate=new Promise(resolve=>{releaseDeals=resolve;});
    let rejectDeals=false;
    const metadata={ [video]:{video_type:'reel',is_featured:true,property_id:'deal-a'},
      [unrelated]:{video_type:'reel',is_featured:true} };
    const rows={project_videos:[video,unrelated].map(id=>({id,project_id:id,title:'Project update '+id,
      video_url:'https://media.example.test/'+id+'.mp4',is_approved:true,is_pinned:false,
      created_at:'2026-09-12T00:00:00Z',video_type:'reel'})),
      jv_deals:[['deal-c',3],['deal-a',1],['deal-b',2]].map(([id,order])=>({id,title:id,project_name:id,
        published:true,status:'active',display_order:order,total_investment:100,photos:[],created_at:'2026-09-12T00:00:00Z'})),
      project_likes:[],project_saves:[],project_comments:[],project_shares:[]};
    mock.module('@supabase/supabase-js',()=>({createClient:()=>({from:table=>{
      const filters=[];
      const q={select:()=>q,order:()=>q,limit:()=>q,
        eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},
        in:(key,values)=>{filters.push(row=>values.includes(row[key]));return q;},
        is:(key,value)=>{filters.push(row=>row[key]==value);return q;},
        then:(resolve,reject)=>Promise.resolve().then(async()=>{
          if(table==='project_videos') calls.catalog++;
          if(table==='jv_deals') {
            await dealGate;
            if(rejectDeals) return {data:null,error:{code:'57014',message:'private deal query detail'}};
          }
          return {data:rows[table].filter(row=>filters.every(check=>check(row))),error:null};
        }).then(resolve,reject)};
      return q;
    }})}));
    const realStore=await import('./backend/services/ivx-video-platform-store');
    mock.module('./backend/services/ivx-video-platform-store',()=>({...realStore,
      getMetaDoc:async()=>{calls.meta++;return structuredClone(metadata);},
      getAnalyticsDoc:async()=>{calls.analytics++;return {videos:{},history:{}};},
      getDealMetaDoc:async()=>{calls.dealMeta++;return {};}}));
    mock.module('./backend/services/ivx-video-pipeline',()=>({getPlaybackIndex:async()=>{calls.playback++;return {};}}));
    globalThis.fetch=async(url,init)=>{
      assert.equal(init.method,'HEAD');assert.ok(String(url).startsWith('https://media.example.test/'));
      return new Response(null,{headers:{'content-type':'video/mp4'}});
    };
    const {handlePlatformFeed,handlePlatformHomeFeed}=await import('./backend/api/ivx-video-platform');
    const homePromise=handlePlatformHomeFeed(new Request('https://example.test/api/ivx/video-platform/home-feed?limit=60'));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.deepEqual(calls,{catalog:1,meta:1,analytics:1,playback:1,dealMeta:1},
      'Home must start all independent sources while deal reads are still pending');
    const reelPromise=handlePlatformFeed(new Request('https://example.test/api/reels?type=reel'));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(calls.catalog,1,'Reels must reuse the pending home catalog');
    assert.equal(calls.meta,1);assert.equal(calls.analytics,1);assert.equal(calls.playback,1);
    releaseDeals();
    const [home,reels]=await Promise.all([homePromise,reelPromise]);
    assert.equal(home.status,200);assert.equal(reels.status,200);
    const body=await home.json();
    assert.equal(body.pattern,'3-deals-1-featured-project-video');
    assert.deepEqual(body.blocks.filter(block=>block.type==='deal').map(block=>block.deal.id),['deal-a','deal-b','deal-c']);
    assert.equal(body.video_count,1,'Unattached featured video must not enter the home feed');
    assert.equal(body.blocks[3].video.id,video);
    assert.equal(body.blocks[3].video.deal.id,'deal-a');
    assert.equal(body.personalized,false);
    metadata[video].status='draft';
    const fresh=await handlePlatformHomeFeed(new Request('https://example.test/api/ivx/video-platform/home-feed?limit=59'));
    assert.equal(fresh.status,200);assert.equal((await fresh.json()).video_count,0,'Fresh publication controls must still hide drafts');
    rejectDeals=true;
    const failed=await handlePlatformHomeFeed(new Request('https://example.test/api/ivx/video-platform/home-feed?limit=58'));
    assert.equal(failed.status,503);assert.equal((await failed.text()).includes('private deal query detail'),false);
    console.log(JSON.stringify({test:'home-and-reels-shared-inputs',passed:true,ordering:true,attachment:true,publication:true,failureStatus:503}));
  `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
  const [code, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
  if (stdout.trim()) console.info(stdout.trim());
  expect(code, stderr).toBe(0);
}, 20000);
