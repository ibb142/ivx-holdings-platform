import { expect, test } from 'bun:test';

test('112-lane manager patrol reads one planning index and no evidence ledger', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import { mock } from 'bun:test';
    let reads=0;
    const tasks=Array.from({length:224},(_,i)=>({taskId:'t'+i,idempotencyKey:'existing:'+i,
      assignedAgentNumber:Math.floor(i/2)+1,state:'QUEUED',title:'Existing real work'}));
    mock.module('./backend/services/ivx-postgres-autonomous-task-store.ts',()=>({
      postgresAtomicQueueSelected:()=>true,
      readPostgresAutonomousTaskIndex:async()=>{reads++;return tasks;}
    }));
    mock.module('./backend/services/ivx-autonomous-task-engine.ts',()=>({
      IN_PROGRESS_STATES:['QUEUED','RUNNING'],
      createObjective:async()=>({ok:true,objective:{objectiveId:'existing-objective'}}),
      linkOrphanTasksToObjective:async()=>({ok:true,linked:0}),
      createTask:async()=>{throw Error('existing backlog must not be recreated');},
      getAllTasks:async()=>{throw Error('full evidence ledger read');}
    }));
    mock.module('./backend/services/ivx-agent-real-engineering-cycle.ts',()=>({
      moduleInspectionCriteria:()=>{throw Error('existing backlog must not be recreated');},
      scanModuleUniverse:async()=>{throw Error('existing backlog must be used');}
    }));
    const m=await import('./backend/services/ivx-autonomous-work-manager.ts');
    const result=await m.ensureAutonomousManagerBacklog({
      sourceSha:'a'.repeat(40),
      agents:Array.from({length:112},(_,i)=>({agentId:'ivx_holdings_'+(i+1),agentNumber:i+1}))
    });
    if(!result.ok || result.existing!==112 || reads!==1)throw Error(JSON.stringify({result,reads}));
  `], {cwd: new URL('../../', import.meta.url).pathname, stdout:'pipe',stderr:'pipe',timeout:10000});
  const [exitCode, stderr] = await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
});

test('planning index paginates identities without hydrating evidence payloads', async () => {
  const child = Bun.spawn([process.execPath,'-e',`
    import {mock} from 'bun:test';
    import { EventEmitter } from 'node:events';
    let reads=0;
    mock.module('pg',()=>({Client:class {},Pool:class extends EventEmitter {
      async query(sql,values) {
        reads++;
        if(sql.includes('select payload ') || !sql.includes("payload->>'title'"))throw Error('full payload requested');
        const [offset,limit]=values;
        return {rows:Array.from({length:Math.min(limit,10224-offset)},(_,i)=>({
          task_id:'t'+(offset+i),idempotency_key:'key'+(offset+i),
          assigned_agent_number:(offset+i)%112+1,state:'QUEUED',title:'Existing task'
        }))};
      }
    }}));
    process.env.EXPO_PUBLIC_SUPABASE_URL='https://testproject.supabase.co';
    process.env.SUPABASE_DB_URL='postgresql://postgres.testproject:test@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    const m=await import('./backend/services/ivx-postgres-autonomous-task-store.ts');
    const rows=await m.readPostgresAutonomousTaskIndex();
    if(rows.length!==10224 || reads!==11 || rows[10223].taskId!=='t10223')throw Error('incomplete history');
    if(Object.keys(rows[0]).length!==5)throw Error('unbounded payload');
  `],{cwd:new URL('../../',import.meta.url).pathname,stdout:'pipe',stderr:'pipe',timeout:10000});
  const [exitCode,stderr]=await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
});
