import { describe, expect, it } from 'vitest';
import {
  buildFreshCompletionCampaignState,
  IVX_COMPLETION_CAMPAIGN_MARKER,
} from './services/ivx-autonomous-completion-campaign';

describe('IVX 112-agent completion campaign', () => {
  it('starts with exactly 112 agents', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.marker).toBe(IVX_COMPLETION_CAMPAIGN_MARKER);
    expect(state.phase).toBe('agents_112');
    expect(state.agents).toHaveLength(112);
    expect(new Set(state.agents.map((x) => x.id)).size).toBe(112);
  });

  it('keeps money, destructive actions, and production claims owner/proof gated', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.paidSpendRequiresOwnerApproval).toBe(true);
    expect(state.destructiveActionsRequireOwnerApproval).toBe(true);
    expect(state.productionClaimsRequireProof).toBe(true);
  });

  it('has IA-01 as first agent and IA-112 as last', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.agents[0].name).toBe('IA-01 Executive Operations');
    expect(state.agents[111].name).toBe('IA-112 Continuous Innovation Lab');
  });
});
