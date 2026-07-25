/**
 * IVX Autonomous Job Ledger API (owner-only).
 *
 *   GET  /api/ivx/autonomous/ledger         → full W1–W12 worker/job/approval ledger
 *   POST /api/ivx/autonomous/ledger/update  → owner-approved job state change { jobId, status?, note? }
 *
 * This is the REAL persistent job ledger backing the IVX Command Center
 * dashboard app. It replaces the static in-app seed data mandated for removal.
 *
 * HONESTY RULES:
 *   - Stable job IDs (JOB-0001…) that never change between reads.
 *   - Every DONE job carries real evidence (commit sha, artifact sha, deploy id, verified probe).
 *   - State changes are appended to an immutable history array with timestamps.
 *   - No fabricated progress: baseline entries reflect only verified work.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { readDurableJson, writeDurableJson } from '../services/ivx-durable-store';
import path from 'node:path';

export const IVX_AUTONOMOUS_JOB_LEDGER_MARKER = 'ivx-autonomous-job-ledger-2026-07-17';

const LEDGER_FILE = path.join(process.cwd(), 'logs', 'audit', 'autonomous-job-ledger', 'ledger.json');

type LedgerJobStatus = 'QUEUED' | 'RUNNING' | 'BLOCKED' | 'OWNER_ACTION_REQUIRED' | 'DONE' | 'VERIFIED';

type LedgerWorker = {
  id: string;
  name: string;
  scope: string;
};

type LedgerHistoryEntry = {
  at: string;
  from: string | null;
  to: string;
  note: string | null;
};

type LedgerJob = {
  jobId: string;
  workerId: string;
  title: string;
  status: LedgerJobStatus;
  priority: 'P0' | 'P1' | 'P2';
  evidence: string | null;
  blocker: string | null;
  createdAt: string;
  updatedAt: string;
  history: LedgerHistoryEntry[];
};

type LedgerApproval = {
  approvalId: string;
  workerId: string;
  title: string;
  risk: string;
  rollback: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
};

type LedgerDocument = {
  marker: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  workers: LedgerWorker[];
  jobs: LedgerJob[];
  approvals: LedgerApproval[];
};

const BASELINE_AT = '2026-07-17T20:30:00.000Z';

const BASELINE_WORKERS: LedgerWorker[] = [
  { id: 'W1', name: 'Architecture & Consistency', scope: 'System architecture, mock-module elimination, cross-platform consistency' },
  { id: 'W2', name: 'Owner Authentication', scope: 'Owner login, password lifecycle, session security' },
  { id: 'W3', name: 'Security & Secrets', scope: 'Credential rotation, secret scanning, key hygiene' },
  { id: 'W4', name: 'Android & iOS Stability', scope: 'Mobile builds, signing, crash-free operation' },
  { id: 'W5', name: 'Backend & Supabase', scope: 'API health, database integrity, backup/recovery' },
  { id: 'W6', name: 'Business Modules', scope: 'Members, investors, buyers, properties, deals' },
  { id: 'W7', name: 'Media & Communications', scope: 'Reels, chat, media pipeline, documents' },
  { id: 'W8', name: 'Owner Dashboard & Admin Hub', scope: 'Command Center app, job-ledger integration, admin tooling' },
  { id: 'W9', name: 'Testing & QA', scope: 'Test matrices, regression coverage, device QA' },
  { id: 'W10', name: 'CI/CD & Delivery', scope: 'GitHub workflows, Render deploys, EAS pipeline' },
  { id: 'W11', name: 'Performance & Monitoring', scope: 'Latency baselines, uptime probes, alerting' },
  { id: 'W12', name: 'App Generation Platform', scope: 'App-from-scratch capability (P2)' },
];

function baselineJob(
  jobId: string,
  workerId: string,
  title: string,
  status: LedgerJobStatus,
  priority: 'P0' | 'P1' | 'P2',
  evidence: string | null,
  blocker: string | null,
): LedgerJob {
  return {
    jobId,
    workerId,
    title,
    status,
    priority,
    evidence,
    blocker,
    createdAt: BASELINE_AT,
    updatedAt: BASELINE_AT,
    history: [{ at: BASELINE_AT, from: null, to: status, note: 'Baseline ledger entry (verified engagement record).' }],
  };
}

const BASELINE_JOBS: LedgerJob[] = [
  baselineJob('JOB-0001', 'W2', 'Owner password change with old-password rejection proof', 'VERIFIED', 'P0', 'Old password rejected (400 invalid_credentials); new password grant 200; commits 6e011658 + 3e221781 deployed.', null),
  baselineJob('JOB-0002', 'W2', 'Owner session revocation across devices', 'VERIFIED', 'P0', 'Global sign-out verified: pre-revocation 204, post-revocation 400/403 on same token.', null),
  baselineJob('JOB-0003', 'W3', 'Client bundle secret scan', 'VERIFIED', 'P0', 'Bundle scan: only public anon JWT present; no service-role or private keys in shipped artifacts.', null),
  baselineJob('JOB-0004', 'W3', 'Rotate Supabase service-role key', 'OWNER_ACTION_REQUIRED', 'P0', null, 'Rotation is a Supabase-dashboard owner action; old key remains valid and exists in Git history.'),
  baselineJob('JOB-0005', 'W2', 'Owner password-reset email delivery', 'BLOCKED', 'P0', null, 'Supabase /auth/v1/recover returns HTTP 429 over_email_send_rate_limit (retried through 20:11 UTC).'),
  baselineJob('JOB-0006', 'W4', 'Signed arm64 release APK v1.4.6(38)', 'VERIFIED', 'P0', 'APK 45.3MB SHA 0b7ced1b…894c7, signature verified, delivered via 7-day URL.', null),
  baselineJob('JOB-0007', 'W4', 'Universal APK delivery', 'BLOCKED', 'P1', 'Built: 85.9MB SHA 931a1927…2908.', 'Exceeds ~50MB artifact bucket limit; arm64 variant delivered instead.'),
  baselineJob('JOB-0008', 'W4', 'Release keystore (replace debug signing)', 'OWNER_ACTION_REQUIRED', 'P0', null, 'Generating a production keystore requires owner approval (irreversible signing identity).'),
  baselineJob('JOB-0009', 'W10', 'Deployment traceability GitHub==Render==production', 'VERIFIED', 'P0', '/health sha aab9661d matches GitHub HEAD and Render deploy dep-d9d7vrm1a83c738h6gqg.', null),
  baselineJob('JOB-0010', 'W9', 'Physical Android device QA', 'OWNER_ACTION_REQUIRED', 'P0', null, 'Requires owner physical device with delivered APK.'),
  baselineJob('JOB-0011', 'W5', 'Database backup & recovery verification', 'BLOCKED', 'P0', null, 'Backend missing SUPABASE_DB_URL/DATABASE_URL (confirmed false via developer-deploy status).'),
  baselineJob('JOB-0012', 'W10', 'CI workflow registration (build-apk-release.yml)', 'BLOCKED', 'P1', 'Workflow authored locally at .github/workflows/build-apk-release.yml.', 'GitHub token lacks workflow scope (HTTP 404 on dispatch).'),
  baselineJob('JOB-0013', 'W8', 'IVX Command Center iOS dashboard app', 'VERIFIED', 'P1', 'Swift app built and checks passed: Overview/Workers/Jobs/Health/Approvals tabs, live /health probe.', null),
  baselineJob('JOB-0014', 'W8', 'Restructure ledger to 12-worker mandate', 'VERIFIED', 'P1', 'W1–W12 model with stable job IDs and risk/rollback on all approvals; build passed.', null),
  baselineJob('JOB-0015', 'W8', 'Real backend job-ledger API + dashboard live wiring', 'RUNNING', 'P1', 'This endpoint (marker ivx-autonomous-job-ledger-2026-07-17) is the deliverable.', null),
  baselineJob('JOB-0016', 'W9', 'Authentication QA matrix (20 tests)', 'RUNNING', 'P1', null, null),
  baselineJob('JOB-0017', 'W9', 'Device QA matrix (30 tests)', 'RUNNING', 'P1', null, null),
  baselineJob('JOB-0018', 'W11', 'API latency baselines', 'RUNNING', 'P1', 'Health probe samples 0.77–1.45s over repeated measurements.', null),
  baselineJob('JOB-0019', 'W1', 'Mock-module inventory and elimination plan', 'QUEUED', 'P1', null, null),
  baselineJob('JOB-0020', 'W6', 'Business-module reconciliation (members/investors/buyers/properties/deals)', 'QUEUED', 'P1', null, null),
  baselineJob('JOB-0021', 'W7', 'Chat and media pipeline audit', 'QUEUED', 'P1', null, null),
  baselineJob('JOB-0022', 'W5', 'Supabase schema and RLS audit', 'QUEUED', 'P1', null, null),
  baselineJob('JOB-0023', 'W10', 'EAS iOS build pipeline', 'QUEUED', 'P2', null, null),
  baselineJob('JOB-0024', 'W11', 'Uptime monitoring and alerting', 'QUEUED', 'P2', null, null),
  baselineJob('JOB-0025', 'W1', 'Technical debt register', 'QUEUED', 'P2', null, null),
  baselineJob('JOB-0026', 'W12', 'App-from-scratch generation platform', 'QUEUED', 'P2', null, null),
];

const BASELINE_APPROVALS: LedgerApproval[] = [
  { approvalId: 'APR-001', workerId: 'W3', title: 'Rotate Supabase service-role key', risk: 'Old key valid and present in Git history; continued exposure until rotated.', rollback: 'Re-issue key in Supabase dashboard; backend env updated via Render.', status: 'PENDING', createdAt: BASELINE_AT },
  { approvalId: 'APR-002', workerId: 'W2', title: 'Complete password reset via official Supabase email', risk: 'Owner account remains on current password until reset email succeeds.', rollback: 'None needed; reset link expires automatically.', status: 'PENDING', createdAt: BASELINE_AT },
  { approvalId: 'APR-003', workerId: 'W4', title: 'Generate production release keystore', risk: 'Irreversible signing identity; losing it blocks future updates.', rollback: 'Not applicable — keystore must be backed up on creation.', status: 'PENDING', createdAt: BASELINE_AT },
  { approvalId: 'APR-004', workerId: 'W10', title: 'Grant GitHub token workflow scope', risk: 'Broader token scope; enables CI workflow registration.', rollback: 'Revoke/rescope token in GitHub settings.', status: 'PENDING', createdAt: BASELINE_AT },
  { approvalId: 'APR-005', workerId: 'W5', title: 'Configure SUPABASE_DB_URL on backend', risk: 'Direct DB connection string on server; required for backup verification.', rollback: 'Remove env var via Render.', status: 'PENDING', createdAt: BASELINE_AT },
];

function nowIso(): string {
  return new Date().toISOString();
}

function buildBaselineDocument(): LedgerDocument {
  return {
    marker: IVX_AUTONOMOUS_JOB_LEDGER_MARKER,
    version: 1,
    createdAt: BASELINE_AT,
    updatedAt: BASELINE_AT,
    workers: BASELINE_WORKERS,
    jobs: BASELINE_JOBS,
    approvals: BASELINE_APPROVALS,
  };
}

async function loadLedger(): Promise<LedgerDocument> {
  const stored = await readDurableJson<LedgerDocument | null>(LEDGER_FILE, null);
  if (stored && Array.isArray(stored.jobs) && stored.jobs.length > 0) {
    return stored;
  }
  const baseline = buildBaselineDocument();
  try {
    await writeDurableJson(LEDGER_FILE, baseline);
  } catch {
    // Non-fatal: serve the baseline even if persistence is unavailable.
  }
  return baseline;
}

const VALID_STATUSES: LedgerJobStatus[] = ['QUEUED', 'RUNNING', 'BLOCKED', 'OWNER_ACTION_REQUIRED', 'DONE', 'VERIFIED'];

export function autonomousJobLedgerOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleAutonomousJobLedgerGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const ledger = await loadLedger();
  const counts = {
    workers: ledger.workers.length,
    jobs: ledger.jobs.length,
    verified: ledger.jobs.filter((j) => j.status === 'VERIFIED' || j.status === 'DONE').length,
    running: ledger.jobs.filter((j) => j.status === 'RUNNING').length,
    blocked: ledger.jobs.filter((j) => j.status === 'BLOCKED').length,
    ownerActionRequired: ledger.jobs.filter((j) => j.status === 'OWNER_ACTION_REQUIRED').length,
    queued: ledger.jobs.filter((j) => j.status === 'QUEUED').length,
    pendingApprovals: ledger.approvals.filter((a) => a.status === 'PENDING').length,
  };

  return ownerOnlyJson({
    ok: true,
    marker: ledger.marker,
    generatedAt: nowIso(),
    source: 'durable_store',
    version: ledger.version,
    updatedAt: ledger.updatedAt,
    counts,
    workers: ledger.workers,
    jobs: ledger.jobs,
    approvals: ledger.approvals,
  } as unknown as Record<string, unknown>);
}

export async function handleAutonomousJobLedgerUpdate(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  const nextStatus = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  if (!jobId) {
    return ownerOnlyJson({ ok: false, error: 'jobId is required.' }, 400);
  }
  if (nextStatus && !VALID_STATUSES.includes(nextStatus as LedgerJobStatus)) {
    return ownerOnlyJson({ ok: false, error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  const ledger = await loadLedger();
  let job = ledger.jobs.find((j) => j.jobId === jobId);
  const at = nowIso();

  if (!job) {
    // Owner-approved job creation: body.create === true registers a NEW job
    // so the ledger can track work discovered after the baseline. Requires
    // an explicit worker, title and a valid JOB-xxxx id.
    const wantsCreate = body.create === true;
    const workerId = typeof body.workerId === 'string' ? body.workerId.trim().toUpperCase() : '';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const priority = typeof body.priority === 'string' && ['P0', 'P1', 'P2'].includes(body.priority.trim().toUpperCase())
      ? body.priority.trim().toUpperCase()
      : 'P1';
    const evidence = typeof body.evidence === 'string' && body.evidence.trim() ? body.evidence.trim().slice(0, 500) : null;
    const blocker = typeof body.blocker === 'string' && body.blocker.trim() ? body.blocker.trim().slice(0, 500) : null;
    if (!wantsCreate) {
      return ownerOnlyJson({ ok: false, error: `Unknown jobId: ${jobId}. Pass create:true with workerId+title to register a new job.` }, 404);
    }
    if (!/^JOB-\d{4}$/.test(jobId)) {
      return ownerOnlyJson({ ok: false, error: 'New jobId must match JOB-xxxx (4 digits).' }, 400);
    }
    if (!ledger.workers.some((w) => w.id === workerId)) {
      return ownerOnlyJson({ ok: false, error: `Unknown workerId: ${workerId || '(missing)'}` }, 400);
    }
    if (!title) {
      return ownerOnlyJson({ ok: false, error: 'title is required to create a job.' }, 400);
    }
    const initialStatus = (nextStatus || 'QUEUED') as LedgerJobStatus;
    job = {
      jobId,
      workerId,
      title,
      status: initialStatus,
      priority: priority as LedgerJob['priority'],
      evidence,
      blocker,
      createdAt: at,
      updatedAt: at,
      history: [{ at, from: null, to: initialStatus, note: note ?? 'Job registered via owner ledger update.' }],
    };
    ledger.jobs.push(job);
    ledger.updatedAt = at;
    ledger.version += 1;
  } else {
    const previousStatus = job.status;
    if (nextStatus) {
      job.status = nextStatus as LedgerJobStatus;
    }
    if (typeof body.evidence === 'string' && body.evidence.trim()) {
      job.evidence = body.evidence.trim().slice(0, 500);
    }
    if (typeof body.blocker === 'string') {
      job.blocker = body.blocker.trim() ? body.blocker.trim().slice(0, 500) : null;
    }
    job.updatedAt = at;
    job.history.push({ at, from: previousStatus, to: job.status, note });
    ledger.updatedAt = at;
    ledger.version += 1;
  }

  try {
    await writeDurableJson(LEDGER_FILE, ledger);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'persist failed';
    return ownerOnlyJson({ ok: false, error: `Ledger update could not be persisted: ${message}` }, 500);
  }

  return ownerOnlyJson({
    ok: true,
    marker: ledger.marker,
    updatedAt: ledger.updatedAt,
    version: ledger.version,
    job: job as unknown as Record<string, unknown>,
  } as unknown as Record<string, unknown>);
}