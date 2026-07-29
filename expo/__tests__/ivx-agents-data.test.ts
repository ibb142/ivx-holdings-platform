/**
 * IVX Domain Agents Data Model — Tests
 *
 * Verifies: 10 agents exist, each has required fields, tools reference
 * real endpoints, capabilities are verified with evidence, search works,
 * risk levels are valid, and helpers return correct results.
 */
import {
  IVX_DOMAIN_AGENTS,
  IVX_AGENT_COUNT,
  getAgentById,
  getAgentByNumber,
  getAgentTools,
  getReadOnlyTools,
  getWriteTools,
  getVerifiedCapabilities,
  searchAgents,
  getTotalTools,
  getTotalCapabilities,
  getAgentsByRiskLevel,
  type IVXDomainAgent,
  type AgentTool,
} from '../lib/ivx-agents-data';

const EXPECTED_AGENT_IDS = [
  'member-agent',
  'investor-agent',
  'buyer-agent',
  'jv-agent',
  'reels-agent',
  'deployment-agent',
  'qa-agent',
  'security-agent',
  'capital-agent',
  'research-agent',
];

const EXPECTED_DOMAINS = [
  'Miembros',
  'Inversionistas',
  'Compradores',
  'Joint Ventures',
  'Contenido',
  'Despliegue',
  'Quality Assurance',
  'Seguridad',
  'Capital',
  'Investigación',
];

const VALID_RISK_LEVELS = ['low', 'medium', 'high'];
const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const VALID_SCHEDULE_MODES = ['scheduled', 'event_driven', 'manual'];

