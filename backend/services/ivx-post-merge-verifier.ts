import { randomUUID } from 'node:crypto';
import type { IVXWorkerJob, IVXWorkerJobResult } from './ivx-senior-developer-worker';
import type { PatrolObservation } from './ivx-autonomous-recovery-health';
import { verifiedPatrolObservations } from './ivx-fleet-patrol-observations';

type DeployReceipt = { serviceId: string; deployId: string; commitSha: string; status: string; finishedAt: string | null };
type EndpointReceipt = { endpoint: string; httpStatus: number | null; commitSha: string | null; ok: boolean };
export type PostMergeReceipt = {
  expectedSha: string; observedAt: string;
  status: 'unavailable' | 'awaiting_deploy' | 'awaiting_health' | 'awaiting_acceptance' | 'verified';
  reason: string; api: DeployReceipt | null; worker: DeployReceipt | null;
  checks: EndpointReceipt[];
  acceptance: { unitId: string; outcome: string; evidenceId: string; contentHash: string } | null;
};
export type PostMergeCheckpoint = {
  version: 1; expectedSha: string; attempts: number; nextAttemptAt: string;
  leaseToken: string | null; leaseExpiresAt: string | null; receipt?: PostMergeReceipt;
};
export type PostMergeConfiguration = { apiKey: string; apiServiceId: string; workerServiceId: string; productionBaseUrl: string };

const SHA = /^[a-f0-9]{40}$/i;
const LEASE_MS = 90_000;
// Existing presence/header patrols cannot establish authentic decoded footage.
const VIDEO_UNITS = new Set(['deals.videos-present', 'media.deal-videos-resolvable',
  'media.deal-videos-mime', 'reels.media-resolvable', 'reels.media-mime']);
export function isPostMergeCandidate(job: IVXWorkerJob): boolean {
  return job.status === 'completed' && job.input.ownerApproved === true && job.input.executionMode === 'code_change'
    && job.result?.prMerged === true && SHA.test(job.result.prMergeCommitSha ?? '')
    && job.result.endToEndProductionComplete !== true;
}

