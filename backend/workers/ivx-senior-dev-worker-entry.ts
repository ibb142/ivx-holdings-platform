/**
 * IVX-SENIOR-DEV-01 — Dedicated execution-plane entry point.
 *
 * This Render background worker owns both:
 *   1) owner-triggered Senior Developer jobs; and
 *   2) the durable 112-lane Autonomous fleet execution loop.
 *
 * Production web API remains the control plane. Render sets
 * IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED=false on the web service and true on
 * this worker, preventing fleet load from starving /health or owner APIs.
 */

import { startSeniorDevWorker, getSeniorDevWorkerStatus } from '../services/ivx-senior-dev-worker';
import { getWorkerMaxConcurrency } from '../services/ivx-senior-developer-worker';
import { startAutonomous112RuntimeEnforcer, stopAutonomous112RuntimeEnforcer } from '../services/ivx-autonomous-runtime-enforcer';
import { startBlockedTaskReconciler, stopBlockedTaskReconciler } from '../services/ivx-autonomous-blocked-reconciler';
import { startFleetSloMonitor, stopFleetSloMonitor } from '../services/ivx-fleet-slo';

console.log('[IVX-SENIOR-DEV-01] process entry', {
  pid: process.pid,
  at: new Date().toISOString(),
  campaignConcurrency: getWorkerMaxConcurrency(),
  fleetExecutionPlane: process.env.IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED !== 'false',
});

startFleetSloMonitor();
startBlockedTaskReconciler();
const fleetStarted = startAutonomous112RuntimeEnforcer();
console.log('[IVX-SENIOR-DEV-01] 112-lane execution plane', { started: fleetStarted });

startSeniorDevWorker().then(() => {
  console.log('[IVX-SENIOR-DEV-01] exited normally', getSeniorDevWorkerStatus());
}).catch((error) => {
  console.error('[IVX-SENIOR-DEV-01] fatal error:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[IVX-SENIOR-DEV-01] ${signal} received, returning fleet capacity`);
  stopBlockedTaskReconciler();
  stopFleetSloMonitor();
  await stopAutonomous112RuntimeEnforcer().catch((error) => {
    console.error('[IVX-SENIOR-DEV-01] fleet shutdown error', error instanceof Error ? error.message : String(error));
  });
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
