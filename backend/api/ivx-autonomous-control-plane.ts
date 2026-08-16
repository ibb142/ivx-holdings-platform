import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getCompletionCampaignState, verifyAllEnterpriseAgents } from '../services/ivx-autonomous-completion-campaign';
import { getSmsNotifierStatus } from '../services/ivx-autonomous-sms-notifier';
import { isDurableStoreConfigured } from '../services/ivx-durable-store';
import { ALL_ENTERPRISE_AGENTS, getFunctionalGroups, getAgentsByFunctionalGroup } from '../services/ivx-enterprise-master-registry';
import { getSeniorDeveloperJob } from '../services/ivx-senior-developer-worker';

export const IVX_AUTONOMOUS_CONTROL_PLANE_MARKER = 'ivx-autonomous-control-plane-v3-2026-08-16';

const HEARTBEAT_LIVE_TTL_MS = 120_000;

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

function presenceFor(status: string, workerStatus: string | null, heartbeat: 'live' | 'stale' | 'none', enabled: boolean): string {
  if (!enabled) return 'OFFLINE';
  const current = (workerStatus || status).toLowerCase();
  if (['failed', 'blocked', 'cancelled'].includes(current)) return 'ATTENTION';
  if (current === 'queued' || current === 'pending') return current === 'queued' ? 'QUEUED' : 'IDLE';
  if (['running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(current)) {
    return heartbeat === 'stale' ? 'STALE' : 'WORKING';
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
    const campaign = await getCompletionCampaignState();
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
        phase: campaign.phase,
        enabled: campaign.enabled,
        totals: campaign.totals,
        verifiedTotal: campaign.totals.verifiedAgents,
        expectedTotal: 112,
      },
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER, error: error instanceof Error ? error.message : 'Unable to verify agents.' }, 500);
  }
}

export async function handleAutonomousControlPlaneGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'IVX owner authentication required.' }, 401);
  }

  try {
    const campaign = await getCompletionCampaignState();
    const sms = getSmsNotifierStatus();
    const agentStatuses = countStatuses(campaign.agents);
    const verifiedTotal = campaign.totals.verifiedAgents;
    const total = campaign.agents.length;
    const blocked = agentStatuses.blocked || 0;
    const failed = agentStatuses.failed || 0;
    const running = agentStatuses.running || 0;
    const queued = agentStatuses.queued || 0;

    const registryByNumber = new Map(ALL_ENTERPRISE_AGENTS.map((agent) => [agent.agentNumber, agent]));
    const enrichedAgents = await Promise.all(campaign.agents.map(async (item) => {
      const agentNumber = Number.parseInt(item.id.split(':')[1] || '', 10);
      const registry = registryByNumber.get(agentNumber);
      const job = item.jobId ? await getSeniorDeveloperJob(item.jobId) : null;
      const heartbeat = heartbeatState(job?.lastHeartbeatAt || null);
      const currentTask = job?.input.goal || null;
      const operatingRegion = inferOperatingRegion(`${currentTask || ''} ${job?.stageDetail || ''} ${registry?.mission || ''}`);
      const workerStatus = job?.status || null;
      return {
        ...item,
        agentNumber,
        role: registry?.role || null,
        functionalGroup: registry?.functionalGroup || 'UNASSIGNED',
        mission: registry?.mission || null,
        operatingRegion,
        presence: presenceFor(item.status, workerStatus, heartbeat, campaign.enabled),
        worker: {
          registered: true,
          heartbeat,
          lastHeartbeatAt: job?.lastHeartbeatAt || null,
          stage: job?.stage || null,
          progressPercent: typeof job?.progressPercent === 'number' ? job.progressPercent : null,
          stageDetail: job?.stageDetail || null,
          currentTask,
          startedAt: job?.startedAt || null,
          finishedAt: job?.finishedAt || null,
          attempts: job?.attempts || 0,
          workerStatus,
        },
      };
    }));

    const heartbeating = enrichedAgents.filter((agent) => agent.worker.heartbeat === 'live').length;
    const staleHeartbeats = enrichedAgents.filter((agent) => agent.worker.heartbeat === 'stale').length;
    const activeJobs = enrichedAgents.filter((agent) => agent.presence === 'WORKING' || agent.presence === 'QUEUED' || agent.presence === 'STALE').length;
    const lastHeartbeatAt = enrichedAgents
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
        verified: items.filter((agent) => agent.status === 'verified').length,
        working: items.filter((agent) => agent.presence === 'WORKING').length,
        queued: items.filter((agent) => agent.presence === 'QUEUED').length,
        idle: items.filter((agent) => agent.presence === 'IDLE').length,
        stale: items.filter((agent) => agent.presence === 'STALE').length,
        attention: items.filter((agent) => agent.presence === 'ATTENTION').length,
      };
    });

    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      generatedAt: new Date().toISOString(),
      source: 'runtime_state_plus_worker_telemetry',
      enterprise: {
        totalAgents: total,
        expectedAgents: 112,
        registered: enrichedAgents.length,
        heartbeating,
        staleHeartbeats,
        activeJobs,
        lastHeartbeatAt,
        registryShapeValid: campaign.agents.length === 112,
        phase: campaign.phase,
        enabled: campaign.enabled,
        completionPercent: total > 0 ? Math.round((verifiedTotal / total) * 100) : 0,
        verifiedTotal,
        running,
        queued,
        blocked,
        failed,
        durableState: isDurableStoreConfigured(),
        productionClaimsRequireProof: campaign.productionClaimsRequireProof,
        paidSpendRequiresOwnerApproval: campaign.paidSpendRequiresOwnerApproval,
        destructiveActionsRequireOwnerApproval: campaign.destructiveActionsRequireOwnerApproval,
      },
      agents: {
        total: enrichedAgents.length,
        verified: verifiedTotal,
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
        liveReady: campaign.enabled && isDurableStoreConfigured() && sms.schedulerRunning,
        campaignComplete: verifiedTotal === total && total === 112,
        liveWorkforceObserved: heartbeating > 0,
        proofPolicy: 'No PASS without runtime evidence. 112/112 registry proof and live worker heartbeats are reported separately.',
      },
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER, error: error instanceof Error ? error.message : 'Unable to build Autonomous control-plane state.' }, 500);
  }
}
