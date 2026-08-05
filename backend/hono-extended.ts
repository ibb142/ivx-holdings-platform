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
 *   GET  /api/ivx/autonomous/runs               — permanent per-run evidence records (newest first)
 *   GET  /api/ivx/autonomous/runs/summary       — aggregated honest evidence counts
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
import {
  ownerCredentialStatusOptions,
  handleOwnerCredentialStatusGet,
} from './api/ivx-owner-credential-status';
import {
  autonomousRunsOptions,
  handleAutonomousRunsGet,
  handleAutonomousRunsSummaryGet,
} from './api/ivx-autonomous-runs';
import {
  OPTIONS as scopedMemoryOptions,
  handleStatus as handleScopedMemoryStatus,
  handleCreate as handleScopedMemoryCreate,
  handleRetrieve as handleScopedMemoryRetrieve,
  handleBuildContext as handleScopedMemoryBuildContext,
  handleRevoke as handleScopedMemoryRevoke,
  handleOwnerOverride as handleScopedMemoryOwnerOverride,
  handleValidate as handleScopedMemoryValidate,
} from './api/ivx-scoped-memory';
import {
  OPTIONS as businessClassificationOptions,
  handleStatus as handleBusinessClassificationStatus,
  handleCreate as handleBusinessClassificationCreate,
  handleTransition as handleBusinessClassificationTransition,
  handleOwnerOverride as handleBusinessClassificationOwnerOverride,
  handleReconcile as handleBusinessClassificationReconcile,
  handleGetRecord as handleBusinessClassificationGetRecord,
  handleGetHistory as handleBusinessClassificationGetHistory,
  handleList as handleBusinessClassificationList,
  handleValidateTransition as handleBusinessClassificationValidateTransition,
  handleReconcileTotal as handleBusinessClassificationReconcileTotal,
} from './api/ivx-business-classification';
import {
  OPTIONS as failureRecoveryOptions,
  handleRecoveryStatusRequest,
  handleRecoveryRegisterRequest,
  handleRecoveryCheckpointRequest,
  handleRecoveryCompleteRequest,
  handleRecoveryFailRequest,
  handleRecoveryResumeRequest,
  handleRecoveryGetJobRequest,
  handleRecoveryListCheckpointsRequest,
  handleRecoveryListDeadletterRequest,
  handleRecoveryInspectDeadletterRequest,
  handleRecoveryReplayDeadletterRequest,
  handleRecoveryDiscardDeadletterRequest,
  handleRecoveryRehydrateRequest,
  handleRecoveryInjectFailureRequest,
  handleRecoveryExecuteRequest,
} from './api/ivx-failure-recovery';

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

app.options('/api/ivx/owner/credential-status', () => ownerCredentialStatusOptions());
app.get('/api/ivx/owner/credential-status', async (context) => handleOwnerCredentialStatusGet(context.req.raw));

app.options('/api/ivx/autonomous/runs', () => autonomousRunsOptions());
app.get('/api/ivx/autonomous/runs', async (context) => handleAutonomousRunsGet(context.req.raw));
app.options('/api/ivx/autonomous/runs/summary', () => autonomousRunsOptions());
app.get('/api/ivx/autonomous/runs/summary', async (context) => handleAutonomousRunsSummaryGet(context.req.raw));

