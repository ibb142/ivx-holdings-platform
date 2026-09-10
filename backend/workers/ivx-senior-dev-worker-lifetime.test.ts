import { expect, test } from 'bun:test';

test('recovery worker stays alive until SIGTERM even when fleet timers are unreferenced', async () => {
  const servicePath = (name: string) => new URL(`../services/${name}.ts`, import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '-e', `
    import { mock } from 'bun:test';
    mock.module(${JSON.stringify(servicePath('ivx-senior-dev-worker'))},()=>({
      startSeniorDevWorker:()=>{throw new Error('auxiliary worker must remain paused');},
      getSeniorDevWorkerStatus:()=>({}),requestSeniorDevWorkerStop:()=>{}
    }));
    mock.module(${JSON.stringify(servicePath('ivx-senior-developer-worker'))},()=>({getWorkerMaxConcurrency:()=>112,stopSeniorDeveloperQueue:()=>{}}));
    mock.module(${JSON.stringify(servicePath('ivx-autonomous-runtime-enforcer'))},()=>({
      startAutonomous112RuntimeEnforcer:()=>{setTimeout(()=>console.log('FLEET_TICK'),150).unref();return true;},
      stopAutonomous112RuntimeEnforcer:async()=>{console.log('FLEET_STOPPED');return 0;}
    }));
    mock.module(${JSON.stringify(servicePath('ivx-autonomous-blocked-reconciler'))},()=>({startBlockedTaskReconciler:()=>{throw new Error('auxiliary started');},stopBlockedTaskReconciler:()=>{}}));
    mock.module(${JSON.stringify(servicePath('ivx-fleet-slo'))},()=>({startFleetSloMonitor:()=>{throw new Error('auxiliary started');}}));
    mock.module(${JSON.stringify(servicePath('ivx-autonomous-doctor'))},()=>({startAutonomousDoctor:()=>{throw new Error('auxiliary started');}}));
    mock.module(${JSON.stringify(servicePath('ivx-autonomous-utilization-guardian'))},()=>({startAutonomousUtilizationGuardian:()=>{throw new Error('auxiliary started');},stopAutonomousUtilizationGuardian:()=>{}}));
    mock.module(${JSON.stringify(servicePath('ivx-certificate-worker'))},()=>({startCertificateWorker:()=>{},stopCertificateWorker:()=>{}}));
    process.env.IVX_SUPABASE_RECOVERY_MODE='true';
    await import(${JSON.stringify(new URL('./ivx-senior-dev-worker-entry.ts', import.meta.url).pathname)});
    console.log('READY');
  `], {stdout:'pipe',stderr:'pipe',timeout:4000});
  const reader = child.stdout.getReader();
  let output = '';
  try {
    while (!output.includes('FLEET_TICK')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
    }
    expect(output).toContain('READY');
    expect(output).toContain('FLEET_TICK');
    child.kill('SIGTERM');
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
    }
    expect(await child.exited).toBe(0);
    expect(output).toContain('FLEET_STOPPED');
  } finally { child.kill(); }
});
