import { expect, test } from 'bun:test';

test('shutdown retains the real worker checkpoint and records interruption rather than owner cancellation', async () => {
  const path = (name: string) => new URL(`./${name}.ts`, import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '-e', `
    import { spyOn } from 'bun:test';
    import assert from 'node:assert/strict';
    const gate = await import(${JSON.stringify(path('ivx-emergency-stop-gate'))});
    spyOn(gate, 'checkEmergencyStop').mockResolvedValue({active:false,source:'supabase'});
    const queue = await import(${JSON.stringify(path('ivx-senior-shared-queue'))});
    const events = [];
    spyOn(queue, 'appendSharedSeniorProofEvent').mockImplementation(async (_file,event)=>{events.push(event);});
    const coder = await import(${JSON.stringify(path('ivx-autonomous-coder'))});
    const worker = await import(${JSON.stringify(path('ivx-senior-developer-worker'))});
    const commitSha = 'c'.repeat(40);
    let calls = 0;
    spyOn(coder, 'runIVXAutonomousCoder').mockImplementation(async options => {
      calls++;
      await options.onCommitLanded({commitSha,commitUrl:'https://github.com/example/repo/commit/'+commitSha,
        branch:'repair/full-task-identity',filesChanged:['backend/example.ts'],commandsRun:[],testsPassed:true,typecheckPassed:true});
      await options.onPrCreated({commitSha,prNumber:19,prUrl:'https://github.com/example/repo/pull/19',branch:'repair/full-task-identity'});
      worker.stopSeniorDeveloperQueue();
      assert.equal(options.isCanceled(),false);
      await assert.rejects(options.assertExecutionAuthority(),/WORKER_AUTHORITY_UNCONFIRMED/);
      return {};
    });
    const {job} = await worker.enqueueOrAttachSeniorDeveloperJob({goal:'Repair the observed defect',taskId:'task-full-identity',
      ownerId:'autonomous-scheduler',ownerApproved:true,approvePatch:false,approveGitDeploy:false,
      validationMode:'focused',systemMode:true,ownerApprovedAction:null,executionMode:'code_change'});
    assert.equal(await worker.processNextSeniorDeveloperJob(),null);
    const saved = await worker.getSeniorDeveloperJob(job.jobId);
    assert.equal(calls,1);
    assert.equal(saved.jobId,job.jobId);
    assert.equal(saved.status,'committing');
    assert.equal(saved.finishedAt,null);
    assert.equal(saved.cancelledAt,null);
    assert.equal(saved.result.finalStatus,'IN_PROGRESS');
    assert.equal(saved.result.commitSha,commitSha);
    assert.equal(saved.result.ciResumeState.phase,'CI_WAIT');
    assert.equal(saved.result.prNumber,19);
    assert.equal(events.length,1);
    assert.equal(events[0].type,'job_interrupted');
    assert.equal(events[0].reason,'worker_shutdown');
    assert.equal(events[0].jobId,job.jobId);
    assert.ok(Number.isFinite(Date.parse(events[0].observedAt)));
    console.log('CHECKPOINT_RETAINED_WITH_INTERRUPTION_CAUSE');
  `], { env: { PATH: process.env.PATH, IVX_PROCESS_ROLE: 'api', IVX_WORKER_MAX_CONCURRENCY: '1' },
    stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, diagnostic: code === 0 ? '' : stderr }).toEqual({ code: 0, diagnostic: '' });
  expect(stdout).toContain('CHECKPOINT_RETAINED_WITH_INTERRUPTION_CAUSE');
});
