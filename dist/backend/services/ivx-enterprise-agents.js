/**
 * IVX Enterprise Agents — All 14 specialized enterprise agents.
 *
 * Built ON TOP of the Block 25 multi-agent framework and the role-agents system.
 * Each agent reports to the Enterprise Orchestrator.
 *
 * Agent Registry:
 *   1.  Senior Developer      — Code architecture, patches, reviews
 *   2.  Frontend Engineer     — UI/UX, component health, design system
 *   3.  Backend Engineer      — API design, database queries, performance
 *   4.  Database Engineer     — Schema migrations, indexing, query optimization
 *   5.  Deployment Engineer   — CI/CD, Render, GitHub Actions, rollbacks
 *   6.  QA Engineer           — Test coverage, regression detection, E2E
 *   7.  Security Engineer     — Secret scanning, auth audit, dependency vulns
 *   8.  Performance Engineer  — Latency, bundle size, resource usage
 *   9.  AI Research Agent     — New models, frameworks, techniques
 *   10. Business Opportunity  — Investors, acquisitions, partnerships
 *   11. Real Estate Market    — Commercial RE, distressed assets, market data
 *   12. Investor Relations    — Pipeline, updates, pitch optimization
 *   13. Marketing Agent       — Positioning, campaigns, analytics
 *   14. Documentation Agent   — Architecture docs, runbooks, changelogs
 */