/** GET only. A total deadline also bounds response bodies; redirects cannot forward credentials. */
export async function observePostMerge(job: IVXWorkerJob, config: PostMergeConfiguration,
  patrols: (sha: string) => Promise<PatrolObservation[]>, fetcher: typeof fetch = fetch,
  now: () => number = Date.now): Promise<PostMergeReceipt> {
  const expectedSha = job.result!.prMergeCommitSha!;
  const receipt: PostMergeReceipt = { expectedSha, observedAt: new Date(now()).toISOString(),
    status: 'unavailable', reason: 'configuration_unavailable', api: null, worker: null, checks: [], acceptance: null };
  const deadline = AbortSignal.timeout(25_000);
  const read = async (url: string, authenticated = false) => {
    const response = await fetcher(url, { method: 'GET', redirect: 'error',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]),
      headers: authenticated ? { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' }
        : { Accept: 'application/json', 'Cache-Control': 'no-store' } });
    // Read bounded JSON, never retain endpoint bodies or upstream diagnostic secrets.
    const reader = response.body?.getReader();
    let length = 0; const chunks: Uint8Array[] = [];
    if (reader) {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 256_000) throw new Error('response_too_large');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    let body: any = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* HTML is never health evidence. */ }
    return { status: response.status, ok: response.ok, body };
  };
  try {
    const base = new URL(config.productionBaseUrl);
    if (!config.apiKey || !/^srv-[a-z0-9]+$/.test(config.apiServiceId)
      || !/^srv-[a-z0-9]+$/.test(config.workerServiceId) || config.apiServiceId === config.workerServiceId
      || base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return receipt;
    const deployment = async (serviceId: string, type: string): Promise<DeployReceipt | null> => {
      const service = await read(`https://api.render.com/v1/services/${serviceId}`, true);
      if (!service.ok || service.body?.repo?.replace(/\.git$/, '') !== 'https://github.com/ibb142/ivx-holdings-platform'
        || service.body?.branch !== 'main' || service.body?.type !== type) throw new Error('service_identity_unverified');
      // Bounded history. A missing old deployment is unknown, never fabricated.
      const history = await read(`https://api.render.com/v1/services/${serviceId}/deploys?limit=100`, true);
      if (!history.ok || !Array.isArray(history.body)) throw new Error('deployment_history_unavailable');
      const matches = history.body.map((row: any) => row?.deploy ?? row)
        .filter((deploy: any) => deploy?.commit?.id === expectedSha);
      const deploy = matches.find((item: any) => item.status === 'live') ?? matches[0];
      if (!deploy || !/^dep-[a-z0-9]+$/.test(deploy.id)) return null;
      return { serviceId, deployId: deploy.id, commitSha: expectedSha, status: deploy.status,
        finishedAt: typeof deploy.finishedAt === 'string' ? deploy.finishedAt : null };
    };
    [receipt.api, receipt.worker] = await Promise.all([
      deployment(config.apiServiceId, 'web_service'), deployment(config.workerServiceId, 'background_worker'),
    ]);
    receipt.status = 'awaiting_deploy'; receipt.reason = 'exact_merge_deployment_not_live';
    if (receipt.api?.status !== 'live' || receipt.worker?.status !== 'live') return receipt;
    receipt.checks = await Promise.all(['/health', '/version', '/health/ready'].map(async path => {
      const endpoint = new URL(path, base).href;
      try {
        const response = await read(endpoint);
        const commitSha = typeof response.body?.commit === 'string' ? response.body.commit
          : typeof response.body?.sha === 'string' ? response.body.sha : null;
        return { endpoint, httpStatus: response.status, commitSha,
          ok: response.status === 200 && !!response.body && typeof response.body === 'object' && !Array.isArray(response.body)
            && response.body.ok !== false && response.body.degraded !== true && response.body.data_available !== false
            && (path === '/health/ready' ? response.body.ok === true && response.body.ready === true
              && response.body.status === 'ready' && ['ai', 'database', 'auth', 'queue'].every(name => response.body.checks?.[name]?.ok === true)
              && (commitSha === null || commitSha === expectedSha) : commitSha === expectedSha) };
      } catch { return { endpoint, httpStatus: null, commitSha: null, ok: false }; }
    }));
    receipt.status = 'awaiting_health'; receipt.reason = 'health_version_or_readiness_unverified';
    if (!receipt.checks.every(check => check.ok)) return receipt;
    receipt.status = 'awaiting_acceptance'; receipt.reason = 'task_acceptance_not_observed';
    const unitId = /^landing-remediation:[a-f0-9]{40}:(.+)$/i.exec(job.input.taskId ?? '')?.[1];
    if (!unitId) return receipt; // No generic health response can certify an arbitrary owner request.
    const rows = await patrols(expectedSha);
    const observations = verifiedPatrolObservations(rows, expectedSha, now());
    const deployedAt = Math.max(Date.parse(receipt.api.finishedAt ?? ''), Date.parse(receipt.worker.finishedAt ?? ''));
    for (const row of rows) {
      const observation = observations.get(row.assigned_agent_number);
      if (!observation || row.assigned_agent_number !== job.input.agentNumber
        || !Number.isFinite(deployedAt) || Date.parse(observation.startedAt) < deployedAt) continue;
      const record = JSON.parse(row.evidence!.summary.slice('LANDING_P0_RESULT '.length));
      if (record.unit_id !== unitId || !Array.isArray(record.evidence) || !record.evidence.length
        || !Number.isFinite(record.api_checks) || !Number.isFinite(record.browser_checks)
        || record.api_checks < 0 || record.browser_checks < 0 || record.api_checks + record.browser_checks < 1) continue;
      receipt.acceptance = { unitId, outcome: observation.outcome,
        evidenceId: observation.evidenceId, contentHash: observation.contentHash };
      if (VIDEO_UNITS.has(unitId)) receipt.reason = 'authentic_media_acceptance_missing';
      else if (observation.outcome === 'PASS' && job.result?.ciChecksGreen === true
        && job.result.testsRun && job.result.testsPassed) {
        receipt.status = 'verified'; receipt.reason = 'exact_merge_and_task_acceptance_verified';
      } else receipt.reason = 'task_acceptance_or_validation_failed';
    }
    // Fence a deployment change while the durable functional observation was read.
    const finalVersion = await read(new URL('/version', base).href);
    if (finalVersion.status !== 200 || finalVersion.body?.commit !== expectedSha) {
      receipt.status = 'awaiting_health'; receipt.reason = 'production_changed_during_verification';
    }
    return receipt;
  } catch { receipt.status = 'unavailable'; receipt.reason = 'observation_unavailable'; return receipt; }
  finally { receipt.observedAt = new Date(now()).toISOString(); }
}

