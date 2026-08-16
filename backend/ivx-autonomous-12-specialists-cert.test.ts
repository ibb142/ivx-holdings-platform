import { describe, expect, it } from 'vitest';
import {
  SPECIALISTS,
  canSpecialistDeclareVerified,
  type IVXSpecialistRole,
} from './services/ivx-specialist-router';
import { buildFreshCompletionCampaignState } from './services/ivx-autonomous-completion-campaign';

const EXPECTED_ROLES: IVXSpecialistRole[] = [
  'architect',
  'senior_developer',
  'mobile_engineer',
  'backend_engineer',
  'database_engineer',
  'devops_engineer',
  'qa_engineer',
  'security_engineer',
  'product_analyst',
  'investor_analyst',
  'proof_verifier',
  'response_editor',
];

describe('IVX Autonomous + 12 IA hard certificate', () => {
  it('registers exactly the 12 approved specialist roles', () => {
    const roles = Object.keys(SPECIALISTS).sort();
    expect(roles).toEqual([...EXPECTED_ROLES].sort());
    expect(roles).toHaveLength(12);
  });

  it.each(EXPECTED_ROLES)('%s has a real contract, capabilities, and permissions', (role) => {
    const specialist = SPECIALISTS[role];
    expect(specialist.role).toBe(role);
    expect(specialist.name.startsWith('IVX ')).toBe(true);
    expect(specialist.capabilities.length).toBeGreaterThan(0);
    expect(specialist.permissions.length).toBeGreaterThan(0);
    expect(specialist.canReturnFinalAnswer).toBe(false);
  });

  it('allows only Proof Verifier to recommend VERIFIED', () => {
    for (const role of EXPECTED_ROLES) {
      expect(canSpecialistDeclareVerified(role)).toBe(role === 'proof_verifier');
    }
  });

  it('binds the autonomous campaign to the same 12 specialists', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.enabled).toBe(true);
    expect(state.phase).toBe('specialists_12');
    expect(state.specialists).toHaveLength(12);
    expect(state.specialists.map((item) => item.supervisor).sort()).toEqual([...EXPECTED_ROLES].sort());
    expect(new Set(state.specialists.map((item) => item.id)).size).toBe(12);
  });

  it('keeps autonomous execution behind owner/proof safety gates', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.paidSpendRequiresOwnerApproval).toBe(true);
    expect(state.destructiveActionsRequireOwnerApproval).toBe(true);
    expect(state.productionClaimsRequireProof).toBe(true);
  });
});
