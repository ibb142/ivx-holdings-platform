import { expect, test } from 'bun:test';

for (const mode of ['allowed', 'paused', 'stopped', 'unavailable', 'missing', 'malformed', 'emergency', 'emergency_unavailable', 'individual']) {
  test(`atomic recovery respects durable owner control: ${mode}`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import { mock } from 'bun:test';
      import { strict as assert } from 'node:assert';
      const mode = ${JSON.stringify(mode)}, resumed = [];
      const control = { paused: mode === 'paused', stopped: mode === 'stopped', pausedAgents: mode === 'individual' ? [1] : [], stoppedAgents: mode === 'individual' ? [2] : [] };
      const states = [1,2,3].map(n => ({ agentId: 'a'+n, agentNumber:n, lastHeartbeat:null, activeTaskId:null, availability:'available', health:'healthy', pauseState:mode === 'individual' && n === 3, disabledState:false }));
      const forbidden = () => { throw Error('legacy dispatcher mutation must not run'); };
      mock.module('./backend/services/ivx-agent-runtime.ts', () => ({ getAllExecutionStates:()=>states, resumeAgent:id=>resumed.push(id), pauseAgent:forbidden, disableAgent:forbidden, enableAgent:forbidden }));
      mock.module('./backend/services/ivx-campaign-dispatcher.ts', () => ({ ensureCampaignAssignment:forbidden, supersedeOrphanCampaignRecords:forbidden, campaignDispatcherControl:forbidden, getCampaignDispatcherSnapshot:forbidden, listCampaignDispatcherRecords:forbidden, runCampaignBootRecovery:forbidden, startCampaignDispatcher:forbidden }));
      mock.module('./backend/services/ivx-durable-store.ts', () => ({
        isDurableStoreConfigured:()=>true,
        readDurableJson:async()=>{ if(mode==='unavailable')throw Error('DATABASE_PRESSURE'); return mode==='missing' ? null : {control:mode==='malformed' ? {...control,pausedAgents:'all'} : control}; },
        writeDurableJson:forbidden, appendDurableEvent:forbidden, readDurableEvents:async()=>[]
      }));
      mock.module('./backend/services/ivx-github-actions-external-supervisor.ts',()=>({getGitHubActionsExternalSupervisorStatus:()=>null}));
      mock.module('./backend/services/ivx-autonomous-scheduler.ts',()=>({getSchedulerState:forbidden,setSchedulerEnabled:forbidden}));
      mock.module('./backend/services/ivx-autonomous-control-policy.ts',()=>({activeFleetMutationAuthorityCount:()=>1,autonomousQueueBackend:()=>'postgres_atomic',autonomousRepairCapacity:()=>112,autonomousRuntimeEnforcerEnabled:()=>true}));
      mock.module('./backend/services/ivx-project-vision.ts',()=>({evaluateFleetActivationEvidence:()=>({certified:false,blockers:['no active leases']})}));
      mock.module('./backend/services/ivx-postgres-autonomous-task-store.ts',()=>({readPostgresFleetLeaseRows:async()=>[]}));
      mock.module('./backend/services/ivx-emergency-stop-gate.ts',()=>({checkEmergencyStop:async()=>({active:mode==='emergency',source:mode==='emergency_unavailable'?'unavailable':'supabase'})}));
      const m = await import('./backend/services/ivx-autonomous-truth-control.ts');
      const result = await m.enforceAutonomous112RuntimeTruth();
      assert.deepEqual(resumed, mode === 'allowed' ? ['a1','a2','a3'] : []);
      assert.equal(result.snapshot.autonomous.dispatcherPaused, ['paused','stopped','unavailable','missing','malformed','emergency_unavailable'].includes(mode));
      assert.equal(result.snapshot.autonomous.emergencyStop, mode === 'emergency' || mode === 'stopped');
      if(['unavailable','missing','malformed','emergency_unavailable'].includes(mode)) {
        assert.equal(result.action,'owner_control_unavailable');
        assert.equal(result.snapshot.degraded,true);
        assert.equal(result.snapshot.autonomous.ownerControlVerified,false);
      }
      if(mode==='individual')assert(result.snapshot.agents.rows.every(row=>row.paused && row.status==='BLOCKED'));
      assert.equal(result.snapshot.ok,false,'An idle fleet must not be certified');
    `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(stderr || 'Owner control child failed without diagnostics');
    expect(code).toBe(0);
  });
}