export function applyPostMergeReceipt(result: IVXWorkerJobResult, receipt: PostMergeReceipt): IVXWorkerJobResult {
  if (receipt.expectedSha !== result.prMergeCommitSha) throw new Error('Post-merge SHA changed');
  const verified = receipt.status === 'verified';
  const infrastructure = receipt.checks.length === 3 && receipt.checks.every(check => check.ok)
    && receipt.api?.status === 'live' && receipt.worker?.status === 'live';
  const health = receipt.checks.find(check => new URL(check.endpoint).pathname === '/health') ?? null;
  const version = receipt.checks.find(check => new URL(check.endpoint).pathname === '/version') ?? null;
  const record = result.executionRecord ? structuredClone(result.executionRecord) : null;
  if (record) {
    record.deployment_id = receipt.api?.deployId ?? null;
    record.verified_at = verified ? Date.parse(receipt.observedAt) : null;
    record.remaining_work = [...record.remaining_work.filter(item => !item.startsWith('post_merge:')),
      ...(verified ? [] : [`post_merge:${receipt.reason}`])];
    record.production_checks = [
      ...record.production_checks.filter(check => !check.check.startsWith('post_merge:')),
      ...receipt.checks.map(check => ({ check: `post_merge:${new URL(check.endpoint).pathname}`,
        result: `${check.httpStatus ?? 'unavailable'}; merge=${receipt.expectedSha}; observed=${check.commitSha ?? 'unknown'}`,
        timestamp: Date.parse(receipt.observedAt), ok: check.ok, httpStatus: check.httpStatus, url: check.endpoint })),
    ];
    record.evidence = [...record.evidence.filter(evidence => evidence.kind !== 'post_merge_verification'),
      { kind: 'post_merge_verification', value: JSON.stringify(receipt), timestamp: receipt.observedAt, verified }];
    if (receipt.acceptance) {
      const criterion = `landing:${receipt.acceptance.unitId}`;
      if (!record.acceptance_criteria.includes(criterion)) record.acceptance_criteria.push(criterion);
      record.qa_results = [...record.qa_results.filter(check => check.scenario !== criterion),
        { platform: 'production', scenario: criterion, passed: receipt.acceptance.outcome === 'PASS',
          evidence: `${receipt.acceptance.evidenceId}:${receipt.acceptance.contentHash}` }];
    }
  }
  // The original PR-head commit and approval flags remain unchanged. Deploy
  // parity explicitly belongs to the merge SHA saved in this receipt.
  return { ...result, endToEndProductionComplete: verified, deployVerified: Boolean(infrastructure),
    deployId: receipt.api?.deployId ?? null, deployStatus: receipt.api?.status ?? null,
    liveCommit: version?.commitSha ?? null, commitMatch: Boolean(infrastructure), healthOk: health?.ok ?? false,
    healthStatus: health?.httpStatus ?? null, healthResponse: health, versionResponse: version,
    ...(record ? { executionRecord: record } : {}) };
}

export type PostMergeStore = {
  list: () => Promise<IVXWorkerJob[]>;
  claim: (expected: IVXWorkerJob, claimed: IVXWorkerJob) => Promise<void>;
  // Queue CAS + canonical proof ledger are one transaction. No partial seals.
  commit: (claimed: IVXWorkerJob, completed: IVXWorkerJob) => Promise<void>;
};

/** The durable queue is the registry; leases and retry times survive restarts. */
export function createPostMergeReconciler(store: PostMergeStore, observe: (job: IVXWorkerJob) => Promise<PostMergeReceipt>,
  now: () => number = Date.now) {
  let running = false;
  return async (): Promise<boolean> => {
    if (running) return false;
    running = true;
    let saved = false;
    try {
      const jobs = (await store.list()).filter(job => {
        const checkpoint = job.result?.postMergeVerification;
        return isPostMergeCandidate(job) && (!checkpoint || ((Date.parse(checkpoint.nextAttemptAt) || 0) <= now()
          && (!checkpoint.leaseExpiresAt || (Date.parse(checkpoint.leaseExpiresAt) || 0) <= now())));
      }).sort((a, b) => (a.result?.postMergeVerification?.nextAttemptAt ?? '').localeCompare(b.result?.postMergeVerification?.nextAttemptAt ?? '')
        || b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
      for (const job of jobs) {
        try {
          const claimed = structuredClone(job);
          const attempts = (job.result?.postMergeVerification?.attempts ?? 0) + 1;
          claimed.result!.postMergeVerification = { version: 1, expectedSha: job.result!.prMergeCommitSha!, attempts,
            nextAttemptAt: new Date(now() + LEASE_MS).toISOString(), leaseToken: randomUUID(),
            leaseExpiresAt: new Date(now() + LEASE_MS).toISOString() };
          await store.claim(job, claimed); // A concurrent winner prevents duplicate external probes.
          const receipt = await observe(claimed);
          if (now() >= Date.parse(claimed.result!.postMergeVerification.leaseExpiresAt!)) continue;
          const completed = structuredClone(claimed);
          completed.result = applyPostMergeReceipt(claimed.result!, receipt);
          completed.result.postMergeVerification = { ...claimed.result!.postMergeVerification,
            leaseToken: null, leaseExpiresAt: null, receipt,
            nextAttemptAt: new Date(now() + Math.min(900_000, 60_000 * 2 ** Math.min(attempts - 1, 4))).toISOString() };
          await store.commit(claimed, completed);
          saved = true;
        } catch { /* CAS loss/outage leaves a recoverable checkpoint, never a fabricated success. */ }
      }
      return saved;
    } finally { running = false; }
  };
}
