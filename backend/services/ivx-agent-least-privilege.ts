import type { EnterpriseMasterAgent } from './ivx-enterprise-master-registry';

export const IVX_PHASE2_LEAST_PRIVILEGE_MARKER = 'ivx-phase2-least-privilege-2026-08-20-v2';

export type AgentRealToolId =
  | 'ivx_public_landing'
  | 'sec_edgar_fulltext'
  | 'sec_edgar_submissions'
  | 'wikipedia_search'
  | 'worldbank_indicator'
  | 'frankfurter_fx'
  | 'crm_read'
  | 'crm_write'
  | 'crm_update';

const set = (values: number[]) => new Set(values);

// IVX code drafting is intentionally narrow. Executive finance/legal/research
// agents do not receive code-write entitlement merely because they are senior.
export const IVX_CODE_DRAFT_AGENT_NUMBERS = set([10, 11, 40]);

// New-product engineering is isolated from the IVX production repository/data.
export const PRODUCT_SANDBOX_CODE_AGENT_NUMBERS = set([
  68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86,
  87, 88, 89, 90, 91, 99, 100, 103, 104, 105, 106, 107, 108, 110, 111, 112,
]);

// CRM is not a baseline tool. Only roles whose actual mission requires pipeline
// data receive it. Create and update capabilities are separated.
export const CRM_READ_AGENT_NUMBERS = set([
  7, 17, 18, 19, 20, 21, 27, 28, 29, 30, 31, 32, 46, 47, 48, 53, 54, 55,
]);
export const CRM_WRITE_AGENT_NUMBERS = set([17, 19, 27, 28, 31, 32]);
export const CRM_UPDATE_AGENT_NUMBERS = set([20, 21]);

export const EDGAR_AGENT_NUMBERS = set([
  2, 3, 6, 7, 8, 11, 12, 17, 18, 19, 20, 22, 24, 25, 26, 27, 28, 29, 31, 32, 33,
  34, 41, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
]);

export const WORLD_BANK_AGENT_NUMBERS = set([
  3, 6, 12, 22, 23, 24, 25, 26, 41, 42, 44, 45, 52, 56, 57, 58, 59, 60, 61, 62,
  93, 94, 95, 102, 112,
]);

export const FX_AGENT_NUMBERS = set([3, 6, 23, 24, 29, 44, 52, 56, 57, 60, 61, 95, 102, 105]);

export const PUBLIC_RESEARCH_AGENT_NUMBERS = set([
  12, 13, 14, 15, 16, 22, 25, 26, 27, 31, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
  65, 66, 67, 92, 93, 94, 96, 97, 102, 103, 104, 105, 106, 107, 108, 109, 112,
]);

const INVESTOR_DIRECTORY_READ = set([7, 17, 18]);
const BUYER_DIRECTORY_READ = set([19, 20, 21, 48]);
const PROPERTY_DEAL_READ = set([2, 3, 4, 5, 28, 29, 31, 41, 42, 45, 46, 47, 52]);
const AGGREGATE_METRICS_READ = set([1, 3, 5, 6, 10, 11, 12, 23, 24, 41, 42, 44, 45, 52, 61]);

export function canDraftIVXCode(agentNumber: number): boolean {
  return IVX_CODE_DRAFT_AGENT_NUMBERS.has(agentNumber);
}

export function canWriteProductSandbox(agentNumber: number): boolean {
  return PRODUCT_SANDBOX_CODE_AGENT_NUMBERS.has(agentNumber);
}

export function getAgentRealToolEntitlements(agentNumber: number): AgentRealToolId[] {
  // Every agent can prove a real run against a harmless public IVX source. No
  // private data entitlement is needed just to satisfy an evidence gate.
  const tools: AgentRealToolId[] = ['ivx_public_landing'];
  if (PUBLIC_RESEARCH_AGENT_NUMBERS.has(agentNumber)) tools.push('wikipedia_search');
  if (WORLD_BANK_AGENT_NUMBERS.has(agentNumber)) tools.push('worldbank_indicator');
  if (FX_AGENT_NUMBERS.has(agentNumber)) tools.push('frankfurter_fx');
  if (EDGAR_AGENT_NUMBERS.has(agentNumber)) tools.push('sec_edgar_fulltext', 'sec_edgar_submissions');
  if (CRM_READ_AGENT_NUMBERS.has(agentNumber)) tools.push('crm_read');
  if (CRM_WRITE_AGENT_NUMBERS.has(agentNumber)) tools.push('crm_write');
  if (CRM_UPDATE_AGENT_NUMBERS.has(agentNumber)) tools.push('crm_update');
  return [...new Set(tools)];
}

