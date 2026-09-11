import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindOwnerRuntime } from './owner-runtime-binding.mjs';
const env = { SERVICE_ID:'srv-d7t9ivreo5us73ftose0', RENDER_API_KEY_RECOVERED:'fixture-render', IVX_OWNER_PASSWORD:'fixture-owner', OWNER_EMAIL:'owner@example.test', EXPO_PUBLIC_SUPABASE_URL:'https://kvclcdjmjghndxsngfzb.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon' };
function fixture({ authStatus=200, role='owner', email=env.OWNER_EMAIL, uncertain=false }={}) {
  const vars = new Map([['IVX_OWNER_PASSWORD','stale'],['OWNER_NEW_PASSWORD','stale'],['IVX_OWNER_EMAIL','stale@example.test'],['UNRELATED','retain-me']]);
  const calls=[];
  return { vars,calls,fetchImpl:async(url,init={})=>{
    calls.push({url,method:init.method||'GET'});
    if(url.includes('/auth/v1/token')) return Response.json({user:{id:'fixture-owner-id',email,app_metadata:{role}}},{status:authStatus});
    const key=decodeURIComponent(url.split('/').at(-1));
    assert.notEqual(key,'env-vars','Bulk replacement is forbidden');
    if(init.method==='PUT') { vars.set(key,JSON.parse(init.body).value); if(uncertain) throw Error('response lost after accepted write'); }
    return vars.has(key)?Response.json({key,value:vars.get(key)}):new Response(null,{status:404});
  }};
}
test('the verified password updates only the four runtime owner bindings',async()=>{
  const f=fixture();const result=await bindOwnerRuntime({env,fetchImpl:f.fetchImpl});
  assert.equal(result.ownerAuthenticated,true);assert.equal(result.changed,true);
  assert.equal(f.vars.get('IVX_OWNER_PASSWORD'),'fixture-owner');assert.equal(f.vars.get('OWNER_NEW_PASSWORD'),'fixture-owner');
  assert.equal(f.vars.get('IVX_OWNER_EMAIL'),env.OWNER_EMAIL);assert.equal(f.vars.get('UNRELATED'),'retain-me');
  assert.equal(f.vars.get('IVX_OWNER_PASSWORD_BASE64'),Buffer.from(env.IVX_OWNER_PASSWORD).toString('base64'));
  assert.equal(f.calls.filter(c=>c.method==='PUT').length,4);
  assert.equal(JSON.stringify(result).includes('fixture-owner'),false);
});
test('invalid credentials, wrong role and wrong owner never change Render',async()=>{
  for(const options of [{authStatus:400},{role:'member'},{email:'different@example.test'}]) {
    const f=fixture(options);await assert.rejects(bindOwnerRuntime({env,fetchImpl:f.fetchImpl}));
    assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
  }
});
test('equal bindings need no write or deployment',async()=>{
  const f=fixture();f.vars.set('IVX_OWNER_PASSWORD',env.IVX_OWNER_PASSWORD);f.vars.set('OWNER_NEW_PASSWORD',env.IVX_OWNER_PASSWORD);f.vars.set('IVX_OWNER_EMAIL',env.OWNER_EMAIL);
  f.vars.set('IVX_OWNER_PASSWORD_BASE64',Buffer.from(env.IVX_OWNER_PASSWORD).toString('base64'));
  const result=await bindOwnerRuntime({env,fetchImpl:f.fetchImpl});assert.equal(result.changed,false);assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
});
test('a lost write response is verified by readback without replaying the mutation',async()=>{
  const f=fixture({uncertain:true});const result=await bindOwnerRuntime({env,fetchImpl:f.fetchImpl});
  assert.equal(result.changed,true);assert.equal(f.calls.filter(c=>c.method==='PUT').length,4);
});
test('the legacy alias works and secrets never enter returned evidence',async()=>{
  const f=fixture();const result=await bindOwnerRuntime({env:{...env,IVX_OWNER_PASSWORD:'',OWNER_NEW_PASSWORD:'fixture-owner'},fetchImpl:f.fetchImpl});
  assert.equal(result.ownerAuthenticated,true);assert.equal(JSON.stringify(result).includes('fixture-owner'),false);
});
test('an uncertain write without matching readback cannot authorize deployment or another write',async()=>{
  const f=fixture();let writes=0;
  await assert.rejects(bindOwnerRuntime({env,fetchImpl:async(url,init)=>{
    if(init?.method==='PUT') { writes++;throw Error('lost response'); }
    return f.fetchImpl(url,init);
  }}),/not verified/);
  assert.equal(writes,1);
});
test('a rejected Render mutation stops immediately',async()=>{
  const f=fixture();let writes=0;
  await assert.rejects(bindOwnerRuntime({env,fetchImpl:async(url,init)=>{
    if(init?.method==='PUT') { writes++;return new Response(null,{status:403}); }
    return f.fetchImpl(url,init);
  }}),/HTTP 403/);
  assert.equal(writes,1);
});
test('the encoded transport preserves expansion characters without leaking either representation',async()=>{
  const password='Transport-$$-Pass!2026',f=fixture();
  const result=await bindOwnerRuntime({env:{...env,IVX_OWNER_PASSWORD:password},fetchImpl:f.fetchImpl});
  const encoded=f.vars.get('IVX_OWNER_PASSWORD_BASE64');
  assert.equal(Buffer.from(encoded,'base64').toString('utf8'),password);
  assert.equal(encoded.includes('$'),false);
  assert.equal(JSON.stringify(result).includes(password),false);
  assert.equal(JSON.stringify(result).includes(encoded),false);
});
