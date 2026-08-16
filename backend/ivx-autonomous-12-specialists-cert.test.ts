import { describe, expect, it } from 'vitest';
import {
  ALL_ENTERPRISE_AGENTS,
  validateEnterpriseMasterRegistry,
  getEnterpriseAgentSummaries,
  getFunctionalGroups,
  getAgentsByFunctionalGroup,
  type EnterpriseMasterAgent,
} from './services/ivx-enterprise-master-registry';
import { buildFreshCompletionCampaignState } from './services/ivx-autonomous-completion-campaign';

describe('IVX 112-Agent Organization — Hard Certificate', () => {
  it('registers exactly 112 agents', () => {
    expect(ALL_ENTERPRISE_AGENTS.length).toBe(112);
  });

  it('passes registry validation with zero issues', () => {
    const validation = validateEnterpriseMasterRegistry();
    expect(validation.valid).toBe(true);
    expect(validation.totalAgents).toBe(112);
    expect(validation.issues).toHaveLength(0);
  });

  it('has sequential agent numbers 1-112 with no gaps', () => {
    const numbers = ALL_ENTERPRISE_AGENTS.map((a) => a.agentNumber).sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(numbers[111]).toBe(112);
    for (let i = 0; i < 112; i++) {
      expect(numbers[i]).toBe(i + 1);
    }
  });

  it('has no duplicate IDs', () => {
    const ids = ALL_ENTERPRISE_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(112);
  });

  it.each(ALL_ENTERPRISE_AGENTS)('$name has complete org chart fields', (agent: EnterpriseMasterAgent) => {
    expect(agent.name).toMatch(/^IA-\d{3}/);
    expect(agent.role).toBeTruthy();
    expect(agent.mission).toBeTruthy();
    expect(agent.inputs).toBeTruthy();
    expect(agent.actions).toBeTruthy();
    expect(agent.outputs).toBeTruthy();
    expect(agent.kpi).toBeTruthy();
    expect(agent.authority).toBeTruthy();
    expect(agent.functionalGroup).toBeTruthy();
    expect(agent.responsibilities.length).toBeGreaterThan(0);
    expect(agent.capabilities.length).toBeGreaterThan(0);
    expect(agent.heartbeatGoal).toBeTruthy();
  });

  it('has IA-01 Executive Operations as first agent', () => {
    expect(ALL_ENTERPRISE_AGENTS[0].name).toBe('IA-01 Executive Operations');
    expect(ALL_ENTERPRISE_AGENTS[0].agentNumber).toBe(1);
  });

  it('has IA-112 Continuous Innovation Lab as last agent', () => {
    expect(ALL_ENTERPRISE_AGENTS[111].name).toBe('IA-112 Continuous Innovation Lab');
    expect(ALL_ENTERPRISE_AGENTS[111].agentNumber).toBe(112);
  });

  it('has 11 functional groups', () => {
    const groups = getFunctionalGroups();
    expect(groups.length).toBe(11);
    expect(groups).toContain('Executive');
    expect(groups).toContain('Growth & Marketing');
    expect(groups).toContain('Market & Business Development');
    expect(groups).toContain('Digital & Technology');
    expect(groups).toContain('Intelligence');
    expect(groups).toContain('Networks & Capital');
    expect(groups).toContain('Global Expansion');
    expect(groups).toContain('New App Development');
    expect(groups).toContain('New Project Development');
    expect(groups).toContain('Product Creation & Innovation');
  });

  it('Executive group has 12 agents (IA-01 to IA-12)', () => {
    const execAgents = getAgentsByFunctionalGroup('Executive');
    expect(execAgents.length).toBe(12);
    expect(execAgents[0].agentNumber).toBe(1);
    expect(execAgents[11].agentNumber).toBe(12);
  });

  it('New App Development group has 30 agents (IA-63 to IA-92)', () => {
    const appAgents = getAgentsByFunctionalGroup('New App Development');
    expect(appAgents.length).toBe(30);
  });

  it('Product Creation & Innovation group has 10 agents (IA-103 to IA-112)', () => {
    const innovationAgents = getAgentsByFunctionalGroup('Product Creation & Innovation');
    expect(innovationAgents.length).toBe(10);
  });

  it('binds the autonomous campaign to the same 112 agents', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.enabled).toBe(true);
    expect(state.phase).toBe('agents_112');
    expect(state.agents).toHaveLength(112);
    expect(new Set(state.agents.map((a) => a.id)).size).toBe(112);
  });

  it('keeps autonomous execution behind owner/proof safety gates', () => {
    const state = buildFreshCompletionCampaignState();
    expect(state.paidSpendRequiresOwnerApproval).toBe(true);
    expect(state.destructiveActionsRequireOwnerApproval).toBe(true);
    expect(state.productionClaimsRequireProof).toBe(true);
  });

  it('returns complete agent summaries', () => {
    const summaries = getEnterpriseAgentSummaries();
    expect(summaries.length).toBe(112);
    expect(summaries[0].functionalGroup).toBe('Executive');
    expect(summaries[0].mission).toBeTruthy();
    expect(summaries[0].kpi).toBeTruthy();
  });
});
