import { createHash } from 'node:crypto';
import { finalizeEvidenceTask, heartbeat, type Task } from './ivx-autonomous-task-engine';
import { checkEmergencyStop } from './ivx-emergency-stop-gate';
import { fetchLandingGitHubRead } from './ivx-landing-github-read';
import { readPostgresFleetLeaseRows, readPostgresFleetProcessObservation, readPostgresPatrolObservations } from './ivx-postgres-autonomous-task-store';
import { verifiedPatrolObservations } from './ivx-fleet-patrol-observations';

const MISSION = 'quantum_agi_learning_loop';
const API = 'https://api.ivxholding.com';
type Check = { name: string; ok: boolean; detail: string };
type Dependencies = {
  heartbeat: typeof heartbeat;
  control: typeof checkEmergencyStop;
  finalize: typeof finalizeEvidenceTask;
  processes: typeof readPostgresFleetProcessObservation;
  leases: typeof readPostgresFleetLeaseRows;
  patrols: typeof readPostgresPatrolObservations;
  github: typeof fetchLandingGitHubRead;
  fetcher: typeof fetch;
  now: () => number;
};
const defaults: Dependencies = { heartbeat, control: checkEmergencyStop, finalize: finalizeEvidenceTask,
  processes: readPostgresFleetProcessObservation, leases: readPostgresFleetLeaseRows, patrols: readPostgresPatrolObservations,
  github: fetchLandingGitHubRead, fetcher: fetch, now: Date.now };

/** Dispatch a typed owner mission, never instructions parsed from free text. */
export function isContinuityVerificationTask(task: Pick<Task, 'taskType' | 'milestone' | 'idempotencyKey'>): boolean {
  return task.taskType === 'qa' && task.milestone === MISSION
    && /^owner-mission:quantum_agi_learning_loop:\d{4}-\d{2}-\d{2}$/.test(task.idempotencyKey);
}

/** One read-only observation under the original core lease. This deliberately
 * leaves unproved migration criteria blocked: an API response, process row or
 * workflow summary cannot certify the legacy dispatcher or continuous 24/7 work. */
