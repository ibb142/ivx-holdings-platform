import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';
import { verifyAllEnterpriseAgents } from '../services/ivx-autonomous-completion-campaign';
import {
  buildAppCompletionCampaign,
  loadControlState,
} from '../services/ivx-app-completion-campaign';
import { listCampaignDispatcherRecords } from '../services/ivx-campaign-dispatcher';
import { getSmsNotifierStatus } from '../services/ivx-autonomous-sms-notifier';
import { isDurableStoreConfigured } from '../services/ivx-durable-store';
import { ALL_ENTERPRISE_AGENTS, getFunctionalGroups, getAgentsByFunctionalGroup } from '../services/ivx-enterprise-master-registry';
import { getSeniorDeveloperJob } from '../services/ivx-senior-developer-worker';
import { resolveMainSha, runGlobalCertificationSupervision } from '../services/ivx-global-certification-supervisor';
import { readAllWorkflowAttributions } from '../services/ivx-agent-work-ledger';
import type { WorkflowAttribution } from '../services/ivx-agent-work-ledger';

export const IVX_AUTONOMOUS_CONTROL_PLANE_MARKER = 'ivx-autonomous-control-plane-v5-2026-08-25';

const HEARTBEAT_LIVE_TTL_MS = 120_000;

/**
 * Short-lived in-memory cache for the control-plane GET telemetry payload.
 * The endpoint performs many durable-store reads (~5s cold); the radar samples
 * it with a 4s timeout, so uncached reads always looked like failures. This is
 * telemetry (not mutation state) — 120s staleness is fail-safe and each miss
 * refreshes the cache.
 */
let controlPlaneCache: { at: number; body: string } | null = null;
const CONTROL_PLANE_CACHE_TTL_MS = 240_000;
const ACTIVE_WORKER_STATUSES = new Set(['running', 'patching', 'testing', 'committing', 'deploying', 'verifying']);

function countStatuses<T extends { status: string }>(items: T[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function heartbeatState(lastHeartbeatAt?: string | null): 'live' | 'stale' | 'none' {
  if (!lastHeartbeatAt) return 'none';
  const timestamp = Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(timestamp)) return 'stale';
  return Date.now() - timestamp <= HEARTBEAT_LIVE_TTL_MS ? 'live' : 'stale';
}

function inferOperatingRegion(text: string): string {
  const value = text.toLowerCase();
  const regions: Array<[RegExp, string]> = [
    [/\bcolombia\b|\bbogot[aá]\b|\bmedell[ií]n\b|\bcali\b/, 'COLOMBIA'],
    [/\bguatemala\b|\bguatemala city\b/, 'GUATEMALA'],
    [/\beurope\b|\beu\b|\beuropean union\b/, 'EUROPE'],
    [/\bunited kingdom\b|\buk\b|\blondon\b/, 'UNITED KINGDOM'],
    [/\bspain\b|\bmadrid\b|\bbarcelona\b/, 'SPAIN'],
    [/\bfrance\b|\bparis\b/, 'FRANCE'],
    [/\bgermany\b|\bberlin\b|\bfrankfurt\b/, 'GERMANY'],
    [/\bitaly\b|\brome\b|\bmilan\b/, 'ITALY'],
    [/\bportugal\b|\blisbon\b/, 'PORTUGAL'],
    [/\bmexico\b|\bmexico city\b/, 'MEXICO'],
    [/\bbrazil\b|\bs[aã]o paulo\b/, 'BRAZIL'],
    [/\bargentina\b|\bbuenos aires\b/, 'ARGENTINA'],
    [/\bchile\b|\bsantiago\b/, 'CHILE'],
    [/\bperu\b|\blima\b/, 'PERU'],
    [/\bpanama\b/, 'PANAMA'],
    [/\bcosta rica\b/, 'COSTA RICA'],
    [/\bcanada\b|\btoronto\b|\bvancouver\b/, 'CANADA'],
    [/\bunited states\b|\busa\b|\bu\.s\.\b|\bflorida\b|\bmiami\b|\bnew york\b|\btexas\b|\bcalifornia\b/, 'UNITED STATES'],
    [/\buae\b|\bunited arab emirates\b|\bdubai\b|\babu dhabi\b/, 'UAE'],
    [/\bsaudi arabia\b|\briyadh\b/, 'SAUDI ARABIA'],
    [/\bindia\b|\bmumbai\b|\bdelhi\b/, 'INDIA'],
    [/\bsingapore\b/, 'SINGAPORE'],
    [/\bjapan\b|\btokyo\b/, 'JAPAN'],
    [/\baustralia\b|\bsydney\b|\bmelbourne\b/, 'AUSTRALIA'],
    [/\bafrica\b/, 'AFRICA'],
    [/\blatin america\b|\blatam\b/, 'LATIN AMERICA'],
    [/\basia\b|\bapac\b/, 'ASIA PACIFIC'],
    [/\bglobal\b|\bworldwide\b|\binternational\b/, 'GLOBAL'],
  ];
  for (const [pattern, label] of regions) {
    if (pattern.test(value)) return label;
  }
  return 'GLOBAL / UNASSIGNED';
}

function presenceFor(workerStatus: string | null, heartbeat: 'live' | 'stale' | 'none', enabled: boolean): string {
  if (!enabled) return 'OFFLINE';
  const current = (workerStatus || '').toLowerCase();
  if (['failed', 'blocked', 'cancelled'].includes(current)) return 'ATTENTION';
  if (current === 'queued') return 'QUEUED';
  if (ACTIVE_WORKER_STATUSES.has(current)) {
    if (heartbeat === 'live') return 'WORKING';
    return 'STALE';
  }
  return 'IDLE';
}

export function autonomousControlPlaneOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleAutonomousControlPlaneVerifyAll(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'IVX owner authentication required.' }, 401);
  }

  try {
    const result = await verifyAllEnterpriseAgents();
    const control = await loadControlState();
    const records = await listCampaignDispatcherRecords();
    const campaign = buildAppCompletionCampaign(control, records);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      action: 'verify_all_agents',
      generatedAt: new Date().toISOString(),
      result: {
        verified: result.verified,
        total: result.total,
        registryValid: result.registryValid,
        sourceFile: result.sourceFile,
        evidence: result.evidence,
      },
      campaign: {
        marker: campaign.marker,
        enabled: !campaign.control.paused && !campaign.control.stopped,
        counts: campaign.counts,
        assignedTotal: campaign.totals.agentsAssigned,
        expectedTotal: 112,
        dispatcherRecords: records.length,
        note: 'Registry verification proves structure only. Live-work proof comes only from dispatcher record + matching real worker job + active status + fresh heartbeat.',
      },
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER, error: error instanceof Error ? error.message : 'Unable to verify agents.' }, 500);
  }
}

