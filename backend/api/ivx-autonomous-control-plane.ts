import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getCompletionCampaignState, getSupervisorDistribution, verifyAllEnterpriseAgents } from '../services/ivx-autonomous-completion-campaign';
import { getSmsNotifierStatus } from '../services/ivx-autonomous-sms-notifier';
import { isDurableStoreConfigured } from '../services/ivx-durable-store';

export const IVX_AUTONOMOUS_CONTROL_PLANE_MARKER = 'ivx-autonomous-control-plane-v1-2026-08-12';

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
      action: 'verify_all_enterprise_agents',
      generatedAt: new Date().toISOString(),
      result,
      campaign: {
        phase: campaign.phase,
        enabled: campaign.enabled,
        totals: campaign.totals,
        verifiedTotal: campaign.totals.verifiedSpecialists + campaign.totals.verifiedDivisionA + campaign.totals.verifiedDivisionB,
        expectedTotal: 112,
      },
    });
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      error: error instanceof Error ? error.message : 'Unable to verify enterprise agents.',
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
    const specialists = countStatuses(campaign.specialists);
    const divisionA = countStatuses(campaign.divisionA);
    const divisionB = countStatuses(campaign.divisionB);
    const verifiedTotal = campaign.totals.verifiedSpecialists + campaign.totals.verifiedDivisionA + campaign.totals.verifiedDivisionB;
    const total = campaign.specialists.length + campaign.divisionA.length + campaign.divisionB.length;
    const blocked = (specialists.blocked || 0) + (divisionA.blocked || 0) + (divisionB.blocked || 0);
    const failed = (specialists.failed || 0) + (divisionA.failed || 0) + (divisionB.failed || 0);
    const running = (specialists.running || 0) + (divisionA.running || 0) + (divisionB.running || 0);
    const queued = (specialists.queued || 0) + (divisionA.queued || 0) + (divisionB.queued || 0);

    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMOUS_CONTROL_PLANE_MARKER,
      generatedAt: new Date().toISOString(),
      source: 'runtime_state',
      enterprise: {
        totalAgents: total,
        expectedAgents: 112,
        registryShapeValid: campaign.specialists.length === 12 && campaign.divisionA.length === 50 && campaign.divisionB.length === 50,
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
      specialists: {
        total: campaign.specialists.length,
        verified: campaign.totals.verifiedSpecialists,
        statuses: specialists,
        items: campaign.specialists,
      },
      divisionA: {
        label: 'IVX Operations',
        total: campaign.divisionA.length,
        verified: campaign.totals.verifiedDivisionA,
        statuses: divisionA,
        items: campaign.divisionA,
      },
      divisionB: {
        label: 'Factory',
        total: campaign.divisionB.length,
        verified: campaign.totals.verifiedDivisionB,
        statuses: divisionB,
        items: campaign.divisionB,
      },
      supervisors: getSupervisorDistribution(),
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
