/**
 * IVX-SENIOR-DEV-01 — Worker Process Entry Point
 *
 * Starts the autonomous senior developer worker as a long-running background
 * process. Designed to run on Render as a separate worker service.
 *
 * Usage:
 *   node /app/node_modules/tsx/dist/cli.mjs /app/backend/workers/ivx-senior-dev-worker-entry.ts
 */

import { startSeniorDevWorker, getSeniorDevWorkerStatus } from '../services/ivx-senior-dev-worker';
// Importing the campaign worker starts its bounded queue-drain timer. This
// unifies the live Render worker with the queue populated by Autonomous while
// retaining the owner AI task processor below.
import { getWorkerMaxConcurrency } from '../services/ivx-senior-developer-worker';

console.log('[IVX-SENIOR-DEV-01] process entry', { pid: process.pid, at: new Date().toISOString(), campaignConcurrency: getWorkerMaxConcurrency() });

startSeniorDevWorker().then(() => {
  console.log('[IVX-SENIOR-DEV-01] exited normally', getSeniorDevWorkerStatus());
}).catch((error) => {
  console.error('[IVX-SENIOR-DEV-01] fatal error:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[IVX-SENIOR-DEV-01] SIGTERM received, stopping gracefully');
});

process.on('SIGINT', () => {
  console.log('[IVX-SENIOR-DEV-01] SIGINT received, stopping gracefully');
});