// GATE 1 — Scoped Memory (4-layer isolation: task / agent / company / enterprise)
app.options('/api/ivx/scoped-memory/status', () => scopedMemoryOptions());
app.get('/api/ivx/scoped-memory/status', async (context) => handleScopedMemoryStatus(context.req.raw));
app.options('/api/ivx/scoped-memory/create', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/create', async (context) => handleScopedMemoryCreate(context.req.raw));
app.options('/api/ivx/scoped-memory/retrieve', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/retrieve', async (context) => handleScopedMemoryRetrieve(context.req.raw));
app.options('/api/ivx/scoped-memory/build-context', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/build-context', async (context) => handleScopedMemoryBuildContext(context.req.raw));
app.options('/api/ivx/scoped-memory/revoke', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/revoke', async (context) => handleScopedMemoryRevoke(context.req.raw));
app.options('/api/ivx/scoped-memory/owner-override', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/owner-override', async (context) => handleScopedMemoryOwnerOverride(context.req.raw));
app.options('/api/ivx/scoped-memory/validate', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/validate', async (context) => handleScopedMemoryValidate(context.req.raw));

// GATE 2 — Business-Data Classification (14 statuses, transition rules, audit history, reconciliation)
app.options('/api/ivx/business-classification/status', () => businessClassificationOptions());
app.get('/api/ivx/business-classification/status', async (context) => handleBusinessClassificationStatus(context.req.raw));
app.options('/api/ivx/business-classification/create', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/create', async (context) => handleBusinessClassificationCreate(context.req.raw));
app.options('/api/ivx/business-classification/transition', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/transition', async (context) => handleBusinessClassificationTransition(context.req.raw));
app.options('/api/ivx/business-classification/owner-override', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/owner-override', async (context) => handleBusinessClassificationOwnerOverride(context.req.raw));
app.options('/api/ivx/business-classification/reconcile', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/reconcile', async (context) => handleBusinessClassificationReconcile(context.req.raw));
app.options('/api/ivx/business-classification/list', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/list', async (context) => handleBusinessClassificationList(context.req.raw));
app.options('/api/ivx/business-classification/validate-transition', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/validate-transition', async (context) => handleBusinessClassificationValidateTransition(context.req.raw));
app.options('/api/ivx/business-classification/reconcile-total', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/reconcile-total', async (context) => handleBusinessClassificationReconcileTotal(context.req.raw));
app.options('/api/ivx/business-classification/record/:id', () => businessClassificationOptions());
app.get('/api/ivx/business-classification/record/:id', async (context) => handleBusinessClassificationGetRecord(context.req.raw, context.req.param('id')));
app.options('/api/ivx/business-classification/history/:id', () => businessClassificationOptions());
app.get('/api/ivx/business-classification/history/:id', async (context) => handleBusinessClassificationGetHistory(context.req.raw, context.req.param('id')));

// GATE 3 — Controlled Failure and Recovery (checkpointing, retry, deadletter, idempotency, boot rehydration)
app.options('/api/ivx/failure-recovery/status', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/status', async (context) => handleRecoveryStatusRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/register', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/register', async (context) => handleRecoveryRegisterRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/checkpoint', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/checkpoint', async (context) => handleRecoveryCheckpointRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/complete', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/complete', async (context) => handleRecoveryCompleteRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/fail', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/fail', async (context) => handleRecoveryFailRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/resume', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/resume', async (context) => handleRecoveryResumeRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/job/:id', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/job/:id', async (context) => handleRecoveryGetJobRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/failure-recovery/checkpoints', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/checkpoints', async (context) => handleRecoveryListCheckpointsRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/deadletter', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/deadletter', async (context) => handleRecoveryListDeadletterRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/deadletter/:id/inspect', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/deadletter/:id/inspect', async (context) => handleRecoveryInspectDeadletterRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/failure-recovery/deadletter/:id/replay', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/deadletter/:id/replay', async (context) => handleRecoveryReplayDeadletterRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/failure-recovery/deadletter/:id/discard', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/deadletter/:id/discard', async (context) => handleRecoveryDiscardDeadletterRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/failure-recovery/rehydrate', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/rehydrate', async (context) => handleRecoveryRehydrateRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/inject-failure', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/inject-failure', async (context) => handleRecoveryInjectFailureRequest(context.req.raw));
app.options('/api/ivx/failure-recovery/execute', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/execute', async (context) => handleRecoveryExecuteRequest(context.req.raw));

// ── Direct Auth (GoTrue bypass) ─────────────────────────────────────────────
// Authenticates via direct Postgres + bcrypt when Supabase GoTrue is degraded.
import { ivxDirectAuthOptions, handleIVXDirectAuthSignIn } from './api/ivx-direct-auth';
app.options('/api/ivx/auth/direct-sign-in', () => ivxDirectAuthOptions());
app.post('/api/ivx/auth/direct-sign-in', async (context) => handleIVXDirectAuthSignIn(context.req.raw));

startAutonomousQAScheduler();

export default app;