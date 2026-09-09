import test from 'node:test';
import assert from 'node:assert/strict';
import {recover} from './recover-orphaned-certificates.mjs';
const env={SUPABASE_ACCESS_TOKEN:'private',GITHUB_TOKEN:'private'};
function fixture({status='completed',http=200,mismatch=false}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('api.github.com'))return new Response(JSON.stringify({id:123,status,path:'.github/workflows/ivx-100-live-ai-worker-cert.yml',repository:{full_name:mismatch?'other/repo':'ibb142/ivx-holdings-platform'}}),{status:http});
  const q=JSON.parse(options.body);
  if(q.query.startsWith('select distinct'))return Response.json([{github_run:'123'}]);
  if(q.query.startsWith('with recovered'))return Response.json([{closed:2}]);
  return Response.json([{remaining:0}]);
 };
 return {calls,fetchImpl};
}
test('only terminal workflow orphans are closed with conditional failure and readback',async()=>{
 const f=fixture();assert.equal((await recover({...f,env,now:1800000000000})).closed,2);
 const writes=f.calls.filter(c=>c.url.includes('supabase')&&!JSON.parse(c.options.body).read_only);
 assert.equal(writes.length,1);
 const b=JSON.parse(writes[0].options.body);
 assert.match(b.query,/final_status='failed'/);assert.match(b.query,/final_status='running'/);
 assert.match(b.query,/started_at<\$2/);assert.match(b.query,/verified_output=false/);
 assert.deepEqual(b.parameters[2],['123']);
 assert.equal(b.parameters[1],new Date(1800000000000-900000).toISOString());
});
test('active workflows stay untouched',async()=>{
 const f=fixture({status:'in_progress'});assert.equal((await recover({...f,env})).closed,0);
 assert.equal(f.calls.length,2);
});
test('unverified workflow identity and permission failures cannot mutate rows',async()=>{
 for(const options of [{mismatch:true},{http:403}]){
  const f=fixture(options);await assert.rejects(recover({...f,env}));
  assert.equal(f.calls.length,2);
 }
});
