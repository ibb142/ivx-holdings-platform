import app from './hono';
import { autonomousJobLedgerOptions, handleAutonomousJobLedgerGet, handleAutonomousJobLedgerUpdate } from './api/ivx-autonomous-job-ledger';
import { ownerAuthGuardianOptions, handleOwnerAuthGuardianGet, handleOwnerAuthGuardianAlert } from './api/ivx-owner-auth-guardian';
import { startAutonomousQAScheduler, autonomousQAOptions, handleAutonomousQAGet } from './api/ivx-auth-qa-scheduler';
import { credentialsStatusOptions, handleCredentialsStatusGet } from './api/ivx-credentials-status';
import { migrationRunnerOptions, handleMigrationStatusGet, handleMigrationRunPost } from './api/ivx-migration-runner';
import { iaOrchestratorOptions, handleIAStatusGet, handleIATaskPost, handleIALockPost } from './api/ivx-ia-orchestrator';
import { ownerCredentialStatusOptions, handleOwnerCredentialStatusGet } from './api/ivx-owner-credential-status';
import { autonomousRunsOptions, handleAutonomousRunsGet, handleAutonomousRunsSummaryGet } from './api/ivx-autonomous-runs';
import { autonomousControlPlaneOptions, handleAutonomousControlPlaneGet } from './api/ivx-autonomous-control-plane';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './api/owner-only';
import { getLatestMemberAuthCertification, runMemberAuthCertification } from './services/ivx-member-auth-certification';
import { OPTIONS as scopedMemoryOptions, handleStatus as handleScopedMemoryStatus, handleCreate as handleScopedMemoryCreate, handleRetrieve as handleScopedMemoryRetrieve, handleBuildContext as handleScopedMemoryBuildContext, handleRevoke as handleScopedMemoryRevoke, handleOwnerOverride as handleScopedMemoryOwnerOverride, handleValidate as handleScopedMemoryValidate } from './api/ivx-scoped-memory';
import { OPTIONS as businessClassificationOptions, handleStatus as handleBusinessClassificationStatus, handleCreate as handleBusinessClassificationCreate, handleTransition as handleBusinessClassificationTransition, handleOwnerOverride as handleBusinessClassificationOwnerOverride, handleReconcile as handleBusinessClassificationReconcile, handleGetRecord as handleBusinessClassificationGetRecord, handleGetHistory as handleBusinessClassificationGetHistory, handleList as handleBusinessClassificationList, handleValidateTransition as handleBusinessClassificationValidateTransition, handleReconcileTotal as handleBusinessClassificationReconcileTotal } from './api/ivx-business-classification';
import { OPTIONS as failureRecoveryOptions, handleRecoveryStatusRequest, handleRecoveryRegisterRequest, handleRecoveryCheckpointRequest, handleRecoveryCompleteRequest, handleRecoveryFailRequest, handleRecoveryResumeRequest, handleRecoveryGetJobRequest, handleRecoveryListCheckpointsRequest, handleRecoveryListDeadletterRequest, handleRecoveryInspectDeadletterRequest, handleRecoveryReplayDeadletterRequest, handleRecoveryDiscardDeadletterRequest, handleRecoveryRehydrateRequest, handleRecoveryInjectFailureRequest, handleRecoveryExecuteRequest } from './api/ivx-failure-recovery';
import { reelsOptions, handleReelsStatus, handleReelsPublish, handleReelsFeed, handleReelsMedia, handleReelsView, handleReelsLike } from './api/ivx-reels';
import { ivxDirectAuthOptions, handleIVXDirectAuthSignIn } from './api/ivx-direct-auth';
import { ivxSupabaseRestartOptions, handleIVXSupabaseRestart } from './api/ivx-supabase-restart';