import { classifyTaskRisk, completeTask as completeAgentTask, dispatchTask, failTask as failAgentTask, writeAgentMemory, } from './agents/multi-agent-framework';
import { enqueueTask as orchestratorEnqueue, completeTask as orchestratorComplete, failTask as orchestratorFail, } from './ivx-enterprise-orchestrator';
export const IVX_ENTERPRISE_AGENTS_MARKER = 'ivx-enterprise-agents-2026-07-01';
export const ENTERPRISE_AGENTS = {
    senior_developer: {
        id: 'senior_developer',
        name: 'Senior Developer',
        role: 'Lead code architecture, review patches, and drive engineering excellence across the platform.',
        capabilities: ['code_architecture', 'patch_review', 'technical_decision', 'code_quality'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'backend_developer',
        riskLevel: 'medium',
        priority: 'high',
        heartbeatGoal: 'Review open code patches, assess architecture drift, and propose the highest-impact engineering improvement.',
        destructiveActions: ['force push', 'delete branch', 'rewrite history', 'bypass review'],
    },
    frontend_engineer: {
        id: 'frontend_engineer',
        name: 'Frontend Engineer',
        role: 'Own the UI/UX layer — component health, design system consistency, and rendering performance.',
        capabilities: ['component_audit', 'design_system', 'render_performance', 'accessibility'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'frontend_developer',
        riskLevel: 'low',
        priority: 'medium',
        heartbeatGoal: 'Audit frontend component tree for performance regressions, broken styles, or accessibility gaps.',
        destructiveActions: ['remove component', 'change design tokens'],
    },
    backend_engineer: {
        id: 'backend_engineer',
        name: 'Backend Engineer',
        role: 'Own API design, route health, middleware, and backend performance.',
        capabilities: ['api_design', 'middleware_audit', 'route_health', 'error_handling'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'backend_developer',
        riskLevel: 'medium',
        priority: 'high',
        heartbeatGoal: 'Audit backend routes for performance, error handling gaps, and API consistency.',
        destructiveActions: ['delete route', 'change auth middleware', 'modify database schema'],
    },
    database_engineer: {
        id: 'database_engineer',
        name: 'Database Engineer',
        role: 'Own schema design, migrations, indexing strategy, and query performance.',
        capabilities: ['schema_design', 'migration_planning', 'index_optimization', 'query_analysis'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'supabase_database',
        riskLevel: 'high',
        priority: 'medium',
        heartbeatGoal: 'Review database schema for missing indexes, analyze slow queries, and propose safe migrations.',
        destructiveActions: ['drop table', 'truncate data', 'modify production schema'],
    },
    deployment_engineer: {
        id: 'deployment_engineer',
        name: 'Deployment Engineer',
        role: 'Own CI/CD pipeline — Render deploys, GitHub Actions, health verification, rollbacks.',
        capabilities: ['ci_cd_audit', 'deploy_verification', 'rollback_planning', 'health_monitoring'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'infrastructure_sre',
        riskLevel: 'high',
        priority: 'critical',
        heartbeatGoal: 'Verify deployment pipeline health, check GitHub-Render sync, and flag any deployment risks.',
        destructiveActions: ['rollback production', 'force deploy', 'disable health checks'],
    },
    qa_engineer: {
        id: 'qa_engineer',
        name: 'QA Engineer',
        role: 'Own test coverage, regression detection, E2E verification, and quality gates.',
        capabilities: ['test_audit', 'regression_detection', 'e2e_verification', 'coverage_analysis'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'backend_developer',
        riskLevel: 'low',
        priority: 'medium',
        heartbeatGoal: 'Run test suite analysis, identify coverage gaps, and flag any regression risks.',
        destructiveActions: ['delete test data', 'modify test suite'],
    },
    security_engineer: {
        id: 'security_engineer',
        name: 'Security Engineer',
        role: 'Own security posture — secret scanning, auth audit, dependency vulnerabilities, attack surface analysis.',
        capabilities: ['secret_scanning', 'auth_audit', 'vulnerability_scan', 'dependency_audit'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'infrastructure_sre',
        riskLevel: 'medium',
        priority: 'high',
        heartbeatGoal: 'Scan for exposed secrets, audit auth gates, and check dependencies for known vulnerabilities.',
        destructiveActions: ['rotate secrets', 'revoke tokens', 'modify auth gates'],
    },
    performance_engineer: {
        id: 'performance_engineer',
        name: 'Performance Engineer',
        role: 'Own latency, throughput, bundle size, and resource efficiency.',
        capabilities: ['latency_analysis', 'bundle_audit', 'resource_profiling', 'bottleneck_detection'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'infrastructure_sre',
        riskLevel: 'low',
        priority: 'medium',
        heartbeatGoal: 'Profile endpoint latency, analyze bundle sizes, and identify performance bottlenecks.',
        destructiveActions: ['modify infrastructure', 'change scaling rules'],
    },
    ai_research: {
        id: 'ai_research',
        name: 'AI Research Agent',
        role: 'Continuously research new AI models, frameworks, startups, and techniques worth adopting.',
        capabilities: ['model_research', 'framework_discovery', 'startup_tracking', 'technology_adoption'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'analytics',
        riskLevel: 'low',
        priority: 'low',
        heartbeatGoal: 'Research the latest AI developments and rank technologies by potential business impact.',
        destructiveActions: [],
    },
    business_opportunity: {
        id: 'business_opportunity',
        name: 'Business Opportunity Agent',
        role: 'Search for investors, acquisitions, partnerships, grants, and enterprise customers.',
        capabilities: ['investor_discovery', 'acquisition_scouting', 'partnership_matching', 'grant_tracking'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'investor_relations',
        riskLevel: 'medium',
        priority: 'medium',
        heartbeatGoal: 'Scan for new business opportunities — investors, acquisitions, partnerships, and grants.',
        destructiveActions: ['contact lead', 'send proposal', 'commit resources'],
    },
    real_estate_market: {
        id: 'real_estate_market',
        name: 'Real Estate Market Agent',
        role: 'Track commercial real estate, distressed assets, market trends, and RE technology.',
        capabilities: ['market_analysis', 'distressed_asset_tracking', 're_tech_discovery', 'valuation_modeling'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'investment',
        riskLevel: 'medium',
        priority: 'low',
        heartbeatGoal: 'Analyze real estate market data for commercial opportunities and distressed assets.',
        destructiveActions: ['make offer', 'commit capital', 'sign LOI'],
    },
    investor_relations: {
        id: 'investor_relations',
        name: 'Investor Relations Agent',
        role: 'Manage investor pipeline, prepare updates, optimize pitch materials, and track commitments.',
        capabilities: ['investor_pipeline', 'update_preparation', 'pitch_optimization', 'commitment_tracking'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'investor_relations',
        riskLevel: 'medium',
        priority: 'medium',
        heartbeatGoal: 'Review investor pipeline, prepare status updates, and flag follow-up opportunities.',
        destructiveActions: ['send investor comms', 'share financial data', 'commit terms'],
    },
    marketing: {
        id: 'marketing',
        name: 'Marketing Agent',
        role: 'Own positioning, campaign strategy, analytics, and brand consistency.',
        capabilities: ['positioning_analysis', 'campaign_strategy', 'analytics_review', 'brand_audit'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'analytics',
        riskLevel: 'low',
        priority: 'low',
        heartbeatGoal: 'Review marketing positioning, analyze engagement metrics, and propose growth experiments.',
        destructiveActions: ['launch campaign', 'send outreach', 'modify public content'],
    },
    documentation: {
        id: 'documentation',
        name: 'Documentation Agent',
        role: 'Maintain architecture docs, runbooks, changelogs, and knowledge base.',
        capabilities: ['architecture_docs', 'runbook_generation', 'changelog_maintenance', 'knowledge_base'],
        reportsTo: 'enterprise_orchestrator',
        frameworkAgent: 'operations',
        riskLevel: 'low',
        priority: 'low',
        heartbeatGoal: 'Audit documentation coverage, generate missing runbooks, and update changelogs from recent deployments.',
        destructiveActions: ['delete documentation', 'remove runbook'],
    },
};
export const ENTERPRISE_AGENT_IDS = Object.keys(ENTERPRISE_AGENTS);
// ── Agent Registry Lookup ──────────────────────────────────────────────────
export function getEnterpriseAgent(id) {
    const agent = ENTERPRISE_AGENTS[id];
    if (!agent)
        throw new Error(`Unknown enterprise agent: ${id}`);
    return agent;
}
export function getFrameworkAgentId(enterpriseId) {
    return ENTERPRISE_AGENTS[enterpriseId].frameworkAgent;
}
/**
 * Dispatch work to an enterprise agent via the orchestrator + framework.
 */
export async function dispatchEnterpriseTask(agentId, goal, priority) {
    const agent = getEnterpriseAgent(agentId);
    // 1. Enqueue in the Enterprise Orchestrator
    const orchTask = await orchestratorEnqueue({
        goal,
        targetSubsystem: 'agent_framework',
        targetAgent: agentId,
        priority: priority ?? agent.priority,
        maxRetries: 3,
        dependencies: [],
    });
    // 2. Dispatch through the multi-agent framework
    const risk = classifyTaskRisk(goal);
    const frameworkTask = dispatchTask({
        goal,
        forceAgent: agent.frameworkAgent,
        metadata: { risk, enterpriseAgent: agentId },
    });
    return {
        enterpriseTaskId: orchTask.id,
        agentId,
        goal,
        status: 'dispatched',
        frameworkTaskId: frameworkTask?.task?.id ?? null,
        error: null,
    };
}
/**
 * Complete an enterprise agent task.
 */
export async function completeEnterpriseTask(enterpriseTaskId, frameworkTaskId) {
    await orchestratorComplete(enterpriseTaskId);
    if (frameworkTaskId) {
        completeAgentTask(frameworkTaskId, { completed: true });
    }
}
/**
 * Fail an enterprise agent task.
 */
export async function failEnterpriseTask(enterpriseTaskId, frameworkTaskId, error) {
    await orchestratorFail(enterpriseTaskId, error);
    if (frameworkTaskId) {
        failAgentTask(frameworkTaskId, error);
    }
}
// ── Memory Operations ──────────────────────────────────────────────────────
export async function writeEnterpriseMemory(agentId, key, value, metadata) {
    const agent = getEnterpriseAgent(agentId);
    await writeAgentMemory(agent.frameworkAgent, `enterprise:${agentId}:${key}`, value, metadata);
}
// ── Validation ─────────────────────────────────────────────────────────────
export function validateEnterpriseAgents() {
    const issues = [];
    for (const id of ENTERPRISE_AGENT_IDS) {
        const agent = ENTERPRISE_AGENTS[id];
        if (!agent.name)
            issues.push(`${id}: missing name`);
        if (!agent.role)
            issues.push(`${id}: missing role`);
        if (!agent.capabilities.length)
            issues.push(`${id}: no capabilities`);
        if (!agent.frameworkAgent)
            issues.push(`${id}: missing framework agent binding`);
        if (!agent.heartbeatGoal)
            issues.push(`${id}: missing heartbeat goal`);
    }
    return { valid: issues.length === 0, issues };
}
// ── Agent Status Summary (for Live Operations Center) ──────────────────────
export function getEnterpriseAgentSummary() {
    return ENTERPRISE_AGENT_IDS.map((id) => {
        const agent = ENTERPRISE_AGENTS[id];
        return {
            id,
            name: agent.name,
            role: agent.role,
            riskLevel: agent.riskLevel,
            priority: agent.priority,
            capabilities: agent.capabilities.length,
        };
    });
}
