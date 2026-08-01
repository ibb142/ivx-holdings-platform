/**
 * IVX self-hosted Senior Developer Worker client (owner-gated).
 *
 * Submits owner-approved build/development jobs to the self-hosted worker and
 * tracks them WITHOUT Rork as the executor:
 *   - POST /api/ivx/senior-developer/worker/jobs   → submit a job
 *   - GET  /api/ivx/senior-developer/worker/jobs/:jobId → poll one job
 *   - GET  /api/ivx/worker-last-proof              → compact last-proof
 *   - GET  /api/ivx/senior-developer/worker/status → worker availability
 *
 * Sends only the logged-in Supabase owner session bearer. Secrets stay
 * server-side. Never fabricates a commit hash, deploy id, or health result —
 * every value comes from the live owner-gated worker API.
 */
import { getIVXOwnerAIConfigAudit } from '@/lib/ivx-supabase-client';
import { supabase } from '@/lib/supabase';
import type { SeniorDeveloperJobDraft } from './seniorDeveloperBuildIntent';

/** Stable status codes surfaced to the chat for non-success outcomes. */
export type WorkerSubmitStatusCode =
  | 'OWNER_APPROVAL_REQUIRED'
  | 'WORKER_UNAVAILABLE'
  | 'DEPLOY_SECRETS_MISSING'
  | 'SUBMITTED';

export type WorkerJobFinalStatus = 'COMPLETE' | 'LOCAL_ONLY' | 'BLOCKED' | 'FAILED' | 'RUNNING';

export type WorkerJobResultSummary = {
  jobId: string;
  finalStatus: WorkerJobFinalStatus;
  commitSha: string | null;
  deployId: string | null;
  deployStatus: string | null;
  healthStatus: number | null;
  healthOk: boolean;
  commitMatch: boolean;
  changedFiles: string[];
  testsRun: boolean;
  testsPassed: boolean;
  typecheckRun: boolean;
  buildRun: boolean;
  error: string | null;
};

export type WorkerJobView = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
  finishedAt: string | null;
  result: WorkerJobResultSummary | null;
  error: string | null;
};

export type WorkerLastProof = {
  lastJobId: string | null;
  lastCommitHash: string | null;
  lastDeployId: string | null;
  lastHealthStatus: number | null;
  lastVersionMatch: boolean;
  completedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBool(value: unknown): boolean {
  return value === true;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readString(item)).filter((item): item is string => item !== null).slice(0, 25);
}

function buildWorkerUrls(suffix: string): string[] {
  const audit = getIVXOwnerAIConfigAudit();
  const urls: string[] = [];
  const push = (raw: string | null | undefined): void => {
    const trimmed = raw?.trim();
    if (!trimmed || urls.includes(trimmed)) return;
    urls.push(trimmed);
  };
  const pushFromBase = (baseUrl: string | null | undefined): void => {
    const base = baseUrl?.trim().replace(/\/+$/, '');
    if (!base) return;
    push(`${base}${suffix}`);
  };
  pushFromBase(audit.activeBaseUrl);
  for (const endpoint of audit.candidateEndpoints) {
    const normalized = endpoint.replace(/\/+$/, '');
    if (normalized.endsWith('/api/ivx/owner-ai')) {
      pushFromBase(normalized.slice(0, -'/api/ivx/owner-ai'.length));
    } else if (normalized.endsWith('/ivx/owner-ai')) {
      pushFromBase(normalized.slice(0, -'/ivx/owner-ai'.length));
    }
  }
  return urls;
}

async function getOwnerBearer(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    return token.length > 0 && token.split('.').length === 3 ? token : null;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

type WorkerFetchResult = { ok: boolean; httpStatus: number; payload: Record<string, unknown> };

async function workerFetch(suffix: string, init: RequestInit): Promise<WorkerFetchResult> {
  const token = await getOwnerBearer();
  if (!token) {
    return { ok: false, httpStatus: 401, payload: { error: 'OWNER_APPROVAL_REQUIRED', ownerOnly: true } };
  }
  const urls = buildWorkerUrls(suffix);
  if (urls.length === 0) {
    return { ok: false, httpStatus: 0, payload: { error: 'WORKER_UNAVAILABLE' } };
  }
  let last: WorkerFetchResult | null = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
      const payload = await readJson(response);
      last = { ok: response.ok, httpStatus: response.status, payload };
      if (response.ok) return last;
    } catch (error) {
      last = { ok: false, httpStatus: 0, payload: { error: error instanceof Error ? error.message : 'WORKER_UNAVAILABLE' } };
    }
  }
  return last ?? { ok: false, httpStatus: 0, payload: { error: 'WORKER_UNAVAILABLE' } };
}

