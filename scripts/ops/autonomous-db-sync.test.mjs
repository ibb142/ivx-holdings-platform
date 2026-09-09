import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import { candidates, connectionIssue, repairKnownConnection, main, readLinkedGroups, renderKey, validateConnection } from './autonomous-db-sync.mjs';
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
      if(u.pathname==='/v1/env-groups')return Response.json([]);
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

for (const status of [503,401]) test(`owner variable recovery is read-only and respects authorization: ${status}`,async()=>{
  const savedFetch=globalThis.fetch, savedLog=console.log;
  const keys=['RENDER_API_KEY','IVX_RENDER_API_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','JWT_SECRET'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  let managementCalls=0;
  try {
    for(const k of keys) delete process.env[k];
    Object.assign(process.env,{SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ACCESS_TOKEN:'test-management',JWT_SECRET:'test-encryption'});
    console.log=()=>{};
    const value='test-render-key', iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update('test-encryption').digest(),iv);
    cipher.setAAD(Buffer.from('ivx_owner_variables:v1'));
    const encrypted=Buffer.concat([cipher.update(value),cipher.final()]);
    globalThis.fetch=async(url,init)=>{
      if(new URL(url).hostname.endsWith('.supabase.co'))return new Response('',{status});
      assert.equal(url,'https://api.supabase.com/v1/projects/kvclcdjmjghndxsngfzb/database/query');
      assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer test-management');
      const body=JSON.parse(init.body);assert.equal(body.read_only,true);
      assert.equal(body.query,"SELECT encrypted_value, value_iv, value_tag, value_hash FROM public.ivx_owner_variables WHERE name = 'RENDER_API_KEY' LIMIT 2");
      managementCalls++;
      return Response.json([{encrypted_value:encrypted.toString('base64'),value_iv:iv.toString('base64'),value_tag:cipher.getAuthTag().toString('base64'),value_hash:crypto.createHash('sha256').update(value).digest('hex')}]);
    };
    if(status===401)await assert.rejects(renderKey(),/owner_variable_rest_access_failed/);
    else assert.equal(await renderKey(),value);
    assert.equal(managementCalls,status===401?0:1);
  } finally {
    globalThis.fetch=savedFetch;console.log=savedLog;
    for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];
  }
});

test('audits only groups linked to the target services without writing or logging values',async()=>{
  const savedFetch=globalThis.fetch, savedLog=console.log; const logs=[];let reads=0;
  const ownerId='tea-d7plj9beo5us73ch3ukg';
  const linked={id:'evg-test123',ownerId,serviceLinks:[{id:'srv-d9i15fg4n6ts73bn00j0'}]};
  try {
    console.log=value=>logs.push(value);
    globalThis.fetch=async(url,init)=>{
      assert.equal(init.method,undefined);
      if(new URL(url).pathname==='/v1/env-groups')return Response.json([{envGroup:linked},{envGroup:{id:'evg-other',ownerId,serviceLinks:[{id:'srv-other'}]}}]);
      assert.equal(new URL(url).pathname,'/v1/env-groups/evg-test123');reads++;
      return Response.json({...linked,envVars:[{key:'SUPABASE_DB_URL',value:valid}]});
    };
    const groups=await readLinkedGroups('test-key');
    assert.equal(reads,1);assert.equal(groups.length,1);assert.equal(groups[0].env.SUPABASE_DB_URL,valid);
    assert.ok(!logs.join('').includes('unit-test-only'));
  } finally {globalThis.fetch=savedFetch;console.log=savedLog;}
});

test('repairs only the observed base hostname and keeps credential validation enforced',()=>{
  const broken=valid.replace('db.kvclcdjmjghndxsngfzb.supabase.co','base');
  assert.equal(connectionIssue(broken),'invalid_base_hostname');
  assert.equal(repairKnownConnection(broken),valid);
  assert.equal(candidates({SUPABASE_DB_URL:broken})[1].value,valid);
  for(const v of [broken.replace('unit-test-only','[YOUR-PASSWORD]'),broken.replace('@base','@db.other.supabase.co'),broken+'?sslmode=disable',broken.replace('/postgres','/other')])assert.equal(repairKnownConnection(v),null);
  assert.equal(connectionIssue('https://example.com'),'not_postgres_uri');
  assert.equal(connectionIssue('postgresql://postgres@base/postgres'),'missing_database_credentials');
  assert.equal(connectionIssue(broken.replace('unit-test-only','[YOUR-PASSWORD]')),'placeholder_password');
});