export function getLeastPrivilegePermissions(agent: EnterpriseMasterAgent): {
  read: string[];
  write: string[];
  external: string[];
} {
  const read = [
    'shared:enterprise_policies:read',
    `memory:${agent.id}:read`,
    `registry:agent:${agent.id}:read`,
  ];
  const write = [`memory:${agent.id}:write`];
  const external: string[] = ['ivx_public:read'];

  if (agent.division === 'A') {
    if (CRM_READ_AGENT_NUMBERS.has(agent.agentNumber)) read.push('ivx:crm:read');
    if (INVESTOR_DIRECTORY_READ.has(agent.agentNumber)) read.push('ivx:investor_directory:read');
    if (BUYER_DIRECTORY_READ.has(agent.agentNumber)) read.push('ivx:buyer_directory:read');
    if (PROPERTY_DEAL_READ.has(agent.agentNumber)) read.push('ivx:properties:read', 'ivx:deals:read');
    if (AGGREGATE_METRICS_READ.has(agent.agentNumber)) read.push('ivx:aggregate_metrics:read');

    if (agent.agentNumber === 8) read.push('ivx:compliance_audit:read');
    if (agent.agentNumber === 10) read.push('ivx:system_logs:read', 'ivx:schema:read');
    if (agent.agentNumber === 11) read.push('ivx:audit_logs:read', 'ivx:auth_logs:read', 'ivx:schema:read', 'ivx:migrations:read');

    if (canDraftIVXCode(agent.agentNumber)) {
      write.push('ivx:code:draft');
      external.push('github:read:ivx-holdings-platform');
    }
  } else {
    // Division B may read only non-production registry metadata from IVX.
    read.push('ivx:enterprise_registry:read');
    if (canWriteProductSandbox(agent.agentNumber)) {
      write.push(`product_sandbox:${agent.id}:code:write`);
    }
  }

  const realTools = getAgentRealToolEntitlements(agent.agentNumber);
  if (realTools.some((tool) => ['wikipedia_search', 'worldbank_indicator', 'sec_edgar_fulltext', 'sec_edgar_submissions', 'frankfurter_fx'].includes(tool))) {
    external.push('public_research:read');
  }
  if (realTools.includes('crm_read')) external.push('ivx_crm:read');
  if (realTools.includes('crm_write')) external.push('ivx_crm:prospect_create');
  if (realTools.includes('crm_update')) external.push('ivx_crm:qualification_update');

  return {
    read: [...new Set(read)],
    write: [...new Set(write)],
    external: [...new Set(external)],
  };
}

export function auditLeastPrivilegeAgent(agent: EnterpriseMasterAgent): string[] {
  const issues: string[] = [];
  const p = getLeastPrivilegePermissions(agent);
  const realTools = getAgentRealToolEntitlements(agent.agentNumber);

  if (p.read.some((value) => value.includes('*'))) issues.push('wildcard_read_permission');
  if (agent.division === 'B' && p.read.some((value) => /^ivx:(?!enterprise_registry)/.test(value))) issues.push('division_b_ivx_production_read');
  if (agent.division === 'B' && p.write.some((value) => value.startsWith('ivx:'))) issues.push('division_b_ivx_write');
  if (!CRM_READ_AGENT_NUMBERS.has(agent.agentNumber) && realTools.includes('crm_read')) issues.push('crm_read_overgrant');
  if (!CRM_WRITE_AGENT_NUMBERS.has(agent.agentNumber) && realTools.includes('crm_write')) issues.push('crm_write_overgrant');
  if (!CRM_UPDATE_AGENT_NUMBERS.has(agent.agentNumber) && realTools.includes('crm_update')) issues.push('crm_update_overgrant');
  if (!canDraftIVXCode(agent.agentNumber) && p.write.includes('ivx:code:draft')) issues.push('ivx_code_overgrant');
  if (realTools.length === 0) issues.push('no_verifiable_real_tool');
  return issues;
}
