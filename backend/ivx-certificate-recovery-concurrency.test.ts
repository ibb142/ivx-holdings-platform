import {expect,test} from 'bun:test';

test('API boot recovery does not overlap certificate runs or fan out agent tools',async()=>{
  const child=Bun.spawn([process.execPath,'-e',`
    import {mock} from 'bun:test';
    process.env.IVX_PROCESS_ROLE='api';
    const reads=[], calls=[];
    const pending=['rec-1','rec-2'].flatMap(run=>[1,2,3].map(n=>({
      run_id:run,task_id:run+'-a'+n,agent_id:'a'+n,agent_number:n,
      workflow:'ivx-112-real-execution-certificate',task_type:'real_execution_certification',final_status:'pending'
    })));
    mock.module('./backend/services/ivx-agent-contracts.ts',()=>({ALL_AGENT_CONTRACTS:[]}));
    mock.module('./backend/services/ivx-agent-runtime.ts',()=>({
      executeAgentRun:async(id,mode,input)=>{calls.push(input.__runId);await new Promise(()=>{});},
      writeMemory:()=>{},readMemory:()=>{},buildAgentStateRows:()=>[],enforceRegistryIntegrity:()=>({ok:true}),IVX_AGENT_RUNTIME_VERSION:'test'
    }));
    const persistence=Object.fromEntries([
      'insertExecutions','updateExecution','fetchAgentStates','insertCertificate','fetchLatestCertificate',
      'insertProspects','fetchProspects','fetchRecentAlerts','insertAlert','countProspects','computeEvidenceSha'
    ].map(key=>[key,()=>{}]));
    mock.module('./backend/services/ivx-agent-persistence.ts',()=>({
      ...persistence,HEARTBEAT_STALE_MS:60000,persistenceConfigured:()=>true,
      ensureRealExecutionTables:async()=>({ok:true}),
      fetchPendingExecutions:async()=>({ok:true,data:pending}),
      fetchExecutionsByRun:async(run)=>{reads.push(run);return {ok:true,data:pending.filter(r=>r.run_id===run)};}
    }));
    mock.module('./backend/services/ivx-agent-real-tools.ts',()=>({executeRealTool:()=>{},makeDedupKey:()=>''}));
    const m=await import('./backend/services/ivx-real-execution-certificate.ts');
    void m.resumePendingCertificateRuns();
    await new Promise(r=>setTimeout(r,100));
    if(reads.length!==1||reads[0]!=='rec-1'||calls.length!==1)throw Error(JSON.stringify({reads,calls}));
  `],{cwd:new URL('../',import.meta.url).pathname,stdout:'pipe',stderr:'pipe',timeout:5000});
  const [code,err]=await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect(err).toBe('');expect(code).toBe(0);
});
