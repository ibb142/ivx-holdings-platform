import { ensureCampaignAssignment, type DispatcherAssignmentInput } from './ivx-campaign-dispatcher';

export const IVX_NEXT_PHASE_PROGRAM_ID = 'IVX-NEXT-PHASE-12-50-100';
export const IVX_NEXT_PHASE_LANDING_GATE = 'IVX-LANDING-10OF10-2026-08-19';

const FACTORY_LANES = [
  'product-architecture',
  'mobile-web-scaffolding',
  'backend-api',
  'auth-security',
  'data-supabase',
  'media-social',
  'qa-e2e',
  'performance-load',
  'devops-deploy',
  'observability-self-heal',
  'agent-orchestration',
  'enterprise-certification',
] as const;

export type NextPhaseLandingGate = {
  productionCertificate: boolean;
  exactSha: boolean;
  zeroP0P1: boolean;
};

export function isNextPhaseLandingGateOpen(gate: NextPhaseLandingGate): boolean {
  return gate.productionCertificate && gate.exactSha && gate.zeroP0P1;
}

/**
 * Registers the next phase in the REAL campaign dispatcher without stealing
 * capacity from Landing. Until Landing is 10/10, all 12 records remain behind
 * an owner gate. Re-running this function after the gate opens is idempotent;
 * ensureCampaignAssignment lifts PENDING_OWNER to QUEUED for the same keys.
 */
export async function registerNextPhaseFactoryWithDispatcher(
  gate: NextPhaseLandingGate,
) {
  const landingComplete = isNextPhaseLandingGateOpen(gate);
  const records = [];

  for (let index = 0; index < FACTORY_LANES.length; index += 1) {
    const agentNumber = index + 1;
    const lane = FACTORY_LANES[index];
    const assignment: DispatcherAssignmentInput = {
      agentNumber,
      agentId: `factory-ia-${String(agentNumber).padStart(3, '0')}`,
      role: 'IMPLEMENT',
      dutyId: `${IVX_NEXT_PHASE_PROGRAM_ID}:FACTORY:${String(agentNumber).padStart(2, '0')}`,
      phase: IVX_NEXT_PHASE_PROGRAM_ID,
      module: 'APP_FACTORY',
      laneKey: `next-phase:${lane}`,
      executionMode: 'code_change',
      ownerGate: !landingComplete,
      waitFor: null,
      goal: landingComplete
        ? `Execute ${lane} lane for the 12 IA -> 50 App Factories -> 100 production agents program. Preserve production safety and produce real code/test/PR evidence.`
        : `NEXT after ${IVX_NEXT_PHASE_LANDING_GATE}: ${lane} lane for 12 IA -> 50 App Factories -> 100 production agents. Do not execute until Landing production certificate, exact SHA, and zero P0/P1 are all true.`,
    };
    records.push(await ensureCampaignAssignment(assignment));
  }

  return {
    programId: IVX_NEXT_PHASE_PROGRAM_ID,
    landingGateOpen: landingComplete,
    dispatcherRecords: records.length,
    statuses: records.map((record) => ({ key: record.key, status: record.status })),
  };
}