app.options('/api/ivx/autonomous/control-plane', () => autonomousControlPlaneOptions());
app.get('/api/ivx/autonomous/control-plane', async (c) => handleAutonomousControlPlaneGet(c.req.raw));
app.options('/api/ivx/autonomous/ledger', () => autonomousJobLedgerOptions());
app.get('/api/ivx/autonomous/ledger', async (c) => handleAutonomousJobLedgerGet(c.req.raw));
app.options('/api/ivx/autonomous/ledger/update', () => autonomousJobLedgerOptions());
app.post('/api/ivx/autonomous/ledger/update', async (c) => handleAutonomousJobLedgerUpdate(c.req.raw));
app.options('/api/ivx/autonomous/auth-guardian', () => ownerAuthGuardianOptions());
app.get('/api/ivx/autonomous/auth-guardian', async (c) => handleOwnerAuthGuardianGet(c.req.raw));
app.options('/api/ivx/autonomous/auth-guardian/alert', () => ownerAuthGuardianOptions());
app.post('/api/ivx/autonomous/auth-guardian/alert', async (c) => handleOwnerAuthGuardianAlert(c.req.raw));
app.options('/api/ivx/autonomous/qa', () => autonomousQAOptions());
app.get('/api/ivx/autonomous/qa', async (c) => handleAutonomousQAGet(c.req.raw));
app.options('/api/ivx/autonomous/credentials', () => credentialsStatusOptions());
app.get('/api/ivx/autonomous/credentials', async (c) => handleCredentialsStatusGet(c.req.raw));
app.options('/api/ivx/autonomous/migrations', () => migrationRunnerOptions());
app.get('/api/ivx/autonomous/migrations', async (c) => handleMigrationStatusGet(c.req.raw));
app.options('/api/ivx/autonomous/migrations/run', () => migrationRunnerOptions());
app.post('/api/ivx/autonomous/migrations/run', async (c) => handleMigrationRunPost(c.req.raw));
app.options('/api/ivx/autonomous/ia', () => iaOrchestratorOptions());
app.get('/api/ivx/autonomous/ia', async (c) => handleIAStatusGet(c.req.raw));
app.options('/api/ivx/autonomous/ia/task', () => iaOrchestratorOptions());
app.post('/api/ivx/autonomous/ia/task', async (c) => handleIATaskPost(c.req.raw));
app.options('/api/ivx/autonomous/ia/lock', () => iaOrchestratorOptions());
app.post('/api/ivx/autonomous/ia/lock', async (c) => handleIALockPost(c.req.raw));
app.options('/api/ivx/owner/credential-status', () => ownerCredentialStatusOptions());
app.get('/api/ivx/owner/credential-status', async (c) => handleOwnerCredentialStatusGet(c.req.raw));
app.options('/api/ivx/autonomous/runs', () => autonomousRunsOptions());
app.get('/api/ivx/autonomous/runs', async (c) => handleAutonomousRunsGet(c.req.raw));
app.options('/api/ivx/autonomous/runs/summary', () => autonomousRunsOptions());
app.get('/api/ivx/autonomous/runs/summary', async (c) => handleAutonomousRunsSummaryGet(c.req.raw));

app.options('/api/ivx/certification/member-auth', () => ownerOnlyOptions());
app.get('/api/ivx/certification/member-auth', async (c) => {
  try { await assertIVXOwnerOnly(c.req.raw); } catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401); }
  try {
    const latest = await getLatestMemberAuthCertification();
    return ownerOnlyJson({ ok: true, certificate: latest });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to read certification';
    return ownerOnlyJson({ ok: false, error: 'Certification store unavailable', detail: msg.slice(0, 200), certificate: null }, 200);
  }
});

// Public read-only endpoint for CI certification gates — returns latest cert without owner auth
app.get('/api/ivx/certification/member-auth-public', async (c) => {
  try {
    const latest = await getLatestMemberAuthCertification();
    if (!latest) {
      // No cached cert — run one on demand so CI gates get a fresh result
      const fresh = await runMemberAuthCertification();
      return c.json(fresh, 200);
    }
    return c.json(latest, 200);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to read certification';
    return c.json({ certified: false, error: 'Certification store unavailable', detail: msg.slice(0, 200) }, 200);
  }
});
app.post('/api/ivx/certification/member-auth/run', async (c) => {
  try { await assertIVXOwnerOnly(c.req.raw); } catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401); }
  try {
    const certificate = await runMemberAuthCertification();
    return ownerOnlyJson({ ok: certificate.certified, certificate }, certificate.certified ? 200 : 503);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'certification run failed';
    return ownerOnlyJson({ ok: false, error: 'Certification run failed', detail: msg.slice(0, 300) }, 503);
  }
});

app.options('/api/ivx/social/reels/status', () => reelsOptions());
app.get('/api/ivx/social/reels/status', async (c) => handleReelsStatus(c.req.raw));
app.options('/api/ivx/social/reels/publish', () => reelsOptions());
app.post('/api/ivx/social/reels/publish', async (c) => handleReelsPublish(c.req.raw));
app.get('/api/ivx/social/reels/feed', async (c) => handleReelsFeed(c.req.raw));
app.get('/api/ivx/social/reels/media/:id', async (c) => handleReelsMedia(c.req.raw, c.req.param('id')));
app.post('/api/ivx/social/reels/:id/view', async (c) => handleReelsView(c.req.raw, c.req.param('id')));
app.post('/api/ivx/social/reels/:id/like', async (c) => handleReelsLike(c.req.raw, c.req.param('id')));

