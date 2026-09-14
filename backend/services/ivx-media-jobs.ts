/**
 * IVX Media Jobs — backend lifecycle store for heavy media-understanding tasks.
 *
 * State machine:
 *   queued → running → analyzing_media → generating_answer → completed
 *                                                          → failed
 *
 * Stored fields per job:
 *   - id, ownerId, mediaCount, mediaTypes (record),
 *   - state, progress 0..100,
 *   - logs[] (timestamped phase entries),
 *   - finalResult (string | null),
 *   - errorState ({ message, code, attempts } | null),
 *   - retryCount (number, max 1 for media analysis retry),
 *   - createdAt, updatedAt, completedAt.
 */

export type IVXMediaJobState =
  | 'queued'
  | 'running'
  | 'analyzing_media'
  | 'generating_answer'
  | 'completed'
  | 'failed';

export type IVXMediaJobLog = {
  ts: string;
  state: IVXMediaJobState;
  message: string;
};

export type IVXMediaJobErrorState = {
  message: string;
  code: string;
  attempts: number;
};

export type IVXMediaJob = {
  id: string;
  ownerId: string | null;
  mediaCount: number;
  mediaTypes: Record<string, number>;
  state: IVXMediaJobState;
  progress: number;
  logs: IVXMediaJobLog[];
  finalResult: string | null;
  errorState: IVXMediaJobErrorState | null;
  retryCount: number;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type IVXMediaJobCreateInput = {
  ownerId?: string | null;
  mediaCount: number;
  mediaTypes: Record<string, number>;
  prompt: string;
};

const JOBS = new Map<string, IVXMediaJob>();
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_LOGS_PER_JOB = 60;

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `mjob-${crypto.randomUUID()}`;
  }
  return `mjob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function appendLog(job: IVXMediaJob, state: IVXMediaJobState, message: string): void {
  job.logs.push({ ts: nowIso(), state, message });
  if (job.logs.length > MAX_LOGS_PER_JOB) {
    job.logs.splice(0, job.logs.length - MAX_LOGS_PER_JOB);
  }
}

function progressFor(state: IVXMediaJobState): number {
  switch (state) {
    case 'queued': return 5;
    case 'running': return 20;
    case 'analyzing_media': return 55;
    case 'generating_answer': return 80;
    case 'completed': return 100;
    case 'failed': return 100;
    default: return 0;
  }
}

export function createMediaJob(input: IVXMediaJobCreateInput): IVXMediaJob {
  if (Object.keys(input.mediaTypes).length === 0) {
    throw new Error('at least one media type must be specified');
  }
  cleanupExpired();
  const id = genId();
  const ts = nowIso();
  const job: IVXMediaJob = {
    id,
    ownerId: input.ownerId ?? null,
    mediaCount: Math.max(0, Math.floor(input.mediaCount)),
    mediaTypes: { ...input.mediaTypes },
    state: 'queued',
    progress: progressFor('queued'),
    logs: [],
    finalResult: null,
    errorState: null,
    retryCount: 0,
    prompt: input.prompt,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
  };
  appendLog(job, 'queued', `Job queued with ${job.mediaCount} media item(s).`);
  JOBS.set(id, job);
  return job;
}

export function getMediaJob(id: string): IVXMediaJob | null {
  cleanupExpired();
  return JOBS.get(id) ?? null;
}

export function listMediaJobs(): IVXMediaJob[] {
  cleanupExpired();
  return Array.from(JOBS.values()).sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
}

export function transitionMediaJob(
  id: string,
  next: IVXMediaJobState,
  message: string,
): IVXMediaJob | null {
  const job = JOBS.get(id);
  if (!job) return null;
  if (job.state === 'completed' || job.state === 'failed') {
    return job;
  }
  job.state = next;
  job.progress = progressFor(next);
  job.updatedAt = nowIso();
  appendLog(job, next, message);
  if (next === 'completed' || next === 'failed') {
    job.completedAt = job.updatedAt;
  }
  return job;
}

export function completeMediaJob(id: string, finalResult: string): IVXMediaJob | null {
  const job = transitionMediaJob(id, 'completed', 'Final answer generated.');
  if (!job) return null;
  job.finalResult = finalResult;
  job.errorState = null;
  return job;
}

export function failMediaJob(
  id: string,
  errorMessage: string,
  code: string,
): IVXMediaJob | null {
  const job = JOBS.get(id);
  if (!job) return null;
  job.retryCount += 1;
  job.errorState = { message: errorMessage, code, attempts: job.retryCount };
  appendLog(job, 'failed', `Failure: ${code} — ${errorMessage}`);
  if (job.retryCount >= 2 || job.state === 'completed') {
    job.state = 'failed';
    job.progress = progressFor('failed');
    job.updatedAt = nowIso();
    job.completedAt = job.updatedAt;
    return job;
  }
  // First failure → reset to analyzing_media for one retry
  job.state = 'analyzing_media';
  job.progress = progressFor('analyzing_media');
  job.updatedAt = nowIso();
  appendLog(job, 'analyzing_media', `Retrying media analysis (attempt ${job.retryCount + 1}/2).`);
  return job;
}

export function shouldRetryMediaJob(job: IVXMediaJob): boolean {
  return job.state !== 'failed' && job.retryCount < 2;
}

function cleanupExpired(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of JOBS.entries()) {
    const created = Date.parse(job.createdAt);
    if (Number.isFinite(created) && created < cutoff) {
      JOBS.delete(id);
    }
  }
}

/** Test-only: clear all jobs. */
export function __resetMediaJobStoreForTests(): void {
  JOBS.clear();
}
