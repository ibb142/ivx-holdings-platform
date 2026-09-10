import {test} from 'node:test';
import assert from 'node:assert/strict';
import {run,primaryPoolSizes} from './supabase-pool-budget.mjs';
test('budgets only audited primary pool and never prints or rewrites credentials',async()=>{
  let size=15;const writes=[];
  await run(async(url,init)=>{
    assert.equal(url,'https://api.supabase.com/v1/projects/kvclcdjmjghndxsngfzb/config/database/'+(init.method==='PATCH'?'pooler':'pgbouncer'));
    if(init.method==='PATCH'){writes.push(JSON.parse(init.body));size=JSON.parse(init.body).default_pool_size;}
    return Response.json({default_pool_size:size,connection_string:'secret-not-for-logs'});
  },'fixture');
  assert.deepEqual(writes,[{default_pool_size:5}]);
});
test('unknown or expanded configurations are rejected before mutation',async()=>{
  assert.throws(()=>primaryPoolSizes([]));
  let writes=0;
  await assert.rejects(run(async(url,init)=>{if(init.method==='PATCH')writes++;return Response.json([{database_type:'PRIMARY',default_pool_size:30}]);},'fixture'),/differs from audited/);
  assert.equal(writes,0);
});

test('configuration defaults and missing metadata remain distinguishable',()=>{
  assert.deepEqual(primaryPoolSizes({default_pool_size:null}),[15]);
  assert.deepEqual(primaryPoolSizes({default_pool_size:5}),[5]);
  assert.throws(()=>primaryPoolSizes({connection_string:'not-a-size'}));
});

test('configuration diagnostics never serialize credentials or unknown values', async () => {
  const {poolConfigurationShape}=await import('./supabase-pool-budget.mjs');
  const result=JSON.stringify(poolConfigurationShape({connection_string:'SECRET',default_pool_size:'SECRET',password:'SECRET'}));
  assert.equal(result.includes('SECRET'),false);
  assert.equal(JSON.parse(result).entries[0].poolSizeType,'string');
});

test('omitted documented compute default requires live capacity proof and explicit post-write readback',async()=>{
  for(const max of [60,90]){
    let patched=false;
    const f=async(url,options)=>{
      if(url.endsWith('/database/query')){
        assert.equal(JSON.parse(options.body).read_only,true);
        return Response.json([{max_connections:max}]);
      }
      if(options.method==='PATCH'){patched=true;return Response.json({});}
      return Response.json(patched?{default_pool_size:5}:{pool_mode:'transaction',server_idle_timeout:600});
    };
    if(max===60)await run(f,'private');
    else await assert.rejects(run(f,'private'),/Compute default cannot be verified/);
    assert.equal(patched,max===60);
  }
});