app.options('/api/ivx/scoped-memory/status', () => scopedMemoryOptions());
app.get('/api/ivx/scoped-memory/status', async (c) => handleScopedMemoryStatus(c.req.raw));
app.options('/api/ivx/scoped-memory/create', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/create', async (c) => handleScopedMemoryCreate(c.req.raw));
app.options('/api/ivx/scoped-memory/retrieve', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/retrieve', async (c) => handleScopedMemoryRetrieve(c.req.raw));
app.options('/api/ivx/scoped-memory/build-context', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/build-context', async (c) => handleScopedMemoryBuildContext(c.req.raw));
app.options('/api/ivx/scoped-memory/revoke', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/revoke', async (c) => handleScopedMemoryRevoke(c.req.raw));
app.options('/api/ivx/scoped-memory/owner-override', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/owner-override', async (c) => handleScopedMemoryOwnerOverride(c.req.raw));
app.options('/api/ivx/scoped-memory/validate', () => scopedMemoryOptions());
app.post('/api/ivx/scoped-memory/validate', async (c) => handleScopedMemoryValidate(c.req.raw));

app.options('/api/ivx/business-classification/status', () => businessClassificationOptions());
app.get('/api/ivx/business-classification/status', async (c) => handleBusinessClassificationStatus(c.req.raw));
app.options('/api/ivx/business-classification/create', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/create', async (c) => handleBusinessClassificationCreate(c.req.raw));
app.options('/api/ivx/business-classification/transition', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/transition', async (c) => handleBusinessClassificationTransition(c.req.raw));
app.options('/api/ivx/business-classification/owner-override', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/owner-override', async (c) => handleBusinessClassificationOwnerOverride(c.req.raw));
app.options('/api/ivx/business-classification/reconcile', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/reconcile', async (c) => handleBusinessClassificationReconcile(c.req.raw));
app.options('/api/ivx/business-classification/list', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/list', async (c) => handleBusinessClassificationList(c.req.raw));
app.options('/api/ivx/business-classification/validate-transition', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/validate-transition', async (c) => handleBusinessClassificationValidateTransition(c.req.raw));
app.options('/api/ivx/business-classification/reconcile-total', () => businessClassificationOptions());
app.post('/api/ivx/business-classification/reconcile-total', async (c) => handleBusinessClassificationReconcileTotal(c.req.raw));
app.options('/api/ivx/business-classification/record/:id', () => businessClassificationOptions());
app.get('/api/ivx/business-classification/record/:id', async (c) => handleBusinessClassificationGetRecord(c.req.raw, c.req.param('id')));
app.options('/api/ivx/business-classification/history/:id', () => businessClassificationOptions());
app.get('/api/ivx/business-classification/history/:id', async (c) => handleBusinessClassificationGetHistory(c.req.raw, c.req.param('id')));

app.options('/api/ivx/failure-recovery/status', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/status', async (c) => handleRecoveryStatusRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/register', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/register', async (c) => handleRecoveryRegisterRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/checkpoint', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/checkpoint', async (c) => handleRecoveryCheckpointRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/complete', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/complete', async (c) => handleRecoveryCompleteRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/fail', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/fail', async (c) => handleRecoveryFailRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/resume', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/resume', async (c) => handleRecoveryResumeRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/job/:id', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/job/:id', async (c) => handleRecoveryGetJobRequest(c.req.raw, c.req.param('id')));
app.options('/api/ivx/failure-recovery/checkpoints', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/checkpoints', async (c) => handleRecoveryListCheckpointsRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/deadletter', () => failureRecoveryOptions());
app.get('/api/ivx/failure-recovery/deadletter', async (c) => handleRecoveryListDeadletterRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/deadletter/:id/inspect', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/deadletter/:id/inspect', async (c) => handleRecoveryInspectDeadletterRequest(c.req.raw, c.req.param('id')));
app.options('/api/ivx/failure-recovery/deadletter/:id/replay', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/deadletter/:id/replay', async (c) => handleRecoveryReplayDeadletterRequest(c.req.raw, c.req.param('id')));
app.options('/api/ivx/failure-recovery/deadletter/:id/discard', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/deadletter/:id/discard', async (c) => handleRecoveryDiscardDeadletterRequest(c.req.raw, c.req.param('id')));
app.options('/api/ivx/failure-recovery/rehydrate', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/rehydrate', async (c) => handleRecoveryRehydrateRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/inject-failure', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/inject-failure', async (c) => handleRecoveryInjectFailureRequest(c.req.raw));
app.options('/api/ivx/failure-recovery/execute', () => failureRecoveryOptions());
app.post('/api/ivx/failure-recovery/execute', async (c) => handleRecoveryExecuteRequest(c.req.raw));

app.options('/api/ivx/auth/direct-sign-in', () => ivxDirectAuthOptions());
app.post('/api/ivx/auth/direct-sign-in', async (c) => handleIVXDirectAuthSignIn(c.req.raw));
app.options('/api/ivx/auth/restart-supabase', () => ivxSupabaseRestartOptions());
app.post('/api/ivx/auth/restart-supabase', async (c) => handleIVXSupabaseRestart(c.req.raw));

startAutonomousQAScheduler();
export default app;
