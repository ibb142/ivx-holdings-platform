import { expect, test } from 'bun:test';

for (const fails of [false, true]) test(`configured same-project queue selects one direct transport; fails=${fails}`, async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { EventEmitter } from 'node:events';
    let queries=0, restCalls=0, releases=0; const boundaries=[];
    mock.module('pg',()=>({Client:class {},Pool:class extends EventEmitter {
      constructor(config) {
        super();
        if(config.ssl.rejectUnauthorized!==true || !config.ssl.ca?.length)throw new Error('TLS not verified');
        if(config.connectionString.includes('sslmode'))throw new Error('URL overrides TLS');
        if(config.connectionTimeoutMillis!==20000 || config.statement_timeout!==5000)throw new Error('unbounded connection');
      }
      async connect() {
        return Object.assign(new EventEmitter(), {
          query:async(sql,values)=>{
            if(/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)){boundaries.push(sql);return {rows:[]};}
            return this.query(sql,values);
          },
          release:(destroy)=>{if(destroy!==${fails})throw new Error('failed connection was reused');releases++;}
        });
      }
      async query(sql, values) {
        queries++;
        if(sql.includes('ivx_autonomous_task_compare_and_set')) {
          if(!sql.includes('$2::jsonb') || values[1]!==JSON.stringify(['RUNNING']))throw new Error('CAS does not match deployed JSONB state contract');
          if(!${fails})return {rows:[{result:{ok:false,error:'state_conflict'}}]};
        }
        if(${fails})throw new Error('ambiguous direct failure');
        if(sql.includes('ivx_autonomous_tasks_claim_batch'))return {rows:[{result:[{ok:false,task:null,error:'no_task'}]}]};
        return {rows:[]};
      }
    }}));
    process.env.IVX_AUTONOMOUS_QUEUE_BACKEND='postgres_atomic';
    process.env.EXPO_PUBLIC_SUPABASE_URL='https://testproject.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
    process.env.SUPABASE_DB_URL='postgresql://postgres.testproject:test@aws-0-us-east-1.pooler.supabase.com/postgres?sslmode=verify-full';
    globalThis.fetch=async()=>{restCalls++;throw new Error('REST must not be called');};
    const m=await import(${JSON.stringify(new URL('./ivx-postgres-autonomous-task-store.ts', import.meta.url).pathname)});
    if(!m.preferDirectTransport())throw new Error('same project was not selected');
    if(m.preferDirectTransport({...process.env,SUPABASE_DB_URL:process.env.SUPABASE_DB_URL.replace('postgres.testproject','postgres.other')}))throw new Error('other project accepted');
    for(const operation of [()=>m.readPostgresFleetLeaseRows(),()=>m.readPostgresCurrentTasks(['RUNNING']),()=>m.readPostgresLandingTasks('a'.repeat(40)),()=>m.readPostgresAutonomousTaskIndex('a'.repeat(40)),()=>m.claimPostgresAutonomousTasks([{workerId:'agent:test',agentNumber:1}]),()=>m.compareAndSetPostgresAutonomousTask({task:{taskId:'test'},expectedStates:['RUNNING'],eventType:'verified'})]) {
      let failed=false;
      try {await operation();}catch(e){if(!String(e).includes('ambiguous direct failure'))throw e;failed=true;}
      if(failed!==${fails})throw new Error('incorrect failure result');
    }
    if(restCalls!==0 || queries!==6)throw new Error('transport replay or unexpected call count');
    const setups=boundaries.filter(x=>x.startsWith('BEGIN;'));
    if(releases!==4 || setups.length!==4 || setups.some(x=>!x.includes("SET LOCAL statement_timeout = '4s'") || !x.includes("SET LOCAL lock_timeout = '2s'") || !x.includes("SET LOCAL idle_in_transaction_session_timeout = '8s'")))throw new Error('bounded transaction missing for planning, Landing read or RPC');
    // An ambiguous client failure must destroy the connection without sending
    // more SQL; a successful transaction must still commit exactly once.
    const endings=boundaries.filter(x=>x==='ROLLBACK' || x==='COMMIT');
    if(endings.length!==${fails ? 0 : 4} || endings.some(x=>x!=='COMMIT'))throw new Error('incorrect transaction cleanup');
  `], {stdout:'pipe',stderr:'pipe',timeout:10000});
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (fails) {
    const lines = stderr.trim().split('\n');
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toStartWith('[IVX PostgreSQL] deadline failure ');
      const diagnostic = JSON.parse(line.slice(line.indexOf('{')));
      expect(diagnostic).toMatchObject({ pool: 'tasks', stage: 'query', sqlState: null });
      expect(diagnostic.queryHash).toMatch(/^[a-f0-9]{16}$/);
      expect(line).not.toContain('ambiguous direct failure');
      expect(line).not.toContain('postgresql://');
    }
  } else expect(stderr).toBe('');
  expect(code).toBe(0);
});
