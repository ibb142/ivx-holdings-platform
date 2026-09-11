import { expect, test } from 'bun:test';

for (const recovery of [false, true]) {
  test(`dedicated worker starts bounded global supervision only outside database recovery (${recovery})`, async () => {
    const service = (name: string) => new URL(`../services/${name}.ts`, import.meta.url).pathname;
    const child = Bun.spawn([process.execPath, '-e', `
      import { mock } from 'bun:test';
      import assert from 'node:assert/strict';
      const started=[];
      mock.module(${JSON.stringify(service('ivx-global-ai-budget-fetch'))},()=>({}));
      mock.module(${JSON.stringify(service('ivx-global-certification-supervisor'))},()=>({
        startGlobalCertificationSupervisor:()=>started.push('global'),stopGlobalCertificationSupervisor:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-senior-dev-worker'))},()=>({
        startSeniorDevWorker:async()=>{},getSeniorDevWorkerStatus:()=>({}),requestSeniorDevWorkerStop:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-senior-developer-worker'))},()=>({getWorkerMaxConcurrency:()=>1,stopSeniorDeveloperQueue:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-autonomous-runtime-enforcer'))},()=>({startAutonomous112RuntimeEnforcer:()=>true,stopAutonomous112RuntimeEnforcer:async()=>0}));
      mock.module(${JSON.stringify(service('ivx-autonomous-blocked-reconciler'))},()=>({startBlockedTaskReconciler:()=>{},stopBlockedTaskReconciler:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-fleet-slo'))},()=>({startFleetSloMonitor:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-autonomous-doctor'))},()=>({startAutonomousDoctor:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-autonomous-utilization-guardian'))},()=>({startAutonomousUtilizationGuardian:()=>{},stopAutonomousUtilizationGuardian:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-certificate-worker'))},()=>({startCertificateWorker:()=>{},stopCertificateWorker:()=>{}}));
      mock.module(${JSON.stringify(service('ivx-owner-ai-task-queue'))},()=>({startOwnerAITaskWorker:()=>{},stopOwnerAITaskWorker:async()=>{}}));
      await import(${JSON.stringify(new URL('./ivx-senior-dev-worker-entry.ts', import.meta.url).pathname)});
      try { assert.deepEqual(started,${JSON.stringify(recovery ? [] : ['global'])}); }
      finally { process.emit('SIGTERM'); }
      console.log('SUPERVISOR_BOOT_POLICY_PASS');
    `], { env: { PATH: process.env.PATH, IVX_SUPABASE_RECOVERY_MODE: String(recovery) }, stdout: 'pipe', stderr: 'pipe', timeout: 4000 });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, error: code ? err : '' }).toEqual({ code: 0, error: '' });
    expect(out).toContain('SUPERVISOR_BOOT_POLICY_PASS');
  });
}