function mapResultSummary(value: unknown, jobId: string): WorkerJobResultSummary | null {
  if (!isRecord(value)) return null;
  const finalStatusRaw = readString(value.finalStatus);
  const finalStatus: WorkerJobFinalStatus =
    finalStatusRaw === 'COMPLETE' || finalStatusRaw === 'LOCAL_ONLY' || finalStatusRaw === 'BLOCKED' || finalStatusRaw === 'FAILED'
      ? finalStatusRaw
      : 'RUNNING';
  return {
    jobId,
    finalStatus,
    commitSha: readString(value.commitSha),
    deployId: readString(value.deployId),
    deployStatus: readString(value.deployStatus),
    healthStatus: readNumber(value.healthStatus),
    healthOk: readBool(value.healthOk),
    commitMatch: readBool(value.commitMatch),
    changedFiles: readStringArray(value.changedFiles),
    testsRun: readBool(value.testsRun),
    testsPassed: readBool(value.testsPassed),
    typecheckRun: readBool(value.typecheckRun),
    buildRun: readBool(value.buildRun),
    error: readString(value.error),
  };
}

function mapJob(payload: Record<string, unknown>): WorkerJobView | null {
  const job = isRecord(payload.job) ? payload.job : null;
  if (!job) return null;
  const jobId = readString(job.jobId) ?? '';
  const statusRaw = readString(job.status) ?? 'queued';
  const status: WorkerJobView['status'] =
    statusRaw === 'running' || statusRaw === 'completed' || statusRaw === 'failed' || statusRaw === 'blocked'
      ? statusRaw
      : 'queued';
  return {
    jobId,
    status,
    finishedAt: readString(job.finishedAt),
    result: mapResultSummary(job.result, jobId),
    error: readString(job.error),
  };
}

export type WorkerSubmitResult = {
  statusCode: WorkerSubmitStatusCode;
  jobId: string | null;
  pollPath: string | null;
  reason: string | null;
};

/**
 * Submit an owner-approved build job to the worker. Maps owner/secret/worker
 * failures to stable status codes so the chat can render the right card.
 */
export async function submitSeniorDeveloperWorkerJob(draft: SeniorDeveloperJobDraft): Promise<WorkerSubmitResult> {
  const result = await workerFetch('/api/ivx/senior-developer/worker/jobs', {
    method: 'POST',
    body: JSON.stringify({
      goal: draft.goal,
      templateMode: draft.templateMode,
      proposedPlan: draft.proposedPlan,
      filesAffected: draft.filesAffected,
      riskLevel: draft.riskLevel,
      rollbackOption: draft.rollbackPlan,
      approvePatch: true,
      approveGitDeploy: draft.requestsDeploy,
      validationMode: 'focused',
    }),
  });

  if (result.ok) {
    const jobId = readString(result.payload.job && isRecord(result.payload.job) ? result.payload.job.jobId : null);
    const pollPath = readString(result.payload.poll);
    return { statusCode: 'SUBMITTED', jobId, pollPath, reason: null };
  }

  const errorText = (readString(result.payload.error) ?? '').toLowerCase();
  const blocker = (readString(result.payload.exactBlocker) ?? '').toLowerCase();
  const reason = readString(result.payload.error) ?? readString(result.payload.exactBlocker);

  if (result.httpStatus === 401 || result.httpStatus === 403 || errorText.includes('owner') || errorText.includes('bearer')) {
    return { statusCode: 'OWNER_APPROVAL_REQUIRED', jobId: null, pollPath: null, reason };
  }
  if (errorText.includes('credential') || blocker.includes('credential') || errorText.includes('secret') || blocker.includes('missing_credentials')) {
    return { statusCode: 'DEPLOY_SECRETS_MISSING', jobId: null, pollPath: null, reason };
  }
  return { statusCode: 'WORKER_UNAVAILABLE', jobId: null, pollPath: null, reason };
}

