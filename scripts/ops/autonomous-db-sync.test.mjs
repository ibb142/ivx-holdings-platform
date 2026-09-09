import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { candidates, main, validateConnection } from './autonomous-db-sync.mjs';
const valid='postgresql://postgres:unit-test-only@db.kvclcdjmjghndxsngfzb.supabase.co/postgres';
test('rejects invalid hosts, other projects and disabled TLS',()=>{
  for(const v of ['postgresql://postgres:x@base/postgres','postgresql://postgres:x@db.other.supabase.co/postgres',valid+'?sslmode=disable']) assert.equal(validateConnection(v),null);
  assert.equal(validateConnection(valid).ssl.rejectUnauthorized,true);
});
test('constructs a connection only from an explicit Supabase password and encodes reserved characters',()=>{
  assert.equal(candidates({}).length,0);
  const c=candidates({SUPABASE_DB_PASSWORD:'a@b#c'});
  assert.equal(validateConnection(c[0].value).password,'a@b#c');
});
for(const probeFails of [true,false]) test(`sync requires a real successful probe: probeFails=${probeFails}`,async()=>{
  const savedFetch=globalThis.fetch, SavedClient=pg.Client, savedKey=process.env.RENDER_API_KEY;
  const savedLog=console.log;
  const envs=new Map(); let puts=0, closed=0;
  const api='srv-d7t9ivreo5us73ftose0', worker='srv-d9i15fg4n6ts73bn00j0';
  envs.set(api,{SUPABASE_DB_URL:valid,UNRELATED:'preserved'});envs.set(worker,{UNRELATED:'preserved'});
  try {
    console.log=()=>{};
    process.env.RENDER_API_KEY='unit-test-render-key';
    pg.Client=class {
      on(){}
      async connect(){ if(probeFails) throw new Error('test unavailable'); }
      async query(sql,args){assert.match(sql,/^SELECT active/);assert.deepEqual(args,['emergency_stop']);return {rows:[{active:false}]};}
      async end(){closed++;}
    };
    globalThis.fetch=async(url,init)=>{
      const u=new URL(url); assert.equal(u.hostname,'api.render.com');
      const id=u.pathname.split('/')[3];assert.ok(envs.has(id));
      if(init.method==='PUT') {
        assert.equal(id,worker);assert.ok(u.pathname.endsWith('/env-vars/SUPABASE_DB_URL'));
        envs.get(id).SUPABASE_DB_URL=JSON.parse(init.body).value;puts++;
        return Response.json({});
      }
      if(u.pathname.endsWith('/env-vars'))return Response.json(Object.entries(envs.get(id)).map(([key,value])=>({envVar:{key,value}})));
      return Response.json({ownerId:'tea-d7plj9beo5us73ch3ukg',repo:'https://github.com/ibb142/ivx-holdings-platform'});
    };
    if(probeFails) await assert.rejects(main(),/no_verified_same_project/); else await main();
    assert.equal(puts,probeFails?0:1);assert.equal(closed,1);
    assert.equal(envs.get(worker).UNRELATED,'preserved');
  } finally {
    globalThis.fetch=savedFetch;pg.Client=SavedClient;console.log=savedLog;
    if(savedKey===undefined)delete process.env.RENDER_API_KEY;else process.env.RENDER_API_KEY=savedKey;
  }
});