export async function executeContinuityVerification(task: Task, workerId: string, sourceSha: string, dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  const started = deps.now(), startedAt = new Date(started).toISOString();
  if (!isContinuityVerificationTask(task) || task.state !== 'RUNNING' || !task.taskId
    || task.leaseHolder !== workerId || !(Date.parse(task.leaseExpiresAt ?? '') > started)
    || !/^[a-f0-9]{40}$/i.test(sourceSha)) throw new Error('A current leased continuity QA task and source SHA are required');
  const checks: Check[] = [];
  const assertAuthority = async () => {
    const lease = await deps.heartbeat(task.taskId, workerId);
    if (!lease.ok) throw new Error('Continuity worker lease is unavailable');
    const control = await deps.control();
    if (control.active || control.source === 'unavailable') throw new Error('Continuity verification paused by owner control');
  };
  const record = async (name: string, probe: () => Promise<string>) => {
    try { checks.push({ name, ok: true, detail: await probe() }); }
    catch { checks.push({ name, ok: false, detail: 'Read failed or required evidence was not observed' }); }
  };
  const publicJson = async (path: string) => {
    const response = await deps.fetcher(API + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (!response.ok || response.headers.get('x-ivx-data-state') === 'unavailable') throw new Error('Public read unavailable');
    const value = await response.json();
    if (value?.code === 'PUBLIC_DATA_UNAVAILABLE' || value?.data_available === false) throw new Error('Public data unavailable');
    return value;
  };
  try {
    await assertAuthority();
    await Promise.all([
      record('readiness', async () => {
        const data = await publicJson('/health/ready');
        if (data.ok !== true || data.ready !== true) throw new Error('Readiness not confirmed');
        return 'GET /health/ready returned a successful readiness response';
      }),
      record('reels', async () => {
        const data = await publicJson('/api/reels?limit=1');
        if (!Array.isArray(data.videos) || !data.videos.length) throw new Error('Empty reels');
        return `${data.videos.length} published Reel(s) returned; playback needs its separate mobile gate`;
      }),
      record('home_feed', async () => {
        const data = await publicJson('/api/ivx/video-platform/home-feed?limit=1');
        if (!Array.isArray(data.blocks) || !data.blocks.length) throw new Error('Empty home feed');
        return `${data.blocks.length} home feed block(s) returned`;
      }),
      record('process_heartbeats', async () => {
        const observation = await deps.processes(), now = deps.now();
        const fresh = (at: string, maxAge: number) => now - Date.parse(at) >= 0 && now - Date.parse(at) <= maxAge;
        if (!fresh(observation.measuredAt, 15_000)) throw new Error('Stale observation');
        const current = observation.instances.filter(row => row.commitSha === sourceSha && !row.draining
          && row.sharedState && row.sharedWorkerQueue && fresh(row.lastSeenAt, 45_000));
        const api = new Set(current.filter(row => row.role === 'api' && row.processRole === 'api').map(row => row.instanceId)).size;
        const workers = new Set(current.filter(row => row.role === 'worker' && row.processRole === 'worker').map(row => row.instanceId)).size;
        checks.push({ name: 'process_counts', ok: api >= 2 && workers >= 2,
          detail: `${api} API and ${workers} worker processes on the observed source; process presence is not model execution` });
        if (api < 2 || workers < 2) throw new Error('Insufficient current processes');
        return 'Two API and two worker processes have recent shared-state heartbeats';
      }),
    ]);
    await assertAuthority();
    await record('fleet_activity', async () => {
      const [leases, patrols] = await Promise.all([deps.leases(), deps.patrols(sourceSha)]);
      if (leases.length >= 1000) throw new Error('Truncated lease evidence');
      const now = deps.now();
      const active = leases.filter(row => /^agent:ivx_holdings_(?:[1-9]|[1-9]\d|10\d|11[0-2])$/.test(row.leaseHolder)
        && Date.parse(row.leaseExpiresAt ?? '') > now);
      const fresh = active.filter(row => now - Date.parse(row.lastHeartbeatAt) >= 0 && now - Date.parse(row.lastHeartbeatAt) <= 60_000);
      const observations = verifiedPatrolObservations(patrols, sourceSha, now);
      const detail = `${new Set(active.map(row => row.leaseHolder)).size} active lease holders, ${new Set(fresh.map(row => row.leaseHolder)).size} fresh heartbeats, ${observations.size} patrol observations in 120 seconds; no model execution inferred`;
      checks.push({ name: 'fleet_counts', ok: true, detail });
      if (!fresh.length && !observations.size) throw new Error('No recent fleet activity');
      return detail;
    });
    await assertAuthority();
    await record('current_ci', async () => {
      const response = await deps.github(`actions/runs?head_sha=${sourceSha}&per_page=100`);
      if (!response.ok) throw new Error('CI unavailable');
      const data = await response.json();
      if (!Number.isInteger(data.total_count) || data.total_count < 1 || data.total_count > 100
        || !Array.isArray(data.workflow_runs) || data.workflow_runs.length !== data.total_count
        || data.workflow_runs.some((run: { head_sha?: string }) => run.head_sha !== sourceSha)) throw new Error('Incomplete CI evidence');
      const pending = data.workflow_runs.filter((run: { status?: string }) => run.status !== 'completed').length;
      const failed = data.workflow_runs.filter((run: { status?: string; conclusion?: string }) => run.status === 'completed' && run.conclusion !== 'success').length;
      checks.push({ name: 'ci_counts', ok: pending === 0 && failed === 0,
        detail: `${data.total_count} workflow runs on ${sourceSha}; ${pending} pending, ${failed} not successful` });
      if (pending || failed) throw new Error('CI not complete');
      return 'All observed workflow runs on this source succeeded; branch protection remains independently enforced';
    });
    await record('source_parity', async () => {
      const version = await publicJson('/version');
      const response = await deps.github('commits/main');
      if (!response.ok || version.commit !== sourceSha || (await response.json()).sha !== sourceSha) throw new Error('Source changed during observation');
      return `Worker, API and main matched ${sourceSha} at the end of this observation`;
    });
    // Neither this runtime nor git.deploymentEnabled=false can attest the
    // old dispatcher's effective control plane. Keep that missing proof explicit.
    checks.push({ name: 'legacy_dispatcher', ok: false, detail: 'Legacy dispatcher shutdown requires evidence from its actual Vercel project; not inferred from repository configuration' });
    checks.push({ name: 'continuous_execution', ok: false, detail: 'This bounded observation does not supply a continuous execution archive or certify 112 model executions' });
    await assertAuthority();
    const completedAt = new Date(deps.now()).toISOString();
    const summary = 'IVX_CONTINUITY_OBSERVATION ' + JSON.stringify({ v: 1, taskId: task.taskId, mission: MISSION,
      idempotencyKey: task.idempotencyKey, assignedAgentNumber: task.assignedAgentNumber, sourceSha,
      startedAt, completedAt, scope: 'bounded_read_only_verification', observationExecuted: true, recoveryVerified: false, checks });
    const blocker = `CONTINUITY_EVIDENCE_PENDING: ${checks.filter(check => !check.ok).map(check => check.name).join(', ')}`;
    const finalized = await deps.finalize({ taskId: task.taskId, workerId, outcome: 'BLOCKED', blocker,
      evidence: { evidenceType: 'test_result', source: `continuity-verification:${task.taskId}`, summary,
        commitSha: sourceSha, deploymentId: null, contentHash: createHash('sha256').update(summary).digest('hex') } });
    return { finalized, startedAt, completedAt, seconds: (deps.now() - started) / 1000 };
  } catch {
    // Do not replay a possibly committed finalization or start more reads.
    // Existing durable recovery reconciles the same taskId before restarting.
    return { finalized: { ok: false, task: null, error: 'Continuity authority or persistence unavailable; reconcile the durable task before retrying', evidenceId: null, states: [] },
      startedAt, completedAt: new Date(deps.now()).toISOString(), seconds: 0 };
  }
}