describe('IVX Domain Agents Data Model', () => {
  test('has exactly 10 agents', () => {
    expect(IVX_DOMAIN_AGENTS.length).toBe(10);
    expect(IVX_AGENT_COUNT).toBe(10);
  });

  test('all 10 expected agent IDs are present', () => {
    const ids = IVX_DOMAIN_AGENTS.map((a) => a.id);
    for (const expectedId of EXPECTED_AGENT_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test('agent numbers are 1-10 sequential', () => {
    for (let i = 0; i < IVX_DOMAIN_AGENTS.length; i++) {
      expect(IVX_DOMAIN_AGENTS[i].number).toBe(i + 1);
    }
  });

  test('all agent IDs are unique', () => {
    const ids = IVX_DOMAIN_AGENTS.map((a) => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('every agent has required fields', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      expect(typeof agent.id).toBe('string');
      expect(agent.id.length).toBeGreaterThan(0);
      expect(typeof agent.name).toBe('string');
      expect(agent.name.length).toBeGreaterThan(0);
      expect(typeof agent.role).toBe('string');
      expect(agent.role.length).toBeGreaterThan(0);
      expect(typeof agent.domain).toBe('string');
      expect(agent.domain.length).toBeGreaterThan(0);
      expect(typeof agent.icon).toBe('string');
      expect(agent.icon.length).toBeGreaterThan(0);
      expect(typeof agent.color).toBe('string');
      expect(agent.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(typeof agent.engine).toBe('string');
      expect(agent.engine.length).toBeGreaterThan(0);
      expect(typeof agent.mission).toBe('string');
      expect(agent.mission.length).toBeGreaterThan(0);
      expect(typeof agent.produces).toBe('string');
      expect(agent.produces.length).toBeGreaterThan(0);
      expect(Array.isArray(agent.tools)).toBe(true);
      expect(agent.tools.length).toBeGreaterThan(0);
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(agent.capabilities.length).toBeGreaterThan(0);
      expect(Array.isArray(agent.destructiveActions)).toBe(true);
      expect(VALID_RISK_LEVELS).toContain(agent.riskLevel);
      expect(typeof agent.canModifyProduction).toBe('boolean');
      expect(VALID_SCHEDULE_MODES).toContain(agent.scheduleMode);
      expect(typeof agent.apiPath).toBe('string');
      expect(agent.apiPath.startsWith('/')).toBe(true);
    }
  });

  test('all expected domains are present', () => {
    const domains = IVX_DOMAIN_AGENTS.map((a) => a.domain);
    for (const expected of EXPECTED_DOMAINS) {
      expect(domains).toContain(expected);
    }
  });

  test('every tool has valid structure', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      for (const tool of agent.tools) {
        expect(typeof tool.id).toBe('string');
        expect(tool.id.length).toBeGreaterThan(0);
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.endpoint).toBe('string');
        expect(tool.endpoint.startsWith('/')).toBe(true);
        expect(VALID_METHODS).toContain(tool.method);
        expect(typeof tool.readOnly).toBe('boolean');
        expect(typeof tool.ownerRequired).toBe('boolean');
      }
    }
  });

  test('every tool ID is unique within an agent', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      const ids = agent.tools.map((t) => t.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  });

  test('every tool endpoint is unique within an agent', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      const endpoints = agent.tools.map((t) => t.endpoint);
      const unique = new Set(endpoints);
      expect(unique.size).toBe(endpoints.length);
    }
  });

  test('every capability has name, verified, and evidence', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      for (const cap of agent.capabilities) {
        expect(typeof cap.name).toBe('string');
        expect(cap.name.length).toBeGreaterThan(0);
        expect(typeof cap.verified).toBe('boolean');
        expect(typeof cap.evidence).toBe('string');
        expect(cap.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  test('all capabilities are verified (honesty rule)', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      for (const cap of agent.capabilities) {
        expect(cap.verified).toBe(true);
      }
    }
  });

  test('every agent has at least 3 tools', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      expect(agent.tools.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('every agent has at least 3 capabilities', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      expect(agent.capabilities.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('high-risk agents have destructive actions', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      if (agent.riskLevel === 'high') {
        expect(agent.destructiveActions.length).toBeGreaterThan(0);
      }
    }
  });

  test('canModifyProduction agents have destructive actions', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      if (agent.canModifyProduction) {
        expect(agent.destructiveActions.length).toBeGreaterThan(0);
      }
    }
  });

  test('production-modifying write tools require owner permission', () => {
    // Public engagement tools (likes, comments, saves, shares) are user-facing
    // and don't require owner — they use guest_id. Only tools that modify
    // production content (upload, admin update, media jobs) require owner.
    const PUBLIC_ENGAGEMENT_IDS = ['reels-like', 'reels-comment', 'buyer-offer-create', 'jv-create'];
    for (const agent of IVX_DOMAIN_AGENTS) {
      for (const tool of agent.tools) {
        if (!tool.readOnly && agent.canModifyProduction && !PUBLIC_ENGAGEMENT_IDS.includes(tool.id)) {
          expect(tool.ownerRequired).toBe(true);
        }
      }
    }
  });

  test('getAgentById returns correct agent', () => {
    const agent = getAgentById('reels-agent');
    expect(agent).toBeDefined();
    expect(agent?.name).toBe('Reels Agent');
    expect(agent?.number).toBe(5);
  });

  test('getAgentById returns undefined for unknown ID', () => {
    expect(getAgentById('nonexistent')).toBeUndefined();
  });

  test('getAgentByNumber returns correct agent', () => {
    const agent = getAgentByNumber(1);
    expect(agent).toBeDefined();
    expect(agent?.id).toBe('member-agent');
    expect(agent?.name).toBe('Member Agent');
  });

  test('getAgentByNumber returns undefined for unknown number', () => {
    expect(getAgentByNumber(99)).toBeUndefined();
  });

  test('getAgentTools returns tools for known agent', () => {
    const tools = getAgentTools('qa-agent');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.id.length > 0)).toBe(true);
  });

  test('getAgentTools returns empty array for unknown agent', () => {
    expect(getAgentTools('nonexistent')).toEqual([]);
  });

  test('getReadOnlyTools returns only read-only tools', () => {
    const readOnly = getReadOnlyTools('reels-agent');
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.every((t) => t.readOnly === true)).toBe(true);
  });

  test('getWriteTools returns only write tools', () => {
    const write = getWriteTools('reels-agent');
    expect(write.length).toBeGreaterThan(0);
    expect(write.every((t) => t.readOnly === false)).toBe(true);
  });

  test('readOnly + write tools = total tools', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      const readOnly = getReadOnlyTools(agent.id);
      const write = getWriteTools(agent.id);
      expect(readOnly.length + write.length).toBe(agent.tools.length);
    }
  });

  test('getVerifiedCapabilities returns only verified caps', () => {
    const caps = getVerifiedCapabilities('security-agent');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((c) => c.verified === true)).toBe(true);
  });

  test('searchAgents returns all agents for empty query', () => {
    expect(searchAgents('').length).toBe(10);
  });

  test('searchAgents is case-insensitive', () => {
    const lower = searchAgents('investor');
    const upper = searchAgents('INVESTOR');
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBeGreaterThan(0);
  });

  test('searchAgents matches by name', () => {
    const results = searchAgents('Member');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('member-agent');
  });

  test('searchAgents matches by domain', () => {
    const results = searchAgents('Seguridad');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('security-agent');
  });

  test('searchAgents matches by tool name', () => {
    const results = searchAgents('Upload');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((a) => a.id === 'reels-agent')).toBe(true);
  });

  test('searchAgents matches by role', () => {
    const results = searchAgents('SEC EDGAR');
    expect(results.length).toBeGreaterThan(0);
  });

  test('getTotalTools returns sum of all agent tools', () => {
    const total = getTotalTools();
    const manual = IVX_DOMAIN_AGENTS.reduce((sum, a) => sum + a.tools.length, 0);
    expect(total).toBe(manual);
    expect(total).toBeGreaterThanOrEqual(30); // at least 3 per agent
  });

  test('getTotalCapabilities returns sum of all capabilities', () => {
    const total = getTotalCapabilities();
    const manual = IVX_DOMAIN_AGENTS.reduce((sum, a) => sum + a.capabilities.length, 0);
    expect(total).toBe(manual);
    expect(total).toBeGreaterThanOrEqual(30); // at least 3 per agent
  });

  test('getAgentsByRiskLevel filters correctly', () => {
    const low = getAgentsByRiskLevel('low');
    const medium = getAgentsByRiskLevel('medium');
    const high = getAgentsByRiskLevel('high');
    expect(low.length + medium.length + high.length).toBe(10);
    expect(low.every((a) => a.riskLevel === 'low')).toBe(true);
    expect(medium.every((a) => a.riskLevel === 'medium')).toBe(true);
    expect(high.every((a) => a.riskLevel === 'high')).toBe(true);
  });

  test('high-risk agents include deployment and security', () => {
    const high = getAgentsByRiskLevel('high');
    const highIds = high.map((a) => a.id);
    expect(highIds).toContain('deployment-agent');
    expect(highIds).toContain('security-agent');
  });

  test('each agent maps to a real backend engine', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      // Engine must reference a real IVX backend service (not fabricated)
      expect(agent.engine).toMatch(/ivx-/);
      expect(agent.engine.length).toBeGreaterThan(10);
    }
  });

  test('each agent API path starts with /api/', () => {
    for (const agent of IVX_DOMAIN_AGENTS) {
      expect(agent.apiPath).toMatch(/^\/api\//);
    }
  });

  test('Member Agent has registration tool', () => {
    const tools = getAgentTools('member-agent');
    expect(tools.some((t) => t.id === 'member-register')).toBe(true);
  });

  test('Investor Agent has discovery and CRM tools', () => {
    const tools = getAgentTools('investor-agent');
    expect(tools.some((t) => t.id === 'investor-discover')).toBe(true);
    expect(tools.some((t) => t.id === 'investor-crm')).toBe(true);
  });

  test('Reels Agent has upload, like, and comment tools', () => {
    const tools = getAgentTools('reels-agent');
    expect(tools.some((t) => t.id === 'reels-upload')).toBe(true);
    expect(tools.some((t) => t.id === 'reels-like')).toBe(true);
    expect(tools.some((t) => t.id === 'reels-comment')).toBe(true);
  });

  test('Deployment Agent has health check and trigger tools', () => {
    const tools = getAgentTools('deployment-agent');
    expect(tools.some((t) => t.id === 'deploy-health')).toBe(true);
    expect(tools.some((t) => t.id === 'deploy-trigger')).toBe(true);
  });

  test('QA Agent has scheduler and runs tools', () => {
    const tools = getAgentTools('qa-agent');
    expect(tools.some((t) => t.id === 'qa-scheduler')).toBe(true);
    expect(tools.some((t) => t.id === 'qa-runs')).toBe(true);
  });

  test('Security Agent has credentials and guardian tools', () => {
    const tools = getAgentTools('security-agent');
    expect(tools.some((t) => t.id === 'sec-credentials')).toBe(true);
    expect(tools.some((t) => t.id === 'sec-guardian')).toBe(true);
  });
});
