/**
 * IVX-SENIOR-DEV-01 — Dedicated execution-plane entry point.
 *
 * The background worker owns the durable 112-lane fleet. The web service can
 * therefore remain a control plane and keep owner APIs/health responsive.
 */
import { startSeniorDevWorker, getSeniorDevWorkerStatus, requestSeniorDevWorkerStop } from '../services/ivx-senior-dev-worker';
import { getWorkerMaxConcurrency, stopSeniorDeveloperQueue } from '../services/ivx-senior-developer-worker';
import { startAutonomous112RuntimeEnforcer, stopAutonomous112RuntimeEnforcer } from '../services/ivx-autonomous-runtime-enforcer';
import { startBlockedTaskReconciler, stopBlockedTaskReconciler } from '../services/ivx-autonomous-blocked-reconciler';
import { startFleetSloMonitor } from '../services/ivx-fleet-slo';
import { startAutonomousDoctor } from '../services/ivx-autonomous-doctor';

console.log('[IVX-SENIOR-DEV-01] process entry', {
  pid: process.pid,
  at: new Date().toISOString(),
  campaignConcurrency: getWorkerMaxConcurrency(),
  fleetExecutionPlane: process.env.IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED !== 'false',
  autonomousDoctorRepair: process.env.IVX_AUTONOMOUS_DOCTOR_REPAIR_ENABLED === 'true',
});

startFleetSloMonitor();
startBlockedTaskReconciler();
const fleetStarted = startAutonomous112RuntimeEnforcer();
startAutonomousDoctor();
console.log('[IVX-SENIOR-DEV-01] 112-lane execution plane', { started: fleetStarted, autonomousDoctor: true });

startSeniorDevWorker().then(() => {
  console.log('[IVX-SENIOR-DEV-01] exited normally', getSeniorDevWorkerStatus());
}).catch((error) => {
  console.error('[IVX-SENIOR-DEV-01] fatal error:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  process.env.IVX_INSTANCE_DRAINING = 'true';
  requestSeniorDevWorkerStop();
  stopSeniorDeveloperQueue();
  console.log(`[IVX-SENIOR-DEV-01] ${signal} received, returning fleet capacity`);
  stopBlockedTaskReconciler();
  await stopAutonomous112RuntimeEnforcer().catch((error) => {
    console.error('[IVX-SENIOR-DEV-01] fleet shutdown error', error instanceof Error ? error.message : String(error));
  });
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
