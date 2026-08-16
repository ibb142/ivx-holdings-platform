import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getCompletionCampaignState, verifyAllEnterpriseAgents } from '../services/ivx-autonomous-completion-campaign';
import { getSmsNotifierStatus } from '../services/ivx-autonomous-sms-notifier';
import { isDurableStoreConfigured } from '../services/ivx-durable-store';
import { getFunctionalGroups, getAgentsByFunctionalGroup } from '../services/ivx-enterprise-master-registry';

export const IVX_AUTONOMOUS_CONTROL_PLANE_MARKER = 'ivx-autonomous-control-plane-v2-2026-08-16';

function countStatuses<T extends { status: string }>(items: T[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

export function autonomousControlPlaneOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleAutonomousControlPlaneVerifyAll(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      error: error instanceof Error ? error.message : 'IVX owner authentication required.',
    }, 401);
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
    return ownerOnlyJson({
      ok: false,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      error: error instanceof Error ? error.message : 'Unable to verify agents.',
    }, 500);
  }
}

export async function handleAutonomousControlPlaneGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      error: error instanceof Error ? error.message : 'IVX owner authentication required.',
    }, 401);
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

    // Build functional group breakdown
    const groups = getFunctionalGroups();
    const groupBreakdown = groups.map((g) => {
      const groupAgents = getAgentsByFunctionalGroup(g);
      const campaignGroupAgents = campaign.agents.filter((a) => {
        const num = parseInt(a.id.split(':')[1], 10);
        return groupAgents.some((ga) => ga.agentNumber === num);
      });
      return {
        name: g,
        total: groupAgents.length,
        verified: campaignGroupAgents.filter((a) => a.status === 'verified').length,
      };
    });

    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      generatedAt: new Date().toISOString(),
      source: 'runtime_state',
      enterprise: {
        totalAgents: total,
        expectedAgents: 112,
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
        total: campaign.agents.length,
        verified: campaign.totals.verifiedAgents,
        statuses: agentStatuses,
        items: campaign.agents,
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
        proofPolicy: 'No PASS without runtime evidence. Completion requires 112/112 verified plus live deployment/health proof.',
      },
    });
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      error: error instanceof Error ? error.message : 'Unable to build Autonomous control-plane state.',
    }, 500);
  }
}
