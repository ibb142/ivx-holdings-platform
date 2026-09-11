import '../services/ivx-global-ai-budget-fetch';
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
import { startAutonomousUtilizationGuardian, stopAutonomousUtilizationGuardian } from '../services/ivx-autonomous-utilization-guardian';

import { startCertificateWorker, stopCertificateWorker } from '../services/ivx-certificate-worker';
import { startOwnerAITaskWorker, stopOwnerAITaskWorker } from '../services/ivx-owner-ai-task-queue';

const databaseRecoveryMode = (process.env.IVX_SUPABASE_RECOVERY_MODE ?? '').trim().toLowerCase() === 'true';
// Fleet timers deliberately unref themselves. In recovery mode the auxiliary
// worker is absent, so retain process lifetime until graceful shutdown instead
// of exiting before the fleet's delayed boot tick can execute.
const recoveryLifetime = databaseRecoveryMode ? setInterval(() => {}, 60_000) : null;

console.log('[IVX-SENIOR-DEV-01] process entry', {
  pid: process.pid,
  at: new Date().toISOString(),
  campaignConcurrency: getWorkerMaxConcurrency(),
  fleetExecutionPlane: process.env.IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED !== 'false',
  autonomousDoctorRepair: process.env.IVX_AUTONOMOUS_DOCTOR_REPAIR_ENABLED === 'true',
  databaseRecoveryMode,
});

// During a Supabase/PostgREST incident, preserve a single database mutation
// authority: the 112-lane runtime. Auxiliary supervisors are intentionally
// suppressed so SLO/Doctor/reconciler/owner-queue polling cannot create a retry
// storm that starves fleet claim and heartbeat RPCs. Recovery mode never marks
// an IA working by itself; durable leases/execution evidence remain required.
if (!databaseRecoveryMode) {
  startFleetSloMonitor();
  startBlockedTaskReconciler();
}
startCertificateWorker();
// The general owner queue now uses bounded atomic claims and fenced updates.
// Keep this consumer available while the older auxiliary polling loops remain
// suppressed; its SQL gate respects owner pause/emergency and database failure.
startOwnerAITaskWorker();
const fleetStarted = startAutonomous112RuntimeEnforcer();
if (!databaseRecoveryMode) {
  startAutonomousDoctor();
  startAutonomousUtilizationGuardian();
}
console.log('[IVX-SENIOR-DEV-01] 112-lane execution plane', {
  started: fleetStarted,
  autonomousDoctor: !databaseRecoveryMode,
  utilizationGuardian: !databaseRecoveryMode,
  databaseRecoveryMode,
});

if (!databaseRecoveryMode) {
  startSeniorDevWorker().then(() => {
    console.log('[IVX-SENIOR-DEV-01] exited normally', getSeniorDevWorkerStatus());
  }).catch((error) => {
    console.error('[IVX-SENIOR-DEV-01] fatal error:', error instanceof Error ? error.message : 'unknown');
    process.exit(1);
  });
} else {
  console.warn('[IVX-SENIOR-DEV-01] database recovery mode active; auxiliary database pollers suppressed until healthy lease traffic is restored');
}

async function shutdown(signal: string): Promise<void> {
  process.env.IVX_INSTANCE_DRAINING = 'true';
  stopCertificateWorker();
  requestSeniorDevWorkerStop();
  stopSeniorDeveloperQueue();
  console.log(`[IVX-SENIOR-DEV-01] ${signal} received, returning fleet capacity`);
  stopAutonomousUtilizationGuardian();
  if (!databaseRecoveryMode) stopBlockedTaskReconciler();
  await Promise.all([stopOwnerAITaskWorker(), stopAutonomous112RuntimeEnforcer()]).catch((error) => {
    console.error('[IVX-SENIOR-DEV-01] fleet shutdown error', error instanceof Error ? error.message : String(error));
  });
  if (recoveryLifetime) clearInterval(recoveryLifetime);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
