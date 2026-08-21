import { ALL_ENTERPRISE_AGENTS } from './ivx-enterprise-master-registry';
import {
  IVX_CODE_DRAFT_AGENT_NUMBERS,
  PRODUCT_SANDBOX_CODE_AGENT_NUMBERS,
  CRM_READ_AGENT_NUMBERS,
  CRM_WRITE_AGENT_NUMBERS,
  CRM_UPDATE_AGENT_NUMBERS,
  auditLeastPrivilegeAgent,
  getAgentRealToolEntitlements,
  getLeastPrivilegePermissions,
} from './ivx-agent-least-privilege';
import { getCertMission } from './ivx-agent-real-tools';

export const IVX_PHASE2_CAPABILITY_AUDIT_MARKER = 'ivx-phase2-capability-audit-2026-08-20-v1';

export type Phase2AgentAudit = {
  agentNumber: number;
  agentId: string;
  division: string;
  effectiveReads: string[];
  effectiveWrites: string[];
  realTools: string[];
  certMissionTools: string[];
  issues: string[];
};

export type Phase2CapabilityAudit = {
  ok: boolean;
  marker: string;
  totalAgents: number;
  uniqueAgentIds: number;
  uniqueAgentNumbers: number;
  wildcardReads: number;
  divisionBProductionReads: number;
  divisionBIVXWrites: number;
  crmReadOvergrants: number;
  crmWriteOvergrants: number;
  crmUpdateOvergrants: number;
  ivxCodeOvergrants: number;
  missionToolViolations: number;
  agentsWithoutRealTool: number;
  ivxCodeDraftAgents: number[];
  productSandboxWriters: number[];
  crmReadAgents: number[];
  crmWriteAgents: number[];
  crmUpdateAgents: number[];
  issues: string[];
  agents: Phase2AgentAudit[];
};

function sorted(values: Set<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

export function runPhase2CapabilityAudit(): Phase2CapabilityAudit {
  const audits: Phase2AgentAudit[] = ALL_ENTERPRISE_AGENTS.map((agent) => {
    const permissions = getLeastPrivilegePermissions(agent);
    const realTools = getAgentRealToolEntitlements(agent.agentNumber);
    const mission = getCertMission(agent.agentNumber, agent.name, agent.mission);
    const missionToolViolations = mission.toolPlan
      .map((step) => String(step.toolId))
      .filter((tool) => !realTools.includes(tool as never));
    const issues = [
      ...auditLeastPrivilegeAgent(agent),
      ...missionToolViolations.map((tool) => `cert_mission_tool_not_entitled:${tool}`),
    ];
    return {
      agentNumber: agent.agentNumber,
      agentId: agent.id,
      division: agent.division,
      effectiveReads: permissions.read,
      effectiveWrites: permissions.write,
      realTools,
      certMissionTools: mission.toolPlan.map((step) => String(step.toolId)),
      issues,
    };
  });

  const allIssues = audits.flatMap((agent) => agent.issues.map((issue) => `IA-${String(agent.agentNumber).padStart(3, '0')}:${issue}`));
  const wildcardReads = audits.filter((a) => a.effectiveReads.some((p) => p.includes('*'))).length;
  const divisionBProductionReads = audits.filter((a) => a.division === 'B' && a.effectiveReads.some((p) => /^ivx:(?!enterprise_registry)/.test(p))).length;
  const divisionBIVXWrites = audits.filter((a) => a.division === 'B' && a.effectiveWrites.some((p) => p.startsWith('ivx:'))).length;
  const crmReadOvergrants = audits.filter((a) => a.realTools.includes('crm_read') && !CRM_READ_AGENT_NUMBERS.has(a.agentNumber)).length;
  const crmWriteOvergrants = audits.filter((a) => a.realTools.includes('crm_write') && !CRM_WRITE_AGENT_NUMBERS.has(a.agentNumber)).length;
  const crmUpdateOvergrants = audits.filter((a) => a.realTools.includes('crm_update') && !CRM_UPDATE_AGENT_NUMBERS.has(a.agentNumber)).length;
  const ivxCodeOvergrants = audits.filter((a) => a.effectiveWrites.includes('ivx:code:draft') && !IVX_CODE_DRAFT_AGENT_NUMBERS.has(a.agentNumber)).length;
  const missionToolViolations = audits.filter((a) => a.issues.some((i) => i.startsWith('cert_mission_tool_not_entitled:'))).length;
  const agentsWithoutRealTool = audits.filter((a) => a.realTools.length === 0).length;

  const uniqueAgentIds = new Set(audits.map((a) => a.agentId)).size;
  const uniqueAgentNumbers = new Set(audits.map((a) => a.agentNumber)).size;
  if (audits.length !== 112) allIssues.push(`registry_total:${audits.length}`);
  if (uniqueAgentIds !== 112) allIssues.push(`unique_agent_ids:${uniqueAgentIds}`);
  if (uniqueAgentNumbers !== 112) allIssues.push(`unique_agent_numbers:${uniqueAgentNumbers}`);

  return {
    ok: allIssues.length === 0,
    marker: IVX_PHASE2_CAPABILITY_AUDIT_MARKER,
    totalAgents: audits.length,
    uniqueAgentIds,
    uniqueAgentNumbers,
    wildcardReads,
    divisionBProductionReads,
    divisionBIVXWrites,
    crmReadOvergrants,
    crmWriteOvergrants,
    crmUpdateOvergrants,
    ivxCodeOvergrants,
    missionToolViolations,
    agentsWithoutRealTool,
    ivxCodeDraftAgents: sorted(IVX_CODE_DRAFT_AGENT_NUMBERS),
    productSandboxWriters: sorted(PRODUCT_SANDBOX_CODE_AGENT_NUMBERS),
    crmReadAgents: sorted(CRM_READ_AGENT_NUMBERS),
    crmWriteAgents: sorted(CRM_WRITE_AGENT_NUMBERS),
    crmUpdateAgents: sorted(CRM_UPDATE_AGENT_NUMBERS),
    issues: allIssues,
    agents: audits,
  };
}
