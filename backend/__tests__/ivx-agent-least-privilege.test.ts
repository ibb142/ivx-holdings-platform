import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ALL_ENTERPRISE_AGENTS } from '../services/ivx-enterprise-master-registry';
import {
  IVX_CODE_DRAFT_AGENT_NUMBERS,
  CRM_READ_AGENT_NUMBERS,
  CRM_WRITE_AGENT_NUMBERS,
  CRM_UPDATE_AGENT_NUMBERS,
  getAgentRealToolEntitlements,
  getLeastPrivilegePermissions,
} from '../services/ivx-agent-least-privilege';
import { getCertMission, getPermittedRealTools } from '../services/ivx-agent-real-tools';
import { runPhase2CapabilityAudit } from '../services/ivx-agent-capability-audit';

describe('Phase 2 — Agent Capability + Least Privilege', () => {
  it('audits exactly 112 unique agents with zero permission issues', () => {
    const audit = runPhase2CapabilityAudit();
    expect(audit.totalAgents).toBe(112);
    expect(audit.uniqueAgentIds).toBe(112);
    expect(audit.uniqueAgentNumbers).toBe(112);
    expect(audit.ok).toBe(true);
    expect(audit.issues).toEqual([]);
  });

  it('has zero wildcard effective reads and zero Division B production access', () => {
    const audit = runPhase2CapabilityAudit();
    expect(audit.wildcardReads).toBe(0);
    expect(audit.divisionBProductionReads).toBe(0);
    expect(audit.divisionBIVXWrites).toBe(0);
  });

  it('does not use CRM as a global baseline tool', () => {
    expect(getPermittedRealTools(1)).toEqual(['ivx_public_landing']);
    expect(getPermittedRealTools(68)).not.toContain('crm_read');
    expect(getPermittedRealTools(87)).not.toContain('crm_read');
    expect(getPermittedRealTools(112)).not.toContain('crm_read');
  });

  it('separates CRM read, create and update capabilities', () => {
    expect(getPermittedRealTools(17)).toEqual(expect.arrayContaining(['crm_read', 'crm_write']));
    expect(getPermittedRealTools(17)).not.toContain('crm_update');
    expect(getPermittedRealTools(20)).toEqual(expect.arrayContaining(['crm_read', 'crm_update']));
    expect(getPermittedRealTools(20)).not.toContain('crm_write');
    expect(getPermittedRealTools(21)).toEqual(expect.arrayContaining(['crm_read', 'crm_update']));
    expect(getPermittedRealTools(21)).not.toContain('crm_write');
    expect(CRM_WRITE_AGENT_NUMBERS.has(20)).toBe(false);
    expect(CRM_UPDATE_AGENT_NUMBERS.has(17)).toBe(false);
  });

  it('limits IVX code drafting to the explicit technical allowlist', () => {
    expect([...IVX_CODE_DRAFT_AGENT_NUMBERS].sort((a, b) => a - b)).toEqual([10, 11, 40]);
    for (const agent of ALL_ENTERPRISE_AGENTS) {
      const permissions = getLeastPrivilegePermissions(agent);
      const hasCodeDraft = permissions.write.includes('ivx:code:draft');
      expect(hasCodeDraft).toBe(IVX_CODE_DRAFT_AGENT_NUMBERS.has(agent.agentNumber));
    }
  });

  it('gives every agent a harmless real evidence tool without private-data overgrant', () => {
    for (const agent of ALL_ENTERPRISE_AGENTS) {
      const tools = getAgentRealToolEntitlements(agent.agentNumber);
      expect(tools).toContain('ivx_public_landing');
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  it('keeps every default certification mission inside that agent tool entitlement', () => {
    for (const agent of ALL_ENTERPRISE_AGENTS) {
      const tools = getAgentRealToolEntitlements(agent.agentNumber);
      const mission = getCertMission(agent.agentNumber, agent.name, agent.mission);
      for (const step of mission.toolPlan) expect(tools).toContain(step.toolId);
    }
  });

  it('contains no executable money movement, trade, legal or production tool', () => {
    for (const agent of ALL_ENTERPRISE_AGENTS) {
      const tools = getPermittedRealTools(agent.agentNumber) as string[];
      expect(tools).not.toContain('money_movement');
      expect(tools).not.toContain('trade_execution');
      expect(tools).not.toContain('legal_execution');
      expect(tools).not.toContain('production_deploy');
      expect(tools).not.toContain('external_outreach');
    }
  });

  it('routes IA-20/21 CRM mutations through the controlled crm_update tool', () => {
    const source = readFileSync(new URL('../services/ivx-agent-real-tools.ts', import.meta.url), 'utf8');
    const directUpdates = source.match(/\bupdateProspect\s*\(/g) ?? [];
    expect(directUpdates.length).toBe(1); // only inside the crm_update executor
    expect(source).toContain("case 'crm_update'");
    expect(source).toContain("run('crm_update'");
  });

  it('has no CRM or IVX-code overgrant in the phase 2 audit', () => {
    const audit = runPhase2CapabilityAudit();
    expect(audit.crmReadOvergrants).toBe(0);
    expect(audit.crmWriteOvergrants).toBe(0);
    expect(audit.crmUpdateOvergrants).toBe(0);
    expect(audit.ivxCodeOvergrants).toBe(0);
    expect(audit.missionToolViolations).toBe(0);
    expect(audit.agentsWithoutRealTool).toBe(0);
  });

  it('keeps the explicit CRM allowlists internally consistent', () => {
    for (const n of CRM_WRITE_AGENT_NUMBERS) expect(CRM_READ_AGENT_NUMBERS.has(n)).toBe(true);
    for (const n of CRM_UPDATE_AGENT_NUMBERS) expect(CRM_READ_AGENT_NUMBERS.has(n)).toBe(true);
  });
});
