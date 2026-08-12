import { describe, expect, it } from 'vitest';
import {
  buildFreshCompletionCampaignState,
  getSupervisorDistribution,
  IVX_COMPLETION_CAMPAIGN_MARKER,
} from './services/ivx-autonomous-completion-campaign';

describe('IVX autonomous 12x100 completion campaign', () => {
  it('starts with exactly 12 specialists, 50 IVX agents, and 50 Factory agents', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.marker).toBe(IVX_COMPLETION_CAMPAIGN_MARKER);
    expect(state.phase).toBe('specialists_12');
    expect(state.specialists).toHaveLength(12);
    expect(state.divisionA).toHaveLength(50);
    expect(state.divisionB).toHaveLength(50);
    expect(new Set([...state.divisionA, ...state.divisionB].map((x) => x.id)).size).toBe(100);
  });

  it('keeps money, destructive actions, and production claims owner/proof gated', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.paidSpendRequiresOwnerApproval).toBe(true);
    expect(state.destructiveActionsRequireOwnerApproval).toBe(true);
    expect(state.productionClaimsRequireProof).toBe(true);
  });

  it('assigns every enterprise agent to one of the 12 specialist supervisors', () => {
    const distribution = getSupervisorDistribution();
    expect(Object.keys(distribution)).toHaveLength(12);
    expect(Object.values(distribution).reduce((sum, count) => sum + count, 0)).toBe(100);
  });
});
