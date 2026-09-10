import { expect, test } from 'bun:test';

async function isolated(code: string) {
  const child = Bun.spawn([process.execPath, '-e', code], {cwd: new URL('../', import.meta.url).pathname, stdout:'pipe', stderr:'pipe', timeout:10000});
  const [exit, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exit, err).toBe(0);
}

test('public deals coalesce concurrent reads, fail visibly, and recover without stale publications', async () => {
  await isolated(`
    import { mock } from 'bun:test';
    let calls=0, mediaCalls=0, mode='fail', seenSignal;
    mock.module('@supabase/supabase-js',()=>({createClient:()=>({from:table=>{
      if(table==='jv_deals')calls++;else mediaCalls++;
      const filters=[];
      const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q},in:()=>q,order:()=>q,limit:()=>q,abortSignal:signal=>{
        seenSignal=signal;
        if(table==='jv_deal_reels') {
          for(const [key,value] of [['published',true],['approved',true],['visibility','public']])if(!filters.some(f=>f[0]===key&&f[1]===value))throw Error('private reel filter missing');
          return Promise.resolve({data:[{id:'reel',project_id:'perez-residence-001',video_url:'https://cdn.example/property.mp4'},{id:'unrelated',project_id:'other-property',video_url:'https://cdn.example/other.mp4'}]});
        }
        return new Promise(resolve=>setTimeout(()=>resolve(mode==='fail'?{error:{message:'upstream timeout'}}:{data:mode==='empty'?[]:[{id:'perez-residence-001'}],count:mode==='empty'?0:1}),20));
      }};return q;
    }})}));
    const {handleJVDealsList}=await import('./backend/api/ivx-public-features');
    const request=new Request('https://example.com/api/deals');
    const responses=await Promise.all(Array.from({length:12},()=>handleJVDealsList(request)));
    if(calls!==1||!seenSignal||responses.some(r=>r.status!==503))throw Error('concurrency/failure semantics');
    for(const r of responses){const b=await r.json();if(b.deals||b.count===0)throw Error('failure presented as empty content');}
    mode='ok';const ok=await handleJVDealsList(request);const body=await ok.json();if(ok.status!==200||body.count!==1||calls!==2||mediaCalls!==1)throw Error('recovery failed');
    if(body.deals[0].videos.length!==1||body.deals[0].videos[0].id!=='reel')throw Error('published deal video missing or cross-mapped');
    mode='empty';const empty=await handleJVDealsList(request);if((await empty.json()).count!==0||calls!==3)throw Error('unpublished content retained');
  `);
});

test('inspection uses verified CA despite URL sslmode and keeps read-only transaction', async () => {
  await isolated(`
    import {mock} from 'bun:test';
    let config, released=false;const sql=[];
    process.env.SUPABASE_INSPECTION_DATABASE_URL='postgres://postgres:example@db.example.supabase.co/postgres?sslmode=require';
    mock.module('./backend/api/owner-only',()=>({assertIVXOwnerOnly:()=>{},ownerOnlyJson:()=>{},ownerOnlyOptions:()=>{}}));
    mock.module('pg',()=>({Pool:class{constructor(c){config=c;}async connect(){return {query:async text=>{sql.push(text);return {rows:[]}},release:()=>{released=true}}}async end(){}}}));
    const {inspectSupabaseTables}=await import('./backend/api/ivx-supabase-inspection');
    await inspectSupabaseTables('public',null,5);
    if(config.connectionString.includes('sslmode')||config.ssl.rejectUnauthorized!==true||!config.ssl.ca.length||config.max!==1)throw Error('unverified or oversized pool');
    if(sql[0]!=='BEGIN READ ONLY'||sql.at(-1)!=='COMMIT'||!released)throw Error('transaction protection changed');
  `);
});
