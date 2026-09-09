import {test} from 'node:test';
import assert from 'node:assert/strict';
import {run,primaryPoolSizes} from './supabase-pool-budget.mjs';
test('budgets only audited primary pool and never prints or rewrites credentials',async()=>{
  let size=15;const writes=[];
  await run(async(url,init)=>{
    assert.match(url,/^https:\/\/api\.supabase\.com\/v1\/projects\/kvclcdjmjghndxsngfzb\/config\/database\/pooler$/);
    if(init.method==='PATCH'){writes.push(JSON.parse(init.body));size=JSON.parse(init.body).default_pool_size;}
    return Response.json([{database_type:'PRIMARY',default_pool_size:size,connection_string:'secret-not-for-logs'}]);
  },'fixture');
  assert.deepEqual(writes,[{default_pool_size:5}]);
});
test('unknown or expanded configurations are rejected before mutation',async()=>{
  assert.throws(()=>primaryPoolSizes([]));
  let writes=0;
  await assert.rejects(run(async(url,init)=>{if(init.method==='PATCH')writes++;return Response.json([{database_type:'PRIMARY',default_pool_size:30}]);},'fixture'),/differs from audited/);
  assert.equal(writes,0);
});