/** Poll a single worker job by id. Returns null when unreachable. */
export async function getSeniorDeveloperWorkerJob(jobId: string): Promise<WorkerJobView | null> {
  const result = await workerFetch(`/api/ivx/senior-developer/worker/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
  if (!result.ok) return null;
  return mapJob(result.payload);
}

export type WorkerStatus = {
  ok: boolean;
  durableQueue: boolean;
  externalRequiredAsExecutor: boolean;
  reachable: boolean;
};

export type WorkerLedgerEntry = {
  jobId: string;
  goal: string;
  finalStatus: WorkerJobFinalStatus;
  commitSha: string | null;
  deployId: string | null;
  healthStatus: number | null;
  commitMatch: boolean;
  generatedAt: string | null;
};

/** Read the worker capability/availability snapshot. */
export async function getSeniorDeveloperWorkerStatus(): Promise<WorkerStatus> {
  const result = await workerFetch('/api/ivx/senior-developer/worker/status', { method: 'GET' });
  const p = result.payload;
  return {
    ok: readBool(p.ok),
    durableQueue: readBool(p.durableQueue),
    externalRequiredAsExecutor: readBool(p.externalRequiredAsExecutor),
    reachable: result.ok,
  };
}

/** Read recent jobs from the worker queue (newest first). */
export async function listSeniorDeveloperWorkerJobs(): Promise<WorkerJobView[]> {
  const result = await workerFetch('/api/ivx/senior-developer/worker/jobs', { method: 'GET' });
  if (!result.ok || !Array.isArray(result.payload.jobs)) return [];
  return result.payload.jobs
    .map((job) => mapJob({ job }))
    .filter((job): job is WorkerJobView => job !== null);
}

function mapLedgerEntry(value: unknown): WorkerLedgerEntry | null {
  if (!isRecord(value)) return null;
  const jobId = readString(value.jobId);
  if (!jobId) return null;
  const finalStatusRaw = readString(value.finalStatus);
  const finalStatus: WorkerJobFinalStatus =
    finalStatusRaw === 'COMPLETE' || finalStatusRaw === 'LOCAL_ONLY' || finalStatusRaw === 'BLOCKED' || finalStatusRaw === 'FAILED'
      ? finalStatusRaw
      : 'RUNNING';
  return {
    jobId,
    goal: readString(value.goal) ?? '',
    finalStatus,
    commitSha: readString(value.commitSha),
    deployId: readString(value.deployId),
    healthStatus: readNumber(value.healthStatus),
    commitMatch: readBool(value.commitMatch),
    generatedAt: readString(value.generatedAt),
  };
}

/** Read the durable proof ledger (newest first). */
export async function listSeniorDeveloperWorkerLedger(): Promise<WorkerLedgerEntry[]> {
  const result = await workerFetch('/api/ivx/senior-developer/worker/ledger', { method: 'GET' });
  if (!result.ok || !Array.isArray(result.payload.ledger)) return [];
  return result.payload.ledger
    .map((entry) => mapLedgerEntry(entry))
    .filter((entry): entry is WorkerLedgerEntry => entry !== null);
}

/** Read the compact last-proof from the worker ledger. */
export async function getSeniorDeveloperWorkerLastProof(): Promise<WorkerLastProof | null> {
  const result = await workerFetch('/api/ivx/worker-last-proof', { method: 'GET' });
  if (!result.ok) return null;
  const p = result.payload;
  return {
    lastJobId: readString(p.lastJobId),
    lastCommitHash: readString(p.lastCommitHash),
    lastDeployId: readString(p.lastDeployId),
    lastHealthStatus: readNumber(p.lastHealthStatus),
    lastVersionMatch: readBool(p.lastVersionMatch),
    completedAt: readString(p.completedAt),
  };
}

/**
 * Poll a worker job until it reaches a terminal state or the timeout elapses.
 * Terminal states: completed / failed / blocked. Never throws.
 */
export async function pollSeniorDeveloperWorkerJob(
  jobId: string,
  options: { intervalMs?: number; timeoutMs?: number; onTick?: (job: WorkerJobView) => void } = {},
): Promise<WorkerJobView | null> {
  const intervalMs = Math.max(1000, options.intervalMs ?? 4000);
  const timeoutMs = Math.max(intervalMs, options.timeoutMs ?? 180000);
  const deadline = Date.now() + timeoutMs;
  let latest: WorkerJobView | null = null;

  while (Date.now() < deadline) {
    const job = await getSeniorDeveloperWorkerJob(jobId);
    if (job) {
      latest = job;
      options.onTick?.(job);
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'blocked') {
        return job;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return latest;
}

/** Determine whether a finished job meets the strict COMPLETE contract. */
export function isWorkerJobComplete(result: WorkerJobResultSummary | null): boolean {
  if (!result) return false;
  return (
    result.finalStatus === 'COMPLETE' &&
    result.commitSha !== null &&
    result.deployId !== null &&
    result.healthStatus === 200 &&
    result.commitMatch === true
  );
}