export async function handleAutonomousControlPlaneGet(request: Request): Promise<Response> {
  try {
    // Trusted GitHub Actions OIDC machine identity (repo/ref/workflow-scoped,
    // JWKS-verified, short-lived) is accepted as READ-ONLY machine auth for the
    // autonomous radar/nervous system. Every other caller still requires the
    // registered owner bearer session. No claims are weakened here.
    const trustedMachine = await verifyIVXGitHubActionsOIDCRequest(request);
    if (!trustedMachine) await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'IVX owner authentication required.' }, 401);
  }

  try {
    // GLOBAL SUPERVISOR (owner mandate 2026-08-28): Autonomous must never issue
    // GREEN/CERTIFIED/10/10/HEALTHY/COMPLETE while ANY required workflow on the
    // same MAIN SHA is RED. The supervision cycle (collect all required
    // workflows on MAIN_SHA + production SHA parity + auto repair dispatch)
    // runs in parallel with the campaign read; its verdict gates every
    // certification claim in this response.
    const supervisionPromise = resolveMainSha()
      .then((sha) => (sha ? runGlobalCertificationSupervision(sha) : null))
      .catch(() => null);
    if (controlPlaneCache && Date.now() - controlPlaneCache.at < CONTROL_PLANE_CACHE_TTL_MS) {
      return new Response(controlPlaneCache.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-IVX-Control-Plane-Cache': 'hit',
        },
      });
    }
    const control = await loadControlState();
    const dispatcherRecords = await listCampaignDispatcherRecords();
    const campaign = buildAppCompletionCampaign(control, dispatcherRecords);
    // OWNER MANDATE 2026-08-28 (Mission G fix): GitHub Actions / War Room work
    // is correlated into the canonical per-IA state via the workflow
    // attribution ledger, so commits that never flowed through a worker job
    // still count — the dashboard no longer shows "0 commits".
    const attributionRecords = await readAllWorkflowAttributions().catch(() => [] as WorkflowAttribution[]);
    const latestAttributionByAgent = new Map<number, WorkflowAttribution>();
    for (const attr of attributionRecords) {
      latestAttributionByAgent.set(attr.agentNumber, attr);
    }
    const sms = getSmsNotifierStatus();
    const enabled = !campaign.control.paused && !campaign.control.stopped;
    const agentStatuses = countStatuses(campaign.assignments);
    const total = campaign.assignments.length;
    const blocked = (agentStatuses.BLOCKED || 0) + (agentStatuses.PENDING_OWNER || 0);
    const failed = agentStatuses.FAILED || 0;
    const running = (agentStatuses.RUNNING || 0) + (agentStatuses.FIXING || 0) + (agentStatuses.TESTING || 0) + (agentStatuses.DEPLOYING || 0) + (agentStatuses.VERIFYING || 0);
    const queued = agentStatuses.QUEUED || 0;

    const registryByNumber = new Map(ALL_ENTERPRISE_AGENTS.map((agent) => [agent.agentNumber, agent]));
    const enrichedAgents = await Promise.all(campaign.assignments.map(async (item) => {
      const registry = registryByNumber.get(item.agentNumber);
      const job = item.workerJobId ? await getSeniorDeveloperJob(item.workerJobId) : null;
      const heartbeatAt = job?.lastHeartbeatAt || item.lastHeartbeatAt || null;
      const heartbeat = heartbeatState(heartbeatAt);
      const currentTask = job?.input.goal || item.assignedTask || null;
      const operatingRegion = inferOperatingRegion(`${currentTask || ''} ${job?.stageDetail || item.currentStep || ''} ${registry?.mission || ''}`);
      const workerStatus = job?.status || item.workerStatus || null;
      const attr = latestAttributionByAgent.get(item.agentNumber) ?? null;
      // Commit/PR evidence: worker job result FIRST, workflow attribution fallback.
      const evidenceCommitSha = job?.result?.commitSha ?? attr?.commitSha ?? null;
      const evidencePrNumber = job?.result?.prNumber ?? attr?.prNumber ?? null;
      const hasRealDispatcherRecord = dispatcherRecords.some(
        (record) => record.agentNumber === item.agentNumber && record.workerJobId === item.workerJobId && Boolean(record.workerJobId),
      );
      const hasRealJob = Boolean(
        hasRealDispatcherRecord &&
        item.workerJobId &&
        job?.jobId === item.workerJobId,
      );
      const hasLiveWorkEvidence = Boolean(
        hasRealJob &&
        heartbeat === 'live' &&
        workerStatus &&
        ACTIVE_WORKER_STATUSES.has(workerStatus.toLowerCase()) &&
        currentTask &&
        job?.startedAt &&
        job?.lastHeartbeatAt,
      );
      const completedWithEvidence = Boolean(
        hasRealJob &&
        job?.status === 'completed' &&
        job.result &&
        job.result.finalStatus === 'COMPLETE' &&
        (job.result.testsRun ? job.result.testsPassed : true) &&
        (job.result.typecheckRun ? job.result.typecheckPassed : true),
      );
      return {
        ...item,
        role: registry?.role || item.role || null,
        functionalGroup: registry?.functionalGroup || 'UNASSIGNED',
        mission: registry?.mission || null,
        operatingRegion,
        presence: presenceFor(workerStatus, heartbeat, enabled),
        worker: {
          registered: Boolean(registry),
          dispatcherRecordPresent: hasRealDispatcherRecord,
          hasRealJob,
          hasLiveWorkEvidence,
          completedWithEvidence,
          heartbeat,
          lastHeartbeatAt: heartbeatAt,
          stage: job?.stage || item.currentStep || null,
          progressPercent: typeof job?.progressPercent === 'number' ? job.progressPercent : item.progress,
          stageDetail: job?.stageDetail || item.currentStep || null,
          currentTask,
          startedAt: job?.startedAt || item.startedAt || null,
          finishedAt: job?.finishedAt || item.finishedAt || null,
          attempts: job?.attempts || item.attempts || 0,
          workerStatus,
          commitSha: evidenceCommitSha,
          prNumber: evidencePrNumber,
          workflowAttribution: attr ? { githubRunId: attr.githubRunId, githubJobId: attr.githubJobId, commitSha: attr.commitSha, prNumber: attr.prNumber, branch: attr.branch, source: attr.source, recordedAt: attr.recordedAt } : null,
        },
      };
    }));

    const heartbeating = enrichedAgents.filter((agent) => agent.worker.heartbeat === 'live' && agent.worker.hasRealJob).length;
    const staleHeartbeats = enrichedAgents.filter((agent) => agent.worker.heartbeat === 'stale' && agent.worker.hasRealJob).length;
    const realWorkingAgents = enrichedAgents.filter((agent) => agent.worker.hasLiveWorkEvidence);
    const realWorkingCount = realWorkingAgents.length;
    const completedWithEvidence = enrichedAgents.filter((agent) => agent.worker.completedWithEvidence).length;
    const activeJobs = enrichedAgents.filter((agent) => agent.worker.hasRealJob && ['WORKING', 'QUEUED', 'STALE'].includes(agent.presence)).length;
    const lastHeartbeatAt = enrichedAgents
      .filter((agent) => agent.worker.hasRealJob)
      .map((agent) => agent.worker.lastHeartbeatAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;

    const groups = getFunctionalGroups();
    const groupBreakdown = groups.map((group) => {
      const groupAgents = getAgentsByFunctionalGroup(group);
      const numbers = new Set(groupAgents.map((agent) => agent.agentNumber));
      const items = enrichedAgents.filter((agent) => numbers.has(agent.agentNumber));
      return {
        name: group,
        total: items.length,
        realWorking: items.filter((agent) => agent.worker.hasLiveWorkEvidence).length,
        queued: items.filter((agent) => agent.presence === 'QUEUED').length,
        idle: items.filter((agent) => agent.presence === 'IDLE').length,
        stale: items.filter((agent) => agent.presence === 'STALE').length,
        attention: items.filter((agent) => agent.presence === 'ATTENTION').length,
      };
    });

    const dispatcherCoverage = new Set(dispatcherRecords.map((record) => record.agentNumber)).size;

    const supervision = await supervisionPromise;
    const globalStatus = supervision?.result.status ?? 'PENDING';
    const globalCertified = supervision ? supervision.result.certified : false;
    const failedRequired = supervision?.result.failedRequired ?? [];
    const repairDispatches = supervision?.dispatches ?? [];

    const response = ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      generatedAt: new Date().toISOString(),
      source: 'app_completion_campaign -> campaign_dispatcher -> ivx_senior_developer_worker -> durable_evidence',
      enterprise: {
        totalAgents: total,
        expectedAgents: 112,
        registered: enrichedAgents.filter((agent) => agent.worker.registered).length,
        dispatcherRecords: dispatcherRecords.length,
        dispatcherAgentCoverage: dispatcherCoverage,
        heartbeating,
        staleHeartbeats,
        realWorkingAgents: realWorkingCount,
        completedWithEvidence,
        activeJobs,
        lastHeartbeatAt,
        registryShapeValid: total === 112,
        enabled,
        running,
        queued,
        blocked,
        failed,
        durableState: isDurableStoreConfigured(),
        workflowAttributionRecords: attributionRecords.length,
        commitsWithEvidence: enrichedAgents.filter((agent) => agent.worker.commitSha).length,
        prsWithEvidence: enrichedAgents.filter((agent) => agent.worker.prNumber).length,
        productionClaimsRequireProof: true,
        paidSpendRequiresOwnerApproval: true,
        destructiveActionsRequireOwnerApproval: true,
      },
      agents: {
        total: enrichedAgents.length,
        statuses: agentStatuses,
        items: enrichedAgents,
      },
      functionalGroups: groupBreakdown,
      sms: {
        marker: sms.marker,
        phoneConfigured: sms.phoneConfigured,
        phoneMasked: sms.phoneMasked,
        schedulerRunning: sms.schedulerRunning,
        lastSmsSentAt: sms.lastSmsSentAt,
        smsSentToday: sms.smsSentToday,
        smsDailyCap: sms.smsDailyCap,
      },
      certification: {
        liveReady: enabled && isDurableStoreConfigured() && dispatcherCoverage === 112 && globalCertified,
        certified: globalCertified,
        globalStatus,
        globalSupervisorBlockedBy: failedRequired,
        globalRepairDispatches: repairDispatches.map((dispatch) => ({ workflow: dispatch.workflow, jobId: dispatch.jobId, dispatched: dispatch.dispatched, detail: dispatch.detail })),
        certificationPolicy: 'Autonomous may certify ONLY when every required certification workflow is SUCCESS on the exact MAIN SHA and production /health commit == MAIN SHA. Any RED blocks GREEN/CERTIFIED/10/10/HEALTHY/COMPLETE.',
        registryVerifiedComplete: enrichedAgents.filter((agent) => agent.worker.registered).length === 112,
        dispatcherMappedComplete: dispatcherCoverage === 112,
        campaignComplete: completedWithEvidence === 112 && globalCertified,
        liveWorkforceObserved: realWorkingCount > 0,
        liveWorkingAgents: realWorkingCount,
        full112RealWorkObserved: realWorkingCount === 112,
        proofPolicy: 'WORKING requires: canonical dispatcher assignment + matching real ivx-senior-developer-worker jobId + active worker status + current task + startedAt + real heartbeat <=120s. Registry-only and synthetic heartbeat rows never count.',
      },
    });
    controlPlaneCache = { at: Date.now(), body: await response.clone().text() };
    return response;
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER, error: error instanceof Error ? error.message : 'Unable to build Autonomous control-plane state.' }, 500);
  }
}
