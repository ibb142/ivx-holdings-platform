import { expect, test } from 'bun:test';

test('the worker reads authority at mutation boundaries, retains CAS heartbeats, and stops on an unavailable lease', async () => {
  const path = (name: string) => new URL(`./${name}.ts`, import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '-e', `
    import { spyOn } from 'bun:test';
    import assert from 'node:assert/strict';
    const gate = await import(${JSON.stringify(path('ivx-emergency-stop-gate'))});
    spyOn(gate, 'checkEmergencyStop').mockResolvedValue({active:false,source:'supabase'});
    const durable = await import(${JSON.stringify(path('ivx-durable-store'))});
    spyOn(durable, 'isDurableStoreConfigured').mockReturnValue(true);
    const store = await import(${JSON.stringify(path('ivx-postgres-autonomous-task-store'))});
    spyOn(store, 'preferDirectTransport').mockReturnValue(true);
    let authorityReads = 0, unavailable = false;
    spyOn(store, 'assertSeniorQueuePostgresAuthority').mockImplementation(async id => {
      assert.equal(id, 'authority-fixture'); authorityReads++;
      if (unavailable) throw Error('Query read timeout');
    });
    let doc = { jobs: [{ jobId:'authority-fixture', ownerId:'test-owner', status:'queued',
      stage:'QUEUED', createdAt:new Date().toISOString(), attempts:0, result:null,
      input:{goal:'Repair observed defect',executionMode:'code_change',ownerId:'test-owner',
        ownerApproved:true,approvePatch:false,approveGitDeploy:false,validationMode:'focused',systemMode:true} }] };
    const queue = await import(${JSON.stringify(path('ivx-senior-shared-queue'))});
    const snapshot = () => structuredClone(doc);
    const mutations = [], events = [];
    spyOn(queue, 'sharedSeniorQueueEnabled').mockReturnValue(true);
    spyOn(queue, 'readSharedSeniorWorkQueue').mockImplementation(async () => snapshot());
    spyOn(queue, 'readSharedSeniorDocument').mockImplementation(async () => snapshot());
    spyOn(queue, 'readSharedSeniorJob').mockImplementation(async () => snapshot().jobs[0]);
    spyOn(queue, 'claimSharedSeniorJob').mockImplementation(async () => {
      doc.jobs[0] = {...doc.jobs[0],status:'running',attempts:1,
        leaseWorkerInstanceId:'test-worker',leaseExpiresAt:'2099-01-01T00:00:00Z'};
      return snapshot().jobs[0];
    });
    spyOn(queue, 'patchSharedSeniorQueue').mockImplementation(async next => {
      mutations.push(structuredClone(next)); doc = structuredClone(next); return snapshot();
    });
    spyOn(queue, 'appendSharedSeniorProofEvent').mockImplementation(async (_file,event) => {events.push(event);});
    const originalInterval = globalThis.setInterval;
    let heartbeat;
    globalThis.setInterval = (fn,delay,...args) => {
      if (delay === 20000) heartbeat = fn;
      return originalInterval(fn,delay,...args);
    };
    const coder = await import(${JSON.stringify(path('ivx-autonomous-coder'))});
    spyOn(coder, 'runIVXAutonomousCoder').mockImplementation(async options => {
      const before = mutations.length;
      for (let i=0;i<20;i++) await options.assertExecutionAuthority();
      assert.equal(authorityReads,20);
      assert.equal(mutations.length,before,'Authority checks must not rewrite the queue');
      assert.equal(typeof heartbeat,'function');
      heartbeat();
      await options.assertExecutionAuthority(); // serialized after the heartbeat CAS
      assert.equal(mutations.length,before+1,'Periodic heartbeats must still renew via CAS');
      assert.ok(doc.jobs[0].lastHeartbeatAt);
      unavailable = true;
      await assert.rejects(options.assertExecutionAuthority(),/Query read timeout/);
      assert.equal(options.isCanceled(),false,'Storage interruption is not owner cancellation');
      await assert.rejects(options.assertExecutionAuthority(),/WORKER_AUTHORITY_UNCONFIRMED/);
      assert.equal(authorityReads,22,'An interrupted execution cannot resume or retry authority');
      return {};
    });
    const worker = await import(${JSON.stringify(path('ivx-senior-developer-worker'))});
    assert.equal(await worker.processNextSeniorDeveloperJob(),null);
    assert.equal(doc.jobs[0].attempts,1);
    assert.equal(doc.jobs[0].status,'running');
    assert.equal(doc.jobs[0].result,null);
    assert.equal(events.length,1);
    assert.equal(events[0].reason,'authority_unconfirmed');
    assert.equal(events[0].failureClass,'storage_timeout');
    worker.stopSeniorDeveloperQueue();
    console.log('AUTHORITY_READS_WITH_CAS_HEARTBEAT_AND_SAFE_INTERRUPTION');
  `], { env: { PATH: process.env.PATH, IVX_PROCESS_ROLE: 'api' }, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, diagnostic: code === 0 ? '' : stderr }).toEqual({ code: 0, diagnostic: '' });
  expect(stdout).toContain('AUTHORITY_READS_WITH_CAS_HEARTBEAT_AND_SAFE_INTERRUPTION');
});
