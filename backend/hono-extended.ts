/**
 * IVX Hono Extended — route extension layer on top of backend/hono.ts.
 *
 * WHY THIS FILE EXISTS:
 * backend/hono.ts (306KB) exceeds the Cloudflare WAF request-size ceiling
 * (~100–200KB) enforced on the owner deploy API, so new routes cannot be
 * registered by re-committing the full file through the guarded pipeline.
 * This small module imports the existing app and registers additional routes.
 * server.ts imports THIS module, so all original routes remain untouched.
 *
 * Routes registered here:
 *   GET  /api/ivx/autonomous/ledger               — owner-only W1–W12 job ledger
 *   POST /api/ivx/autonomous/ledger/update        — owner-approved job state change
 *   GET  /api/ivx/autonomous/auth-guardian        — Owner Auth Guardian live probes
 *   POST /api/ivx/autonomous/auth-guardian/alert  — owner SMS alert (AWS SNS)
 *   GET  /api/ivx/autonomous/qa                   — continuous QA scheduler status
 *   GET  /api/ivx/autonomous/credentials          — live credential binding matrix
 *   GET  /api/ivx/autonomous/migrations           — migration history vs repo manifest
 *   POST /api/ivx/autonomous/migrations/run       — apply pending repo migrations (owner bearer)
 *   GET  /api/ivx/autonomous/ia                   — 12-IA operating model state (roster/queue/factory/locks)
 *   POST /api/ivx/autonomous/ia/task              — create/update an IA task (owner bearer)
 *   POST /api/ivx/autonomous/ia/lock              — acquire/release a critical-file lock (owner bearer)
 *
 * Side effect: starts the in-process continuous QA scheduler (health 5m,
 * auth 15m, full matrix 2h) on service boot.
 */
import app from './hono';
import {
  autonomousJobLedgerOptions,
  handleAutonomousJobLedgerGet,
  handleAutonomousJobLedgerUpdate,
} from './api/ivx-autonomous-job-ledger';
import {
  ownerAuthGuardianOptions,
  handleOwnerAuthGuardianGet,
  handleOwnerAuthGuardianAlert,
} from './api/ivx-owner-auth-guardian';
import {
  startAutonomousQAScheduler,
  autonomousQAOptions,
  handleAutonomousQAGet,
} from './api/ivx-auth-qa-scheduler';
import {
  credentialsStatusOptions,
  handleCredentialsStatusGet,
} from './api/ivx-credentials-status';
import {
  migrationRunnerOptions,
  handleMigrationStatusGet,
  handleMigrationRunPost,
} from './api/ivx-migration-runner';
import {
  iaOrchestratorOptions,
  handleIAStatusGet,
  handleIATaskPost,
  handleIALockPost,
} from './api/ivx-ia-orchestrator';

app.options('/api/ivx/autonomous/ledger', () => autonomousJobLedgerOptions());
app.get('/api/ivx/autonomous/ledger', async (context) => handleAutonomousJobLedgerGet(context.req.raw));
app.options('/api/ivx/autonomous/ledger/update', () => autonomousJobLedgerOptions());
app.post('/api/ivx/autonomous/ledger/update', async (context) => handleAutonomousJobLedgerUpdate(context.req.raw));

app.options('/api/ivx/autonomous/auth-guardian', () => ownerAuthGuardianOptions());
app.get('/api/ivx/autonomous/auth-guardian', async (context) => handleOwnerAuthGuardianGet(context.req.raw));
app.options('/api/ivx/autonomous/auth-guardian/alert', () => ownerAuthGuardianOptions());
app.post('/api/ivx/autonomous/auth-guardian/alert', async (context) => handleOwnerAuthGuardianAlert(context.req.raw));

app.options('/api/ivx/autonomous/qa', () => autonomousQAOptions());
app.get('/api/ivx/autonomous/qa', async (context) => handleAutonomousQAGet(context.req.raw));

app.options('/api/ivx/autonomous/credentials', () => credentialsStatusOptions());
app.get('/api/ivx/autonomous/credentials', async (context) => handleCredentialsStatusGet(context.req.raw));

app.options('/api/ivx/autonomous/migrations', () => migrationRunnerOptions());
app.get('/api/ivx/autonomous/migrations', async (context) => handleMigrationStatusGet(context.req.raw));
app.options('/api/ivx/autonomous/migrations/run', () => migrationRunnerOptions());
app.post('/api/ivx/autonomous/migrations/run', async (context) => handleMigrationRunPost(context.req.raw));

app.options('/api/ivx/autonomous/ia', () => iaOrchestratorOptions());
app.get('/api/ivx/autonomous/ia', async (context) => handleIAStatusGet(context.req.raw));
app.options('/api/ivx/autonomous/ia/task', () => iaOrchestratorOptions());
app.post('/api/ivx/autonomous/ia/task', async (context) => handleIATaskPost(context.req.raw));
app.options('/api/ivx/autonomous/ia/lock', () => iaOrchestratorOptions());
app.post('/api/ivx/autonomous/ia/lock', async (context) => handleIALockPost(context.req.raw));

startAutonomousQAScheduler();

export default app;