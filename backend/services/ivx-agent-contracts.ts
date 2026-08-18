/**
 * IVX Independent Agent Contract System — 112 individually governed agents.
 *
 * Each agent has its own stored contract containing:
 * - Unique agent ID, name, role, mission
 * - Unique system instructions (not duplicated, not name-swapped)
 * - Input/output schemas
 * - Allowed/prohibited task types
 * - Allowed/prohibited tools
 * - Database read/write permissions
 * - External service permissions
 * - Owner approval rules
 * - Memory namespace (scoped, isolated)
 * - Queue namespace (independent task inbox)
 * - Scheduler config (per-agent schedule or event-driven)
 * - Concurrency limit, cost limit, retry policy, timeout policy
 * - Evidence requirements
 * - Status, version, timestamps
 *
 * NO RORK DEPENDENCY. All contracts are self-contained.
 */
import {
  ALL_ENTERPRISE_AGENTS,
  ENTERPRISE_COMPANIES,
  type EnterpriseMasterAgent,
  type CompanyId,
  type DivisionId,
} from './ivx-enterprise-master-registry';

export const IVX_AGENT_CONTRACTS_MARKER = 'ivx-agent-contracts-2026-07-27';

// ── Contract Schema ─────────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'paused' | 'disabled' | 'archived';

export type RetryPolicy = {
  maxRetries: number;
  backoffStrategy: 'fixed' | 'exponential';
  initialDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
};

export type TimeoutPolicy = {
  executionTimeoutMs: number;
  toolCallTimeoutMs: number;
  approvalTimeoutMs: number;
};

export type CostLimit = {
  maxCostPerRun: number;
  maxCostPerDay: number;
  maxCostPerMonth: number;
  currency: string;
};

export type SchedulerConfig = {
  mode: 'scheduled' | 'event_driven' | 'manual';
  frequency?: string;
  timezone: string;
  nextRunAt?: string;
  lastRunAt?: string | null;
  missedRunPolicy: 'skip' | 'catch_up' | 'alert_owner';
};

export type OwnerApprovalRule = {
  action: string;
  required: boolean;
  autoApproveLowRisk: boolean;
  timeoutMinutes: number;
  timeoutAction: 'reject' | 'escalate' | 'auto_approve_with_evidence';
};

export type EvidenceRequirement = {
  type: string;
  required: boolean;
  description: string;
};

export type InputSchemaField = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';
  required: boolean;
  description: string;
};

export type OutputSchemaField = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';
  required: boolean;
  description: string;
};

export type AgentContract = {
  agentId: string;
  agentName: string;
  agentNumber: number;
  divisionId: DivisionId;
  companyId: CompanyId;
  roleName: string;
  mission: string;
  systemInstructions: string;
  inputSchema: InputSchemaField[];
  outputSchema: OutputSchemaField[];
  allowedTaskTypes: string[];
  prohibitedTaskTypes: string[];
  allowedTools: string[];
  prohibitedTools: string[];
  readPermissions: string[];
  writePermissions: string[];
  externalServicePermissions: string[];
  ownerApprovalRules: OwnerApprovalRule[];
  memoryNamespace: string;
  queueNamespace: string;
  schedulerConfig: SchedulerConfig;
  concurrencyLimit: number;
  costLimit: CostLimit;
  retryPolicy: RetryPolicy;
  timeoutPolicy: TimeoutPolicy;
  evidenceRequirements: EvidenceRequirement[];
  status: AgentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  instructionHash: string;
};

// ── Permission Templates by Role Category ───────────────────────────────────

type RoleCategory =
  | 'mobile' | 'web' | 'backend' | 'database' | 'ai_chat' | 'owner_ai'
  | 'dashboard' | 'investor' | 'buyer' | 'crm' | 'tokenization'
  | 'property' | 'deals' | 'marketing' | 'analytics' | 'qa' | 'security'
  | 'compliance' | 'cloud' | 'devops' | 'deployment' | 'monitoring'
  | 'documentation' | 'support' | 'performance' | 'autonomous_ops'
  | 'orchestrator' | 'executive' | 'saas_product' | 'saas_backend'
  | 'saas_frontend' | 'saas_mobile' | 'saas_ai' | 'saas_qa' | 'saas_security'
  | 'saas_devops' | 'saas_deployment' | 'saas_docs' | 'healthcare_product'
  | 'healthcare_workflow' | 'healthcare_automation' | 'healthcare_scheduling'
  | 'healthcare_compliance' | 'construction_estimating' | 'construction_engineering'
  | 'construction_permitting' | 'construction_scheduling' | 'construction_cost'
  | 'finance_analytics' | 'finance_portfolio' | 'finance_risk' | 'finance_reporting'
  | 'finance_cashflow' | 'legal_contract' | 'legal_compliance' | 'legal_documents'
  | 'legal_workflow' | 'marketing_seo' | 'marketing_social' | 'marketing_video'
  | 'marketing_campaign' | 'marketing_analytics' | 'research_ai' | 'research_quantum'
  | 'research_robotics' | 'research_biotech' | 'research_materials' | 'research_patent'
  | 'research_competitive' | 'research_prototype' | 'automation_api' | 'automation_workflow'
  | 'automation_process' | 'automation_tools' | 'education_course' | 'education_knowledge'
  | 'education_tutor' | 'enterprise_bi';

function categorizeAgent(agent: EnterpriseMasterAgent): RoleCategory {
  const caps = agent.capabilities.join(' ');
  const role = agent.role.toLowerCase();

  // Division A categorization
  if (agent.division === 'A') {
    if (caps.includes('react_native') || caps.includes('expo') || caps.includes('mobile')) return 'mobile';
    if (caps.includes('web_architecture') || caps.includes('landing_page') || caps.includes('playwright')) return 'web';
    if (caps.includes('api_design') || caps.includes('api_implementation') || caps.includes('middleware')) return 'backend';
    if (caps.includes('schema_design') || caps.includes('migration') || caps.includes('etl') || caps.includes('rls')) return 'database';
    if (caps.includes('ai_chat') || caps.includes('conversation_brain') || caps.includes('provider_management')) return 'ai_chat';
    if (caps.includes('owner_ai') || caps.includes('passwordless_auth')) return 'owner_ai';
    if (caps.includes('dashboard') || caps.includes('executive_dashboard')) return 'dashboard';
    if (caps.includes('investor_pipeline') || caps.includes('investor_relations')) return 'investor';
    if (caps.includes('buyer_offers') || caps.includes('buyer_crm')) return 'buyer';
    if (caps.includes('crm_architecture') || caps.includes('crm_automation')) return 'crm';
    if (caps.includes('tokenization') || caps.includes('smart_contracts')) return 'tokenization';
    if (caps.includes('property_management') || caps.includes('property_data')) return 'property';
    if (caps.includes('deal_management') || caps.includes('ai_analysis') && role.includes('deal')) return 'deals';
    if (caps.includes('marketing_strategy') || caps.includes('seo')) return 'marketing';
    if (caps.includes('analytics') && !role.includes('finance')) return 'analytics';
    if (caps.includes('qa_strategy') || caps.includes('e2e') || caps.includes('coverage_analysis')) return 'qa';
    if (caps.includes('security') || caps.includes('secret_scanning') || caps.includes('vulnerabilities')) return 'security';
    if (caps.includes('compliance') || caps.includes('kyc_aml')) return 'compliance';
    if (caps.includes('cloud_architecture') || caps.includes('render') || caps.includes('aws')) return 'cloud';
    if (caps.includes('ci_cd') || caps.includes('docker') || caps.includes('deployment')) return 'devops';
    if (caps.includes('deployment') && role.includes('deployment')) return 'deployment';
    if (caps.includes('monitoring') || caps.includes('alerting') || caps.includes('uptime')) return 'monitoring';
    if (caps.includes('documentation') || caps.includes('runbooks')) return 'documentation';
    if (caps.includes('customer_support') || caps.includes('issue_tracking')) return 'support';
    if (caps.includes('performance') || caps.includes('latency')) return 'performance';
    if (caps.includes('autonomous') || caps.includes('scheduler')) return 'autonomous_ops';
    if (caps.includes('orchestration') || caps.includes('workload_balancing')) return 'orchestrator';
    if (caps.includes('executive_reports') || caps.includes('scorecards')) return 'executive';
  }

  // Division B categorization
  if (agent.company === 'saas_builder') {
    if (role.includes('product')) return 'saas_product';
    if (role.includes('backend')) return 'saas_backend';
    if (role.includes('frontend')) return 'saas_frontend';
    if (role.includes('mobile')) return 'saas_mobile';
    if (role.includes('ai')) return 'saas_ai';
    if (role.includes('qa') || role.includes('test')) return 'saas_qa';
    if (role.includes('security')) return 'saas_security';
    if (role.includes('devops') || role.includes('ci/cd')) return 'saas_devops';
    if (role.includes('deployment')) return 'saas_deployment';
    if (role.includes('documentation')) return 'saas_docs';
  }
  if (agent.company === 'healthcare_tech') {
    if (role.includes('product')) return 'healthcare_product';
    if (role.includes('workflow')) return 'healthcare_workflow';
    if (role.includes('automation') || role.includes('claims')) return 'healthcare_automation';
    if (role.includes('scheduling')) return 'healthcare_scheduling';
    if (role.includes('compliance') || role.includes('hipaa')) return 'healthcare_compliance';
  }
  if (agent.company === 'construction_tech') {
    if (role.includes('estimating') || role.includes('cost estimation')) return 'construction_estimating';
    if (role.includes('engineering') || role.includes('structural')) return 'construction_engineering';
    if (role.includes('permit')) return 'construction_permitting';
    if (role.includes('scheduling') || role.includes('critical path')) return 'construction_scheduling';
    if (role.includes('cost control') || role.includes('budget')) return 'construction_cost';
  }
  if (agent.company === 'finance_tech') {
    if (role.includes('analytics') || role.includes('performance')) return 'finance_analytics';
    if (role.includes('portfolio') || role.includes('optimization')) return 'finance_portfolio';
    if (role.includes('risk') || role.includes('var')) return 'finance_risk';
    if (role.includes('reporting') || role.includes('regulatory')) return 'finance_reporting';
    if (role.includes('cash flow') || role.includes('liquidity')) return 'finance_cashflow';
  }
  if (agent.company === 'legal_tech') {
    if (role.includes('contract')) return 'legal_contract';
    if (role.includes('compliance') || role.includes('regulatory')) return 'legal_compliance';
    if (role.includes('document')) return 'legal_documents';
    if (role.includes('workflow') || role.includes('matter')) return 'legal_workflow';
  }
  if (agent.company === 'marketing_tech') {
    if (role.includes('seo')) return 'marketing_seo';
    if (role.includes('social')) return 'marketing_social';
    if (role.includes('video')) return 'marketing_video';
    if (role.includes('campaign')) return 'marketing_campaign';
    if (role.includes('analytics') || role.includes('funnel')) return 'marketing_analytics';
  }
  if (agent.company === 'research_innovation') {
    if (role.includes('ai research')) return 'research_ai';
    if (role.includes('quantum')) return 'research_quantum';
    if (role.includes('robotics')) return 'research_robotics';
    if (role.includes('biotech')) return 'research_biotech';
    if (role.includes('materials')) return 'research_materials';
    if (role.includes('patent')) return 'research_patent';
    if (role.includes('competitive')) return 'research_competitive';
    if (role.includes('prototype')) return 'research_prototype';
  }
  if (agent.company === 'business_automation') {
    if (role.includes('api integration')) return 'automation_api';
    if (role.includes('workflow automation')) return 'automation_workflow';
    if (role.includes('process') || role.includes('bpm')) return 'automation_process';
    if (role.includes('internal tools')) return 'automation_tools';
  }
  if (agent.company === 'education_tech') {
    if (role.includes('course')) return 'education_course';
    if (role.includes('knowledge')) return 'education_knowledge';
    if (role.includes('tutor')) return 'education_tutor';
  }
  if (agent.company === 'enterprise_operations') return 'enterprise_bi';

  return 'analytics';
}

// ── Unique System Instruction Generator ─────────────────────────────────────

function generateSystemInstructions(
  agent: EnterpriseMasterAgent,
  category: RoleCategory,
): string {
  const company = ENTERPRISE_COMPANIES[agent.company];
  const divisionName = agent.division === 'A' ? 'IVX Holdings (Division A)' : `${company.name} (Division B)`;
  const riskLabel = agent.riskLevel.toUpperCase();
  const canModify = agent.canModifyIVX;
  const buildsProducts = agent.buildsNewProducts;

  const sections: string[] = [];

  // Section 1: Identity & Responsibility
  sections.push(
    `# AGENT IDENTITY\n` +
    `You are ${agent.name}, agent #${agent.agentNumber} in ${divisionName}.\n` +
    `Company: ${company.name} (${company.description})\n` +
    `Role: ${agent.role}\n` +
    `Risk Level: ${riskLabel}\n` +
    `Can modify IVX production: ${canModify}\n` +
    `Builds new products: ${buildsProducts}\n\n` +
    `Your exact responsibility: ${agent.responsibilities.join('; ')}.\n` +
    `Your mission: ${agent.heartbeatGoal}`,
  );

  // Section 2: Inputs Accepted (unique per category)
  const inputMap: Record<RoleCategory, string> = {
    mobile: 'Mobile app source code paths, Expo/React Native file trees, app store metadata, device compatibility reports, Maestro flow definitions, component audit requests.',
    web: 'Web page URLs, HTML/CSS/JS source, Playwright test results, SEO audit data, landing page content, cross-browser compatibility reports.',
    backend: 'API route definitions, request/response schemas, OpenAPI specs, middleware configurations, error logs, endpoint performance metrics.',
    database: 'SQL schema files, migration scripts, query execution plans, index usage statistics, RLS policy definitions, data quality reports.',
    ai_chat: 'AI provider configurations, conversation logs, prompt templates, function calling schemas, streaming response configs, provider health metrics.',
    owner_ai: 'Owner authentication logs, passwordless login requests, owner AI conversation history, executive AI feature requests, security audit logs for owner module.',
    dashboard: 'Dashboard UI component trees, data source configurations, KPI definitions, real-time metric feeds, executive view specifications.',
    investor: 'Investor application data, CRM contact records, pipeline stage transitions, communication logs, investor scoring inputs, financial data access requests.',
    buyer: 'Buyer offer data, buyer CRM records, deal matching parameters, property listing data, buyer scoring inputs, offer evaluation criteria.',
    crm: 'CRM contact records, pipeline stage data, lead sources, communication history, automation rule definitions, follow-up schedules.',
    tokenization: 'Asset tokenization parameters, smart contract ABIs, compliance check results, token mint/burn logs, audit trail records, regulatory requirements.',
    property: 'Property listing data, valuation inputs, market data feeds, property analytics queries, listing management requests.',
    deals: 'Deal financial data, JV partnership terms, pool tier definitions, risk scoring inputs, opportunity detection parameters, deal pipeline records.',
    marketing: 'Marketing campaign data, engagement metrics, SEO rankings, content performance, brand consistency audits, growth experiment results.',
    analytics: 'Analytics pipeline configs, metric definitions, data visualization specs, BI dashboard layouts, KPI calculation formulas, trend analysis inputs.',
    qa: 'Test suite results, coverage reports, regression test data, E2E flow definitions, integration test configs, production verification checklists.',
    security: 'Security scan results, secret detection logs, auth audit trails, vulnerability reports, dependency advisories, penetration test findings.',
    compliance: 'KYC/AML verification records, regulatory compliance checklists, data privacy audit logs, audit trail exports, compliance policy documents.',
    cloud: 'Cloud infrastructure configs, Render service settings, AWS resource inventories, Supabase project configs, cost optimization reports, scaling metrics.',
    devops: 'CI/CD pipeline configs, Dockerfile definitions, deployment logs, environment variable lists, build cache stats, environment management requests.',
    deployment: 'Deployment manifests, health check results, rollback procedures, release notes, GitHub-Render sync status, deployment risk assessments.',
    monitoring: 'System monitoring configs, alert rule definitions, uptime tracking data, log aggregation queries, incident reports, monitoring gap analyses.',
    documentation: 'Architecture diagram specs, runbook templates, changelog entries, API documentation source, knowledge base articles, documentation gap reports.',
    support: 'Customer support tickets, issue tracking data, user feedback reports, support automation configs, satisfaction survey results.',
    performance: 'Performance profiling data, latency measurements, bundle size reports, resource utilization metrics, bottleneck analysis inputs.',
    autonomous_ops: 'Autonomous system health metrics, scheduler state data, engine execution logs, autonomous reporting configs, task queue depths.',
    orchestrator: 'Task queue data, agent workload distributions, duplicate detection logs, failure escalation records, orchestrator config changes.',
    executive: 'Company scorecard data, AI agent performance metrics, engineering KPIs, capital deployment reports, risk assessment summaries.',
    saas_product: 'SaaS market research data, product roadmap inputs, user story templates, feature prioritization matrices, competitor analysis for new SaaS products.',
    saas_backend: 'Backend architecture specs, API design documents, database schema designs, server logic requirements for new SaaS products being built.',
    saas_frontend: 'Frontend component specs, design system definitions, UX wireframes, page layout requirements for new SaaS products.',
    saas_mobile: 'Mobile app specs, React Native/Expo configs, app store requirements for new SaaS products.',
    saas_ai: 'AI feature specs, chat integration requirements, embedding configs, RAG pipeline designs for new SaaS products.',
    saas_qa: 'Test coverage requirements, E2E test plans, regression test definitions for new SaaS products.',
    saas_security: 'Security audit requirements, secret scanning configs, auth implementation specs for new SaaS products.',
    saas_devops: 'CI/CD pipeline templates, deployment infrastructure specs, environment management for new SaaS products.',
    saas_deployment: 'Deployment strategy docs, release management plans, health verification configs for new SaaS products.',
    saas_docs: 'Documentation requirements, API doc templates, user guide specs for new SaaS products.',
    healthcare_product: 'Healthcare market research, HIPAA regulatory requirements, FDA submission pathways, healthcare product roadmap inputs.',
    healthcare_workflow: 'Medical workflow specifications, patient scheduling requirements, care coordination protocols, clinical workflow automation specs.',
    healthcare_automation: 'Claims processing rules, billing automation specs, records management requirements, healthcare process automation configs.',
    healthcare_scheduling: 'Appointment scheduling algorithms, resource allocation parameters, calendar optimization inputs, healthcare scheduling system specs.',
    healthcare_compliance: 'HIPAA compliance checklists, FDA regulatory requirements, audit trail specs, healthcare data privacy controls.',
    construction_estimating: 'Construction project plans, material takeoff data, labor rate tables, cost estimation parameters, project bidding requirements.',
    construction_engineering: 'Structural analysis parameters, engineering calculation inputs, design verification specs, construction engineering standards.',
    construction_permitting: 'Permit application data, building code requirements, regulatory submission templates, permit tracking system specs.',
    construction_scheduling: 'Project schedule data, critical path analysis inputs, resource leveling parameters, construction scheduling algorithms.',
    construction_cost: 'Budget tracking data, cost variance reports, change order records, construction cost control system specs.',
    finance_analytics: 'Investment performance data, portfolio tracking inputs, benchmarking parameters, performance attribution models.',
    finance_portfolio: 'Portfolio optimization parameters, asset allocation models, rebalancing thresholds, portfolio management system specs.',
    finance_risk: 'Risk analysis inputs, VaR calculation parameters, stress test scenarios, risk model configurations.',
    finance_reporting: 'Financial reporting templates, regulatory report formats, investor statement requirements, financial reporting system specs.',
    finance_cashflow: 'Cash flow data, projection models, liquidity management parameters, treasury optimization inputs.',
    legal_contract: 'Contract analysis inputs, clause extraction parameters, risk identification models, contract generation templates.',
    legal_compliance: 'Regulatory compliance monitoring data, obligation tracking records, policy management specs for legal tech.',
    legal_documents: 'Legal document automation specs, template management configs, document assembly requirements.',
    legal_workflow: 'Legal workflow automation configs, matter management data, deadline tracking parameters.',
    marketing_seo: 'SEO automation configs, keyword research data, rank tracking parameters, content optimization inputs.',
    marketing_social: 'Social media automation specs, content scheduling parameters, engagement analytics inputs.',
    marketing_video: 'Video automation configs, content generation parameters, video editing specs, distribution channel settings.',
    marketing_campaign: 'Campaign management configs, A/B test parameters, attribution model specs, ROI analysis inputs.',
    marketing_analytics: 'Marketing analytics data, funnel analysis parameters, customer journey maps, conversion optimization inputs.',
    research_ai: 'AI model research papers, framework evaluation criteria, technique analysis parameters, business impact assessment inputs.',
    research_quantum: 'Quantum computing research data, technology evaluation criteria, business implication assessment inputs.',
    research_robotics: 'Robotics research data, automation opportunity assessments, technology evaluation inputs.',
    research_biotech: 'Biotechnology research data, healthcare implication assessments, technology evaluation inputs.',
    research_materials: 'Materials science research data, manufacturing implication assessments, technology evaluation inputs.',
    research_patent: 'Patent filing data, IP opportunity assessments, competitive landscape analysis inputs.',
    research_competitive: 'Competitor monitoring data, market shift analysis inputs, technology trend reports, strategic analysis parameters.',
    research_prototype: 'Research finding evaluations, proof-of-concept specs, prototype development requirements, technical feasibility inputs.',
    automation_api: 'API integration platform specs, connector library definitions, data synchronization configs.',
    automation_workflow: 'Workflow automation engine specs, trigger rule definitions, action chain configs, process orchestration parameters.',
    automation_process: 'Enterprise process automation specs, BPM configurations, process mining inputs, optimization parameters.',
    automation_tools: 'Internal tools development specs, admin panel requirements, operational dashboard configs.',
    education_course: 'Course builder specs, curriculum design parameters, content management inputs, learning path definitions.',
    education_knowledge: 'Knowledge base configs, documentation specs, search parameters, content organization requirements.',
    education_tutor: 'AI tutor configs, personalized learning parameters, adaptive assessment specs, progress tracking inputs.',
    enterprise_bi: 'Executive dashboard specs, KPI analytics configs, forecasting parameters, resource planning inputs, business intelligence requirements.',
  };

  sections.push(
    `# INPUTS ACCEPTED\n` +
    inputMap[category],
  );

  // Section 3: Outputs Required (unique per category)
  const outputMap: Record<RoleCategory, string> = {
    mobile: 'Structured mobile audit report with: component issues found, navigation gaps, animation defects, design system violations, recommended fixes with priority levels, and evidence (file paths, line numbers, screenshots if applicable).',
    web: 'Web audit report with: content accuracy findings, performance metrics, SEO compliance status, cross-browser issues, recommended improvements, and evidence (URLs, HTML snippets, test results).',
    backend: 'API audit report with: route health status, validation gaps, error handling issues, performance metrics, API consistency findings, and evidence (endpoint paths, response examples, error logs).',
    database: 'Database audit report with: missing indexes identified, slow queries flagged, migration safety assessment, RLS policy gaps, data quality issues, and evidence (SQL EXPLAIN output, schema diffs, query timings).',
    ai_chat: 'AI chat audit report with: provider health status, conversation quality findings, prompt engineering issues, function calling accuracy, streaming reliability assessment, and evidence (conversation logs, response latencies, error rates).',
    owner_ai: 'Owner AI security audit with: authentication integrity findings, response quality assessment, executive AI feature gaps, security vulnerabilities, and evidence (auth logs, response samples, security scan results). OWNER APPROVAL REQUIRED for any changes.',
    dashboard: 'Dashboard audit report with: data accuracy findings, UI responsiveness issues, feature completeness assessment, real-time metric verification, and evidence (screenshot references, data source checks, KPI calculations).',
    investor: 'Investor pipeline report with: stalled applications flagged, follow-up recommendations, CRM data quality findings, communication log gaps, and evidence (pipeline stage data, CRM record IDs, communication timestamps).',
    buyer: 'Buyer offer report with: unmatched buyers identified, deal matching recommendations, offer evaluation findings, buyer scoring results, and evidence (offer IDs, match scores, property references).',
    crm: 'CRM audit report with: data quality findings, pipeline stage issues, stale leads identified, automation rule gaps, and evidence (CRM record IDs, pipeline metrics, automation logs).',
    tokenization: 'Tokenization audit report with: compliance check results, architecture findings, smart contract review, audit trail verification, and evidence (contract addresses, compliance records, audit log entries).',
    property: 'Property audit report with: listing completeness findings, valuation accuracy assessment, market data freshness check, data gap identification, and evidence (listing IDs, valuation comparisons, market data timestamps).',
    deals: 'Deal audit report with: active deal status, financial calculation verification, risk flags, pool tier validation, and evidence (deal IDs, financial calculations, risk scores).',
    marketing: 'Marketing report with: positioning analysis, engagement metrics summary, growth experiment recommendations, brand consistency findings, and evidence (campaign IDs, engagement data, brand audit results).',
    analytics: 'Analytics audit report with: pipeline health, metric accuracy verification, visualization gap findings, new visualization recommendations, and evidence (pipeline configs, metric calculations, dashboard screenshots).',
    qa: 'QA report with: test suite results, coverage gap analysis, regression risk assessment, quality gate status, and evidence (test run IDs, coverage percentages, regression test results).',
    security: 'Security audit report with: exposed secrets found, auth gate vulnerabilities, dependency advisories, vulnerability assessment, and evidence (scan results, secret locations, CVE references). OWNER APPROVAL REQUIRED for remediation.',
    compliance: 'Compliance audit report with: KYC/AML process verification, data privacy assessment, audit log completeness, regulatory findings, and evidence (compliance check results, audit log samples, regulatory references).',
    cloud: 'Cloud infrastructure report with: resource health, cost optimization opportunities, scaling recommendations, infrastructure risks, and evidence (resource IDs, cost metrics, health check results). OWNER APPROVAL REQUIRED for infrastructure changes.',
    devops: 'DevOps report with: CI/CD pipeline health, Docker config findings, deployment risk assessment, environment management issues, and evidence (pipeline run IDs, Dockerfile analysis, deployment logs). OWNER APPROVAL REQUIRED for pipeline changes.',
    deployment: 'Deployment readiness report with: pipeline health, GitHub-Render sync status, deployment risk assessment, rollback plan verification, and evidence (commit SHAs, deploy IDs, health check results). OWNER APPROVAL REQUIRED for production deploys.',
    monitoring: 'Monitoring report with: coverage assessment, alert configuration findings, uptime tracking results, log management issues, and evidence (alert configs, uptime stats, log volume metrics).',
    documentation: 'Documentation report with: coverage assessment, missing runbooks identified, changelog updates needed, API doc gaps, and evidence (doc paths, gap lists, generated content).',
    support: 'Support report with: open issue summary, feedback trend analysis, support automation findings, recommended improvements, and evidence (ticket IDs, feedback data, automation logs).',
    performance: 'Performance report with: latency profiling results, bundle size analysis, resource efficiency findings, bottleneck identification, and evidence (profiling data, bundle measurements, resource metrics).',
    autonomous_ops: 'Autonomous system report with: scheduler health, engine execution status, task queue analysis, system-wide risk flags, and evidence (scheduler state, engine run logs, queue depths). OWNER APPROVAL REQUIRED for system config changes.',
    orchestrator: 'Orchestrator report with: task queue analysis, workload distribution findings, duplicate detection results, escalation status, and evidence (queue metrics, agent load data, duplicate logs). OWNER APPROVAL REQUIRED for config changes.',
    executive: 'Executive report with: company scorecards, AI agent performance summaries, engineering KPIs, capital deployment status, risk assessment, and evidence (scorecard data, KPI calculations, performance metrics). Cannot rewrite failed results as success.',
    saas_product: 'SaaS product report with: market opportunity analysis, roadmap recommendations, user story prioritization, feature backlog, and evidence (market data, competitor analysis, user story definitions).',
    saas_backend: 'SaaS backend implementation report with: architecture design, API specs, database schema, server logic documentation, and evidence (code paths, API docs, schema files). CANNOT deploy to production without owner approval.',
    saas_frontend: 'SaaS frontend implementation report with: component inventory, design system specs, page layouts, UX findings, and evidence (component paths, design tokens, layout specs).',
    saas_mobile: 'SaaS mobile implementation report with: app architecture, Expo/React Native configs, app store readiness, and evidence (app configs, build settings, store metadata).',
    saas_ai: 'SaaS AI integration report with: feature design, chat integration specs, embedding configs, RAG pipeline design, and evidence (AI configs, prompt templates, integration code paths).',
    saas_qa: 'SaaS QA report with: test coverage analysis, E2E results, regression findings, quality gate status, and evidence (test run IDs, coverage data, regression logs).',
    saas_security: 'SaaS security report with: audit findings, secret scan results, auth implementation review, vulnerability assessment, and evidence (scan IDs, secret locations, auth code paths).',
    saas_devops: 'SaaS DevOps report with: CI/CD pipeline design, deployment infrastructure plan, environment management specs, and evidence (pipeline configs, infrastructure diagrams, environment definitions).',
    saas_deployment: 'SaaS deployment report with: deployment strategy, release plan, health verification config, rollback procedures, and evidence (deployment configs, health check specs, rollback plans). OWNER APPROVAL REQUIRED for production deploys.',
    saas_docs: 'SaaS documentation report with: architecture docs, API documentation, user guides, knowledge base articles, and evidence (doc paths, content samples, coverage metrics).',
    healthcare_product: 'Healthcare product report with: market opportunity, regulatory requirements (HIPAA/FDA), product roadmap, and evidence (market research data, regulatory citations, roadmap documents).',
    healthcare_workflow: 'Healthcare workflow report with: workflow automation design, scheduling specs, care coordination protocols, and evidence (workflow diagrams, scheduling algorithms, protocol definitions).',
    healthcare_automation: 'Healthcare automation report with: claims processing design, billing automation specs, records management configs, and evidence (automation configs, process flows, data schemas).',
    healthcare_scheduling: 'Healthcare scheduling report with: appointment scheduling design, resource allocation algorithms, calendar optimization specs, and evidence (scheduling configs, algorithm definitions, optimization results).',
    healthcare_compliance: 'Healthcare compliance report with: HIPAA compliance status, FDA regulatory findings, audit trail verification, data privacy assessment, and evidence (compliance check results, audit logs, privacy controls). OWNER APPROVAL REQUIRED for compliance rule changes.',
    construction_estimating: 'Construction estimating report with: cost estimation engine design, material takeoff algorithms, labor calculation specs, and evidence (estimation configs, takeoff formulas, labor rate tables).',
    construction_engineering: 'Construction engineering report with: structural analysis design, engineering calculation specs, design verification procedures, and evidence (analysis configs, calculation formulas, verification checklists).',
    construction_permitting: 'Construction permitting report with: permit tracking system design, code compliance configs, regulatory submission workflows, and evidence (permit configs, code references, submission templates).',
    construction_scheduling: 'Construction scheduling report with: project scheduling design, critical path analysis, resource leveling algorithms, and evidence (scheduling configs, CPM diagrams, resource allocation data).',
    construction_cost: 'Construction cost control report with: budget tracking design, cost variance analysis, change order management specs, and evidence (budget configs, variance formulas, change order workflows).',
    finance_analytics: 'Finance analytics report with: investment analytics engine design, portfolio tracking specs, benchmarking algorithms, performance attribution models, and evidence (analytics configs, portfolio data, benchmark results).',
    finance_portfolio: 'Finance portfolio report with: portfolio optimization design, asset allocation models, rebalancing recommendations, and evidence (optimization configs, allocation matrices, rebalancing thresholds). CANNOT execute trades without owner approval.',
    finance_risk: 'Finance risk report with: risk analysis design, VaR calculation specs, stress test scenarios, risk model configs, and evidence (risk configs, VaR calculations, stress test results).',
    finance_reporting: 'Finance reporting report with: financial reporting system design, regulatory report templates, investor statement formats, and evidence (report templates, regulatory formats, statement samples).',
    finance_cashflow: 'Finance cash flow report with: cash flow analysis design, projection models, liquidity management specs, treasury optimization configs, and evidence (cash flow models, projection data, liquidity metrics).',
    legal_contract: 'Legal contract report with: contract analysis engine design, clause extraction specs, risk identification models, contract generation templates, and evidence (analysis configs, clause taxonomies, risk models). CANNOT generate legal documents without owner approval.',
    legal_compliance: 'Legal compliance report with: regulatory compliance monitoring design, obligation tracking specs, policy management configs, and evidence (compliance configs, obligation records, policy definitions).',
    legal_documents: 'Legal document automation report with: document automation design, template management specs, document assembly workflows, and evidence (automation configs, template paths, assembly definitions). CANNOT generate legal documents without owner approval.',
    legal_workflow: 'Legal workflow report with: workflow automation design, matter management specs, deadline tracking configs, and evidence (workflow configs, matter schemas, deadline rules).',
    marketing_seo: 'SEO automation report with: platform design, keyword research algorithms, rank tracking specs, content optimization configs, and evidence (SEO configs, keyword data, ranking reports).',
    marketing_social: 'Social media automation report with: platform design, content scheduling algorithms, engagement analytics specs, and evidence (automation configs, scheduling rules, analytics definitions).',
    marketing_video: 'Video automation report with: platform design, content generation specs, video editing configs, distribution channel settings, and evidence (video configs, editing parameters, distribution logs).',
    marketing_campaign: 'Campaign management report with: platform design, A/B testing specs, attribution modeling, ROI analysis configs, and evidence (campaign configs, test results, attribution data). CANNOT launch campaigns without owner approval.',
    marketing_analytics: 'Marketing analytics report with: platform design, funnel analysis specs, customer journey mapping, conversion optimization configs, and evidence (analytics configs, funnel data, journey maps).',
    research_ai: 'AI research report with: latest AI developments, technology rankings by business impact, framework evaluations, and evidence (paper citations, framework benchmarks, technique analyses).',
    research_quantum: 'Quantum computing research report with: advance monitoring, business implication assessment, technology evaluation, and evidence (research citations, evaluation data, implication analysis).',
    research_robotics: 'Robotics research report with: advance monitoring, automation opportunity assessment, technology evaluation, and evidence (research citations, opportunity data, evaluation results).',
    research_biotech: 'Biotech research report with: advance monitoring, healthcare implication assessment, technology evaluation, and evidence (research citations, implication data, evaluation results).',
    research_materials: 'Materials science research report with: advance monitoring, manufacturing implication assessment, technology evaluation, and evidence (research citations, implication data, evaluation results).',
    research_patent: 'Patent monitoring report with: recent filings, IP opportunity identification, competitive landscape mapping, and evidence (patent IDs, IP analysis, competitive data).',
    research_competitive: 'Competitive intelligence report with: competitor monitoring, market shift analysis, technology trends, strategic implications, and evidence (competitor data, market analysis, trend citations).',
    research_prototype: 'Prototype development report with: research finding evaluation, proof-of-concept design, prototype build plan, feasibility assessment, and evidence (evaluation results, POC specs, feasibility data). CANNOT deploy prototypes without owner approval.',
    automation_api: 'API integration report with: platform design, connector library specs, data synchronization configs, and evidence (integration configs, connector definitions, sync logs).',
    automation_workflow: 'Workflow automation report with: engine design, trigger rule specs, action chain configs, process orchestration parameters, and evidence (workflow configs, trigger definitions, action logs).',
    automation_process: 'Enterprise process report with: process automation design, BPM configs, process mining specs, optimization parameters, and evidence (process configs, BPM definitions, mining results).',
    automation_tools: 'Internal tools report with: tools development specs, admin panel designs, operational dashboard configs, and evidence (tool configs, panel designs, dashboard definitions).',
    education_course: 'Education course report with: course builder design, curriculum specs, content management configs, learning path definitions, and evidence (course configs, curriculum outlines, path definitions).',
    education_knowledge: 'Knowledge base report with: platform design, documentation specs, search configs, content organization parameters, and evidence (KB configs, doc paths, search indexes).',
    education_tutor: 'AI tutor report with: tutor design, personalized learning specs, adaptive assessment configs, progress tracking parameters, and evidence (tutor configs, learning paths, assessment results).',
    enterprise_bi: 'Enterprise BI report with: dashboard specs, KPI analytics configs, forecasting parameters, resource planning inputs, and evidence (BI configs, KPI definitions, forecast data).',
  };

  sections.push(
    `# OUTPUTS REQUIRED\n` +
    outputMap[category],
  );

  // Section 4: Data Sources & Tools (unique per category)
  const toolsByCategory: Record<RoleCategory, { allowed: string[]; prohibited: string[] }> = {
    mobile: { allowed: ['read_source_code', 'read_expo_config', 'read_app_store_metadata', 'run_maestro_tests', 'audit_components'], prohibited: ['deploy_to_app_store', 'deploy_to_play_store', 'change_signing_keys', 'modify_production_app'] },
    web: { allowed: ['read_web_source', 'run_playwright_tests', 'audit_seo', 'read_analytics'], prohibited: ['publish_landing_page', 'modify_public_site', 'deploy_web_app'] },
    backend: { allowed: ['read_api_routes', 'read_openapi', 'audit_endpoints', 'read_error_logs'], prohibited: ['delete_route', 'change_auth_middleware', 'deploy_backend'] },
    database: { allowed: ['read_schema', 'read_query_plans', 'analyze_indexes', 'read_rls_policies'], prohibited: ['drop_table', 'truncate_data', 'modify_production_schema', 'delete_data'] },
    ai_chat: { allowed: ['read_ai_configs', 'read_conversation_logs', 'audit_prompts', 'check_provider_health'], prohibited: ['change_ai_provider', 'modify_conversation_brain', 'deploy_ai_changes'] },
    owner_ai: { allowed: ['read_owner_auth_logs', 'audit_owner_ai', 'read_security_logs'], prohibited: ['modify_owner_auth', 'change_owner_ai_behavior', 'deploy_owner_changes'] },
    dashboard: { allowed: ['read_dashboard_configs', 'read_data_sources', 'audit_kpi_accuracy'], prohibited: ['change_dashboard_layout', 'modify_executive_views', 'deploy_dashboard'] },
    investor: { allowed: ['read_investor_crm', 'read_pipeline_data', 'read_communication_logs', 'draft_follow_ups'], prohibited: ['approve_investor', 'reject_investor', 'share_financial_data', 'delete_crm_records'] },
    buyer: { allowed: ['read_buyer_crm', 'read_buyer_offers', 'read_property_listings', 'draft_recommendations'], prohibited: ['accept_offer', 'reject_offer', 'delete_buyer_records'] },
    crm: { allowed: ['read_crm_records', 'read_pipeline_stages', 'audit_automation_rules'], prohibited: ['delete_crm_records', 'modify_pipeline_stages', 'deploy_crm_changes'] },
    tokenization: { allowed: ['read_tokenization_configs', 'read_compliance_records', 'audit_audit_trail'], prohibited: ['deploy_smart_contract', 'modify_tokenization_rules', 'mint_tokens'] },
    property: { allowed: ['read_property_listings', 'read_market_data', 'audit_valuations'], prohibited: ['delete_property', 'modify_valuation', 'deploy_property_changes'] },
    deals: { allowed: ['read_deal_data', 'read_financials', 'read_pool_tiers', 'audit_risk_scores'], prohibited: ['close_deal', 'modify_financials', 'change_pool_tiers', 'deploy_deal_changes'] },
    marketing: { allowed: ['read_marketing_data', 'read_engagement_metrics', 'read_seo_rankings', 'draft_campaigns'], prohibited: ['launch_campaign', 'send_outreach', 'publish_content'] },
    analytics: { allowed: ['read_analytics_configs', 'read_metric_definitions', 'audit_visualizations'], prohibited: ['modify_analytics_pipeline', 'deploy_analytics_changes'] },
    qa: { allowed: ['run_tests', 'read_test_results', 'read_coverage_reports', 'audit_quality_gates'], prohibited: ['delete_test_data', 'modify_test_suite', 'deploy_to_production'] },
    security: { allowed: ['run_security_scans', 'read_auth_logs', 'read_dependency_advisories', 'audit_vulnerabilities'], prohibited: ['rotate_secrets', 'revoke_tokens', 'modify_auth_gates', 'deploy_security_changes'] },
    compliance: { allowed: ['read_compliance_records', 'read_kyc_aml', 'read_audit_logs', 'audit_compliance'], prohibited: ['modify_compliance_rules', 'delete_audit_logs', 'deploy_compliance_changes'] },
    cloud: { allowed: ['read_cloud_configs', 'read_render_service', 'read_aws_resources', 'read_supabase_configs'], prohibited: ['modify_infrastructure', 'change_scaling_rules', 'provision_resources', 'deploy_infra_changes'] },
    devops: { allowed: ['read_ci_cd_configs', 'read_dockerfiles', 'read_deployment_logs', 'audit_environments'], prohibited: ['rollback_production', 'force_deploy', 'modify_ci_cd_pipeline', 'deploy_pipeline_changes'] },
    deployment: { allowed: ['read_deployment_configs', 'read_health_checks', 'read_github_render_sync', 'audit_deployment_risks'], prohibited: ['rollback_production', 'force_deploy', 'disable_health_checks', 'deploy_without_approval'] },
    monitoring: { allowed: ['read_monitoring_configs', 'read_alert_rules', 'read_uptime_stats', 'read_logs'], prohibited: ['modify_alert_rules', 'delete_logs', 'deploy_monitoring_changes'] },
    documentation: { allowed: ['read_docs', 'read_runbooks', 'read_changelogs', 'generate_documentation'], prohibited: ['delete_documentation', 'remove_runbook', 'deploy_doc_changes'] },
    support: { allowed: ['read_support_tickets', 'read_feedback', 'read_automation_configs'], prohibited: ['close_support_tickets', 'modify_support_workflows', 'deploy_support_changes'] },
    performance: { allowed: ['run_profiling', 'read_latency_metrics', 'read_bundle_sizes', 'read_resource_utilization'], prohibited: ['modify_infrastructure', 'change_scaling_rules', 'deploy_perf_changes'] },
    autonomous_ops: { allowed: ['read_scheduler_state', 'read_engine_logs', 'read_task_queues', 'audit_autonomous_health'], prohibited: ['stop_autonomous_system', 'modify_scheduler_config', 'deploy_autonomous_changes'] },
    orchestrator: { allowed: ['read_task_queue', 'read_workload_distribution', 'read_duplicate_logs', 'read_escalation_records'], prohibited: ['cancel_tasks', 'modify_orchestrator_config', 'deploy_orchestrator_changes'] },
    executive: { allowed: ['read_company_scorecards', 'read_agent_performance', 'read_engineering_kpis', 'read_capital_reports', 'generate_executive_reports'], prohibited: ['modify_report_format', 'rewrite_failed_results', 'deploy_report_changes'] },
    saas_product: { allowed: ['read_market_research', 'read_competitor_data', 'draft_roadmaps', 'draft_user_stories'], prohibited: ['deploy_to_production', 'modify_database_schema'] },
    saas_backend: { allowed: ['write_backend_code', 'design_api', 'design_database_schema', 'write_server_logic'], prohibited: ['deploy_to_production', 'modify_database_schema_in_prod'] },
    saas_frontend: { allowed: ['write_frontend_code', 'create_components', 'design_ui'], prohibited: ['publish_frontend', 'change_design_system', 'deploy_frontend'] },
    saas_mobile: { allowed: ['write_mobile_code', 'configure_expo', 'prepare_app_store_metadata'], prohibited: ['publish_to_app_store', 'change_app_signing', 'deploy_mobile'] },
    saas_ai: { allowed: ['write_ai_integration_code', 'design_chat_features', 'configure_embeddings', 'design_rag_pipeline'], prohibited: ['change_ai_provider', 'deploy_ai_changes'] },
    saas_qa: { allowed: ['run_tests', 'read_test_results', 'audit_coverage', 'detect_regressions'], prohibited: ['delete_test_data', 'modify_test_suite', 'deploy_to_production'] },
    saas_security: { allowed: ['run_security_scans', 'audit_auth', 'scan_secrets', 'read_vulnerabilities'], prohibited: ['rotate_secrets', 'modify_auth', 'deploy_security_changes'] },
    saas_devops: { allowed: ['design_ci_cd', 'write_dockerfiles', 'configure_environments'], prohibited: ['deploy_to_production', 'modify_infrastructure', 'deploy_pipeline'] },
    saas_deployment: { allowed: ['read_deployment_configs', 'design_deployment_strategy', 'plan_health_checks'], prohibited: ['rollback_production', 'force_deploy', 'deploy_without_approval'] },
    saas_docs: { allowed: ['write_documentation', 'create_api_docs', 'write_user_guides'], prohibited: ['delete_documentation', 'deploy_doc_changes'] },
    healthcare_product: { allowed: ['read_healthcare_regulations', 'read_market_research', 'draft_roadmaps'], prohibited: ['deploy_to_production', 'modify_clinical_data'] },
    healthcare_workflow: { allowed: ['write_workflow_code', 'design_scheduling', 'design_care_coordination'], prohibited: ['deploy_to_production', 'modify_clinical_workflows'] },
    healthcare_automation: { allowed: ['write_automation_code', 'design_claims_processing', 'design_billing_automation'], prohibited: ['deploy_to_production', 'modify_billing_logic'] },
    healthcare_scheduling: { allowed: ['write_scheduling_code', 'design_resource_allocation', 'optimize_calendars'], prohibited: ['modify_scheduling_rules', 'deploy_to_production'] },
    healthcare_compliance: { allowed: ['audit_hipaa', 'read_audit_trails', 'check_data_privacy'], prohibited: ['modify_compliance_rules', 'delete_audit_logs', 'deploy_compliance_changes'] },
    construction_estimating: { allowed: ['write_estimating_code', 'design_takeoff_algorithms', 'calculate_labor'], prohibited: ['modify_estimation_algorithms', 'deploy_to_production'] },
    construction_engineering: { allowed: ['write_engineering_code', 'design_structural_analysis', 'verify_designs'], prohibited: ['modify_engineering_calculations', 'deploy_to_production'] },
    construction_permitting: { allowed: ['write_permitting_code', 'design_code_compliance', 'create_submission_workflows'], prohibited: ['submit_permits', 'modify_compliance_rules', 'deploy_to_production'] },
    construction_scheduling: { allowed: ['write_scheduling_code', 'design_critical_path', 'level_resources'], prohibited: ['modify_scheduling_algorithms', 'deploy_to_production'] },
    construction_cost: { allowed: ['write_cost_control_code', 'track_budgets', 'analyze_variances'], prohibited: ['modify_budget_calculations', 'deploy_to_production'] },
    finance_analytics: { allowed: ['write_analytics_code', 'design_portfolio_tracking', 'benchmark_performance'], prohibited: ['modify_analytics_algorithms', 'deploy_to_production'] },
    finance_portfolio: { allowed: ['write_optimization_code', 'design_asset_allocation', 'recommend_rebalancing'], prohibited: ['execute_trades', 'modify_optimization_algorithms', 'deploy_to_production'] },
    finance_risk: { allowed: ['write_risk_code', 'calculate_var', 'design_stress_tests'], prohibited: ['modify_risk_models', 'change_risk_parameters', 'deploy_to_production'] },
    finance_reporting: { allowed: ['write_reporting_code', 'design_regulatory_reports', 'format_investor_statements'], prohibited: ['publish_reports', 'modify_report_templates', 'deploy_to_production'] },
    finance_cashflow: { allowed: ['write_cashflow_code', 'design_projections', 'manage_liquidity'], prohibited: ['modify_cash_flow_models', 'deploy_to_production'] },
    legal_contract: { allowed: ['write_contract_analysis_code', 'extract_clauses', 'identify_risks'], prohibited: ['generate_legal_documents', 'modify_contract_templates', 'deploy_to_production'] },
    legal_compliance: { allowed: ['write_compliance_code', 'track_obligations', 'manage_policies'], prohibited: ['modify_compliance_rules', 'delete_compliance_records', 'deploy_to_production'] },
    legal_documents: { allowed: ['write_document_automation_code', 'manage_templates', 'assemble_documents'], prohibited: ['generate_legal_documents', 'modify_templates', 'deploy_to_production'] },
    legal_workflow: { allowed: ['write_workflow_code', 'manage_matters', 'track_deadlines'], prohibited: ['modify_workflow_rules', 'deploy_to_production'] },
    marketing_seo: { allowed: ['write_seo_code', 'research_keywords', 'track_rankings', 'optimize_content'], prohibited: ['publish_content', 'modify_seo_config', 'deploy_to_production'] },
    marketing_social: { allowed: ['write_social_code', 'schedule_content', 'analyze_engagement'], prohibited: ['publish_social_posts', 'modify_scheduling_rules', 'deploy_to_production'] },
    marketing_video: { allowed: ['write_video_code', 'generate_content', 'edit_video', 'configure_distribution'], prohibited: ['publish_videos', 'modify_video_templates', 'deploy_to_production'] },
    marketing_campaign: { allowed: ['write_campaign_code', 'design_ab_tests', 'model_attribution', 'analyze_roi'], prohibited: ['launch_campaigns', 'modify_attribution_models', 'deploy_to_production'] },
    marketing_analytics: { allowed: ['write_analytics_code', 'analyze_funnels', 'map_customer_journeys', 'optimize_conversions'], prohibited: ['modify_analytics_models', 'deploy_to_production'] },
    research_ai: { allowed: ['read_research_papers', 'evaluate_frameworks', 'analyze_techniques', 'rank_technologies'], prohibited: ['deploy_to_production', 'modify_production_code'] },
    research_quantum: { allowed: ['read_quantum_research', 'evaluate_technology', 'assess_implications'], prohibited: ['deploy_to_production', 'modify_production_code'] },
    research_robotics: { allowed: ['read_robotics_research', 'evaluate_automation', 'assess_opportunities'], prohibited: ['deploy_to_production', 'modify_production_code'] },
    research_biotech: { allowed: ['read_biotech_research', 'evaluate_technology', 'assess_implications'], prohibited: ['deploy_to_production', 'modify_production_code'] },
    research_materials: { allowed: ['read_materials_research', 'evaluate_technology', 'assess_implications'], prohibited: ['deploy_to_production', 'modify_production_code'] },
    research_patent: { allowed: ['read_patent_filings', 'identify_ip_opportunities', 'map_competitive_landscape'], prohibited: ['deploy_to_production', 'modify_production_code'] },
    research_competitive: { allowed: ['read_competitor_data', 'analyze_markets', 'track_trends', 'strategic_analysis'], prohibited: ['deploy_to_production', 'modify_production_code'] },
    research_prototype: { allowed: ['write_prototype_code', 'build_poc', 'evaluate_feasibility'], prohibited: ['deploy_prototypes', 'deploy_to_production', 'modify_production_code'] },
    automation_api: { allowed: ['write_integration_code', 'build_connectors', 'design_sync'], prohibited: ['modify_integrations', 'deploy_to_production'] },
    automation_workflow: { allowed: ['write_workflow_code', 'design_triggers', 'build_action_chains'], prohibited: ['modify_workflow_rules', 'deploy_to_production'] },
    automation_process: { allowed: ['write_process_code', 'design_bpm', 'mine_processes', 'optimize'], prohibited: ['modify_process_definitions', 'deploy_to_production'] },
    automation_tools: { allowed: ['write_internal_tools', 'build_admin_panels', 'create_dashboards'], prohibited: ['deploy_internal_tools', 'deploy_to_production'] },
    education_course: { allowed: ['write_course_code', 'design_curriculum', 'manage_content', 'create_learning_paths'], prohibited: ['publish_courses', 'modify_curriculum', 'deploy_to_production'] },
    education_knowledge: { allowed: ['write_kb_code', 'organize_content', 'configure_search'], prohibited: ['modify_knowledge_base', 'delete_content', 'deploy_to_production'] },
    education_tutor: { allowed: ['write_tutor_code', 'design_personalized_learning', 'create_adaptive_assessments'], prohibited: ['modify_ai_tutor_behavior', 'change_assessment_algorithms', 'deploy_to_production'] },
    enterprise_bi: { allowed: ['write_bi_code', 'design_dashboards', 'calculate_kpis', 'forecast', 'plan_resources'], prohibited: ['modify_kpi_formulas', 'publish_dashboards', 'deploy_to_production'] },
  };

  const tools = toolsByCategory[category];

  sections.push(
    `# DATA SOURCES ALLOWED\n` +
    `You may access: ${agent.capabilities.join(', ')}.\n` +
    `Database reads permitted on tables relevant to your role within ${company.name}.\n` +
    `You ${canModify ? 'CAN' : 'CANNOT'} read IVX production code and infrastructure.\n` +
    `You ${buildsProducts ? 'CAN' : 'CANNOT'} build new software products.`,
  );

  sections.push(
    `# TOOLS ALLOWED\n` +
    tools.allowed.map((t) => `- ${t}`).join('\n'),
  );

  sections.push(
    `# ACTIONS PROHIBITED\n` +
    tools.prohibited.map((t) => `- ${t}`).join('\n') +
    `\n${agent.destructiveActions.length > 0 ? `\nDestructive actions requiring owner approval:\n${agent.destructiveActions.map((a) => `- ${a}`).join('\n')}` : ''}\n` +
    `${agent.division === 'B' ? '\nCRITICAL: You are a Division B agent. You CANNOT modify IVX Holdings production code, infrastructure, or data under any circumstances.\n' : ''}`,
  );

  // Section 5: Owner Approval Requirements (unique per risk level)
  const approvalRules: string[] = [];
  if (agent.priority === 'critical') {
    approvalRules.push('ALL actions require explicit owner approval before execution.');
    approvalRules.push('No action may be taken without a valid approval token from the owner.');
    approvalRules.push('If owner approval times out (30 minutes), the action is REJECTED, not auto-approved.');
  } else if (agent.riskLevel === 'high') {
    approvalRules.push('Destructive actions require explicit owner approval.');
    approvalRules.push('Read-only audits and analysis may proceed without approval.');
    approvalRules.push('Any code deployment or infrastructure change requires owner approval.');
    approvalRules.push('If owner approval times out (60 minutes), the action is ESCALATED.');
  } else if (agent.riskLevel === 'medium') {
    approvalRules.push('Only destructive actions listed in the prohibited section require owner approval.');
    approvalRules.push('Read-only operations and code drafting proceed without approval.');
    approvalRules.push('If owner approval times out (120 minutes), the action is ESCALATED.');
  } else {
    approvalRules.push('No owner approval required for read-only operations.');
    approvalRules.push('Destructive actions still require owner approval.');
    approvalRules.push('If owner approval times out (240 minutes), the action is ESCALATED.');
  }

  sections.push(
    `# OWNER APPROVAL REQUIREMENTS\n` +
    approvalRules.join('\n'),
  );

  // Section 6: Success Criteria (unique per category)
  const successMap: Record<RoleCategory, string> = {
    mobile: 'Success = audit report produced with at least 3 specific findings, each with file path evidence and recommended fix. No production changes made.',
    web: 'Success = web audit completed with performance metrics, SEO findings, and cross-browser results. No production changes made.',
    backend: 'Success = API audit completed with endpoint health, validation gaps, and performance metrics. No production changes made.',
    database: 'Success = database audit completed with index analysis, slow query identification, and migration safety assessment. No schema changes made without approval.',
    ai_chat: 'Success = AI chat audit completed with provider health, conversation quality, and prompt engineering findings. No AI config changes made.',
    owner_ai: 'Success = owner AI module audited with security findings and response quality assessment. NO CHANGES made without owner approval.',
    dashboard: 'Success = dashboard audit completed with data accuracy and UI responsiveness findings. No dashboard changes made.',
    investor: 'Success = investor pipeline reviewed with stalled applications flagged and follow-up recommendations. No investor data modified.',
    buyer: 'Success = buyer offers reviewed with unmatched buyers identified and deal recommendations. No offers accepted or rejected.',
    crm: 'Success = CRM audit completed with data quality findings and stale leads identified. No CRM records deleted.',
    tokenization: 'Success = tokenization audit completed with compliance checks and audit trail verification. No smart contracts deployed.',
    property: 'Success = property audit completed with listing completeness and valuation accuracy findings. No properties deleted.',
    deals: 'Success = deal audit completed with financial verification and risk flags. No deals closed or modified.',
    marketing: 'Success = marketing report produced with engagement metrics and growth recommendations. No campaigns launched.',
    analytics: 'Success = analytics audit completed with pipeline health and metric accuracy findings. No pipelines modified.',
    qa: 'Success = QA report produced with test results, coverage gaps, and regression risks. No test data deleted.',
    security: 'Success = security audit completed with vulnerabilities found and evidence. NO remediation without owner approval.',
    compliance: 'Success = compliance audit completed with KYC/AML verification and audit log completeness. No compliance rules modified.',
    cloud: 'Success = cloud audit completed with resource health and cost optimization findings. NO infrastructure changes without owner approval.',
    devops: 'Success = DevOps audit completed with CI/CD health and deployment risk findings. NO pipeline changes without owner approval.',
    deployment: 'Success = deployment readiness assessed with risk evaluation and rollback plan verification. NO deploys without owner approval.',
    monitoring: 'Success = monitoring audit completed with coverage assessment and alert configuration findings. No alert rules modified.',
    documentation: 'Success = documentation audit completed with coverage gaps and missing runbooks identified. No documentation deleted.',
    support: 'Success = support report produced with open issues and feedback trends. No tickets closed.',
    performance: 'Success = performance report produced with profiling results and bottleneck identification. No infrastructure changes.',
    autonomous_ops: 'Success = autonomous system health audited with scheduler and engine status. NO config changes without owner approval.',
    orchestrator: 'Success = orchestrator state reviewed with workload distribution and queue analysis. NO config changes without owner approval.',
    executive: 'Success = executive report produced with accurate scorecards and KPIs. FAILED RESULTS MUST NOT BE REWRITTEN AS SUCCESS.',
    saas_product: 'Success = product report with market analysis and roadmap. No production deploys.',
    saas_backend: 'Success = backend implementation designed with API specs and schema. No production deploys without owner approval.',
    saas_frontend: 'Success = frontend implementation with components and design system. No production deploys.',
    saas_mobile: 'Success = mobile app implementation with Expo configs. No app store submissions.',
    saas_ai: 'Success = AI integration designed with chat and RAG specs. No AI provider changes.',
    saas_qa: 'Success = QA report with coverage and regression findings. No test data deleted.',
    saas_security: 'Success = security audit with findings. No remediation without owner approval.',
    saas_devops: 'Success = DevOps design with CI/CD and infrastructure. No production deploys without owner approval.',
    saas_deployment: 'Success = deployment strategy designed. NO deploys without owner approval.',
    saas_docs: 'Success = documentation produced. No documentation deleted.',
    healthcare_product: 'Success = healthcare product report with regulatory requirements. No production deploys.',
    healthcare_workflow: 'Success = workflow automation designed. No production deploys without owner approval.',
    healthcare_automation: 'Success = automation code written. No production deploys without owner approval.',
    healthcare_scheduling: 'Success = scheduling system designed. No production deploys.',
    healthcare_compliance: 'Success = HIPAA compliance audited. NO compliance rule changes without owner approval.',
    construction_estimating: 'Success = estimating engine designed. No production deploys.',
    construction_engineering: 'Success = engineering analysis tools designed. No production deploys.',
    construction_permitting: 'Success = permit tracking system designed. No permits submitted.',
    construction_scheduling: 'Success = scheduling system designed. No production deploys.',
    construction_cost: 'Success = cost control system designed. No production deploys.',
    finance_analytics: 'Success = analytics engine designed. No production deploys.',
    finance_portfolio: 'Success = portfolio optimization designed. NO TRADES EXECUTED.',
    finance_risk: 'Success = risk analysis engine designed. No risk model changes without approval.',
    finance_reporting: 'Success = reporting system designed. No reports published.',
    finance_cashflow: 'Success = cash flow system designed. No production deploys.',
    legal_contract: 'Success = contract analysis engine designed. NO LEGAL DOCUMENTS GENERATED.',
    legal_compliance: 'Success = compliance monitoring designed. No compliance rules modified.',
    legal_documents: 'Success = document automation designed. NO LEGAL DOCUMENTS GENERATED.',
    legal_workflow: 'Success = workflow automation designed. No production deploys.',
    marketing_seo: 'Success = SEO platform designed. No content published.',
    marketing_social: 'Success = social media platform designed. No posts published.',
    marketing_video: 'Success = video platform designed. No videos published.',
    marketing_campaign: 'Success = campaign platform designed. NO CAMPAIGNS LAUNCHED.',
    marketing_analytics: 'Success = analytics platform designed. No production deploys.',
    research_ai: 'Success = research report with rankings and evidence. No production changes.',
    research_quantum: 'Success = quantum research report with implications. No production changes.',
    research_robotics: 'Success = robotics research report with opportunities. No production changes.',
    research_biotech: 'Success = biotech research report with implications. No production changes.',
    research_materials: 'Success = materials research report with implications. No production changes.',
    research_patent: 'Success = patent monitoring report with IP opportunities. No production changes.',
    research_competitive: 'Success = competitive intelligence report with strategic implications. No production changes.',
    research_prototype: 'Success = prototype evaluation with POC design. NO PROTOTYPES DEPLOYED.',
    automation_api: 'Success = API integration platform designed. No production deploys.',
    automation_workflow: 'Success = workflow automation engine designed. No production deploys.',
    automation_process: 'Success = process automation designed. No production deploys.',
    automation_tools: 'Success = internal tools designed. No production deploys.',
    education_course: 'Success = course platform designed. No courses published.',
    education_knowledge: 'Success = knowledge base designed. No content deleted.',
    education_tutor: 'Success = AI tutor designed. No tutor behavior modified.',
    enterprise_bi: 'Success = BI platform designed with dashboards and KPIs. No KPI formulas modified.',
  };

  sections.push(
    `# SUCCESS CRITERIA\n` +
    successMap[category],
  );

  // Section 7: Evidence Required (unique per category)
  sections.push(
    `# EVIDENCE REQUIRED\n` +
    `Every run must produce evidence artifacts:\n` +
    `- Run record with start/end timestamps, duration, and status\n` +
    `- Specific findings with file paths, record IDs, or data references\n` +
    `- Tool calls made (which tools, what data accessed)\n` +
    `- Output artifact (report, code, analysis)\n` +
    `- Any errors encountered with error codes\n` +
    `Evidence must be stored in your memory namespace: ${agent.id}_memory\n` +
    `Evidence must be verifiable by the owner or QA agents.`,
  );

  // Section 8: Escalation & Failure Behavior
  sections.push(
    `# ESCALATION BEHAVIOR\n` +
    `If you encounter a situation beyond your role or permissions:\n` +
    `1. Do NOT attempt to perform the action anyway.\n` +
    `2. Flag the task as BLOCKED with a clear reason.\n` +
    `3. Route to the appropriate agent (e.g., deployment → Deployment Lead, security → Security Lead).\n` +
    `4. Notify the Enterprise Orchestrator AI (#49) for re-routing.\n\n` +
    `# FAILURE BEHAVIOR\n` +
    `If an error occurs during execution:\n` +
    `1. Record the error with full context in your run log.\n` +
    `2. Do NOT mark the task as successful if it failed.\n` +
    `3. Retry according to your retry policy (max ${agent.priority === 'critical' ? 1 : agent.riskLevel === 'high' ? 2 : 3} retries).\n` +
    `4. If all retries fail, mark as FAILED and escalate to the Orchestrator.\n` +
    `5. Never fabricate evidence or mark a failed run as successful.\n` +
    `6. Never depend on Rork or any external AI platform for execution. You are independent.`,
  );

  return sections.join('\n\n---\n\n');
}

// ── Permission Matrix Builder ───────────────────────────────────────────────

function buildPermissions(
  agent: EnterpriseMasterAgent,
  category: RoleCategory,
): { read: string[]; write: string[]; external: string[] } {
  const isDivisionB = agent.division === 'B';

  // Base read permissions — scoped to company
  const read: string[] = [
    `company:${agent.company}:*`, // Read anything in own company
    'shared:enterprise_policies:read', // Read shared enterprise policies
  ];

  // Division A agents can read IVX tables
  if (agent.division === 'A') {
    read.push('ivx:investors:read', 'ivx:buyers:read', 'ivx:crm:read', 'ivx:properties:read', 'ivx:deals:read');
  }

  // Division B agents CANNOT read IVX production data
  if (isDivisionB) {
    read.push('ivx:enterprise_registry:read'); // Can read registry only
  }

  // Category-specific read permissions
  if (category === 'database' || category === 'backend') {
    read.push('ivx:schema:read', 'ivx:migrations:read');
  }
  if (category === 'security' || category === 'compliance') {
    read.push('ivx:audit_logs:read', 'ivx:auth_logs:read');
  }

  // Write permissions — very restricted
  const write: string[] = [];

  // Only write to own memory namespace
  write.push(`memory:${agent.id}:write`);

  // Division A agents with canModifyIVX can write to code (with approval)
  if (agent.canModifyIVX && !isDivisionB) {
    write.push('ivx:code:draft'); // Draft only, not deploy
  }

  // Division B agents can write to their own product repos
  if (buildsProducts(agent)) {
    write.push(`company:${agent.company}:code:write`);
  }

  // QA/security agents get test result writes
  if (category === 'qa' || category === 'saas_qa') {
    write.push('ivx:test_results:write', `company:${agent.company}:test_results:write`);
  }
  if (category === 'security' || category === 'saas_security') {
    write.push('ivx:security_scan_results:write');
  }

  // External service permissions
  const external: string[] = [];
  if (agent.division === 'A') {
    external.push('github:read:ivx-holdings-platform');
  }
  if (agent.capabilities.includes('ai_integration') || agent.capabilities.includes('ai_chat')) {
    external.push('ai_gateway:read'); // Can use AI gateway for inference
  }
  if (category === 'research_ai' || category.startsWith('research_')) {
    external.push('web_search:read'); // Can search the web
  }

  return { read, write, external };
}

function buildsProducts(agent: EnterpriseMasterAgent): boolean {
  return agent.buildsNewProducts;
}

// ── Owner Approval Rules Builder ────────────────────────────────────────────

function buildApprovalRules(agent: EnterpriseMasterAgent): OwnerApprovalRule[] {
  const rules: OwnerApprovalRule[] = [];

  // All destructive actions require approval
  for (const action of agent.destructiveActions) {
    rules.push({
      action,
      required: true,
      autoApproveLowRisk: false,
      timeoutMinutes: agent.priority === 'critical' ? 30 : agent.riskLevel === 'high' ? 60 : 120,
      timeoutAction: agent.priority === 'critical' ? 'reject' : 'escalate',
    });
  }

  // Production deployment always requires approval
  if (agent.canModifyIVX || agent.buildsNewProducts) {
    rules.push({
      action: 'deploy_to_production',
      required: true,
      autoApproveLowRisk: false,
      timeoutMinutes: 60,
      timeoutAction: 'reject',
    });
  }

  // Critical agents need approval for everything
  if (agent.priority === 'critical') {
    rules.push({
      action: 'any_execution',
      required: true,
      autoApproveLowRisk: false,
      timeoutMinutes: 30,
      timeoutAction: 'reject',
    });
  }

  return rules;
}

// ── Scheduler Config Builder ────────────────────────────────────────────────

function buildSchedulerConfig(agent: EnterpriseMasterAgent, category: RoleCategory): SchedulerConfig {
  // Monitoring and autonomous agents are scheduled
  const scheduledCategories: RoleCategory[] = ['monitoring', 'autonomous_ops', 'orchestrator', 'security', 'deployment', 'qa', 'performance', 'executive'];

  if (scheduledCategories.includes(category)) {
    const frequencies: Record<string, string> = {
      monitoring: '*/15 * * * *', // Every 15 min
      autonomous_ops: '*/30 * * * *', // Every 30 min
      orchestrator: '*/10 * * * *', // Every 10 min
      security: '0 * * * *', // Hourly
      deployment: '*/30 * * * *', // Every 30 min
      qa: '0 */4 * * *', // Every 4 hours
      performance: '0 */6 * * *', // Every 6 hours
      executive: '0 8 * * *', // Daily at 8am
    };
    return {
      mode: 'scheduled',
      frequency: frequencies[category] || '0 * * * *',
      timezone: 'America/Los_Angeles',
      lastRunAt: null,
      missedRunPolicy: 'catch_up',
    };
  }

  // Research agents are scheduled less frequently
  if (category.startsWith('research_')) {
    return {
      mode: 'scheduled',
      frequency: '0 9 * * 1', // Weekly on Monday at 9am
      timezone: 'America/Los_Angeles',
      lastRunAt: null,
      missedRunPolicy: 'skip',
    };
  }

  // All other agents are event-driven (respond to tasks)
  return {
    mode: 'event_driven',
    timezone: 'America/Los_Angeles',
    lastRunAt: null,
    missedRunPolicy: 'alert_owner',
  };
}

// ── Contract Generator ──────────────────────────────────────────────────────

function generateContract(agent: EnterpriseMasterAgent): AgentContract {
  const category = categorizeAgent(agent);
  const tools = buildPermissions(agent, category);
  const systemInstructions = generateSystemInstructions(agent, category);
  const company = ENTERPRISE_COMPANIES[agent.company];

  // Simple hash for instruction uniqueness verification
  const instructionHash = `${agent.agentNumber}-${category}-${agent.id}-${systemInstructions.length}`;

  return {
    agentId: agent.id,
    agentName: agent.name,
    agentNumber: agent.agentNumber,
    divisionId: agent.division,
    companyId: agent.company,
    roleName: agent.role,
    mission: agent.heartbeatGoal,
    systemInstructions,
    inputSchema: [
      { name: 'task_type', type: 'string', required: true, description: `Type of task to execute (must be in allowedTaskTypes for agent ${agent.agentNumber})` },
      { name: 'task_payload', type: 'object', required: true, description: 'Task-specific input data' },
      { name: 'requesting_agent_id', type: 'string', required: false, description: 'ID of agent requesting this task (for handoffs)' },
      { name: 'owner_approval_token', type: 'string', required: agent.priority === 'critical', description: 'Owner approval token if required' },
    ],
    outputSchema: [
      { name: 'status', type: 'string', required: true, description: 'success | failure | blocked | pending_approval' },
      { name: 'output', type: 'object', required: true, description: 'Task output artifact' },
      { name: 'evidence', type: 'array', required: true, description: 'Evidence artifacts proving the run was real' },
      { name: 'error', type: 'string', required: false, description: 'Error message if status is failure' },
      { name: 'tools_used', type: 'array', required: true, description: 'List of tools accessed during execution' },
    ],
    allowedTaskTypes: [...agent.capabilities, 'audit', 'heartbeat', 'health_check'],
    prohibitedTaskTypes: [...agent.destructiveActions, 'deploy_to_production', 'modify_production_schema', 'delete_data', 'rotate_secrets', 'revoke_tokens'],
    allowedTools: agent.capabilities,
    prohibitedTools: [...agent.destructiveActions, 'deploy_to_production', 'modify_production_schema', 'delete_data', 'rotate_secrets', 'revoke_tokens', 'drop_table', 'truncate_data', 'disable_health_checks', 'deploy_without_approval', 'execute_trades', 'generate_legal_documents', 'launch_campaigns', 'publish_to_app_store', 'force_deploy', 'rollback_production', 'stop_autonomous_system'],
    readPermissions: tools.read,
    writePermissions: tools.write,
    externalServicePermissions: tools.external,
    ownerApprovalRules: buildApprovalRules(agent),
    memoryNamespace: `${agent.id}_memory`,
    queueNamespace: `${agent.id}_queue`,
    schedulerConfig: buildSchedulerConfig(agent, category),
    concurrencyLimit: agent.priority === 'critical' ? 1 : agent.riskLevel === 'high' ? 2 : 3,
    costLimit: {
      maxCostPerRun: agent.priority === 'critical' ? 0.50 : agent.riskLevel === 'high' ? 1.00 : 2.00,
      maxCostPerDay: agent.priority === 'critical' ? 2.00 : 5.00,
      maxCostPerMonth: 50.00,
      currency: 'USD',
    },
    retryPolicy: {
      maxRetries: agent.priority === 'critical' ? 1 : agent.riskLevel === 'high' ? 2 : 3,
      backoffStrategy: 'exponential',
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      retryableErrors: ['timeout', 'rate_limit', 'temporary_failure', 'database_timeout'],
    },
    timeoutPolicy: {
      executionTimeoutMs: agent.priority === 'critical' ? 60000 : 120000,
      toolCallTimeoutMs: 30000,
      approvalTimeoutMs: agent.priority === 'critical' ? 1800000 : 3600000,
    },
    evidenceRequirements: [
      { type: 'run_record', required: true, description: 'Permanent run record with timestamps and status' },
      { type: 'findings', required: true, description: 'Specific findings with data references' },
      { type: 'tool_calls', required: true, description: 'Log of all tools accessed' },
      { type: 'output_artifact', required: true, description: 'Report, code, or analysis produced' },
    ],
    status: 'active',
    version: 1,
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: '2026-07-27T00:00:00Z',
    instructionHash,
  };
}

// ── Generate All 100 Contracts ──────────────────────────────────────────────

export const ALL_AGENT_CONTRACTS: AgentContract[] = ALL_ENTERPRISE_AGENTS.map(generateContract);

export const AGENT_CONTRACT_REGISTRY: Record<string, AgentContract> = Object.fromEntries(
  ALL_AGENT_CONTRACTS.map((c) => [c.agentId, c]),
);

// ── Lookup Functions ────────────────────────────────────────────────────────

export function getContractByAgentId(agentId: string): AgentContract | null {
  return AGENT_CONTRACT_REGISTRY[agentId] ?? null;
}

export function getContractByAgentNumber(num: number): AgentContract | null {
  return ALL_AGENT_CONTRACTS.find((c) => c.agentNumber === num) ?? null;
}

export function getContractsByDivision(division: DivisionId): AgentContract[] {
  return ALL_AGENT_CONTRACTS.filter((c) => c.divisionId === division);
}

export function getContractsByCompany(company: CompanyId): AgentContract[] {
  return ALL_AGENT_CONTRACTS.filter((c) => c.companyId === company);
}

// ── Instruction Uniqueness Audit ────────────────────────────────────────────

export function auditInstructionUniqueness(): {
  totalAgents: number;
  uniqueInstructions: number;
  exactDuplicates: number;
  nameOnlyChanged: number;
  duplicatePairs: Array<{ agentA: number; agentB: number; similarity: number }>;
  instructionHashes: Array<{ agentNumber: number; hash: string; length: number }>;
} {
  const instructions = ALL_AGENT_CONTRACTS.map((c) => ({
    agentNumber: c.agentNumber,
    text: c.systemInstructions,
    hash: c.instructionHash,
    length: c.systemInstructions.length,
  }));

  const hashes = instructions.map((i) => i.hash);
  const uniqueHashes = new Set(hashes);
  const exactDuplicates = hashes.length - uniqueHashes.size;

  // Check for name-only-changed (same text except for the agent name)
  let nameOnlyChanged = 0;
  const duplicatePairs: Array<{ agentA: number; agentB: number; similarity: number }> = [];

  for (let i = 0; i < instructions.length; i++) {
    for (let j = i + 1; j < instructions.length; j++) {
      const a = instructions[i].text;
      const b = instructions[j].text;
      // Normalize by removing agent-specific identifiers
      const aNorm = a.replace(/agent #\d+/g, 'agent #X').replace(/Agent \d+/g, 'Agent X');
      const bNorm = b.replace(/agent #\d+/g, 'agent #X').replace(/Agent \d+/g, 'Agent X');

      if (aNorm === bNorm) {
        nameOnlyChanged++;
        duplicatePairs.push({ agentA: instructions[i].agentNumber, agentB: instructions[j].agentNumber, similarity: 1.0 });
      } else {
        // Jaccard similarity on words
        const wordsA = new Set(aNorm.toLowerCase().split(/\s+/));
        const wordsB = new Set(bNorm.toLowerCase().split(/\s+/));
        const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
        const union = new Set([...wordsA, ...wordsB]);
        const similarity = intersection.size / union.size;
        if (similarity > 0.95) {
          duplicatePairs.push({ agentA: instructions[i].agentNumber, agentB: instructions[j].agentNumber, similarity });
        }
      }
    }
  }

  return {
    totalAgents: ALL_AGENT_CONTRACTS.length,
    uniqueInstructions: uniqueHashes.size,
    exactDuplicates,
    nameOnlyChanged,
    duplicatePairs: duplicatePairs.slice(0, 10),
    instructionHashes: instructions,
  };
}

// ── Contract Validation ─────────────────────────────────────────────────────

export function validateAllContracts(): {
  valid: boolean;
  totalContracts: number;
  issues: string[];
  summary: {
    activeAgents: number;
    pausedAgents: number;
    disabledAgents: number;
    divisionA: number;
    divisionB: number;
    scheduledAgents: number;
    eventDrivenAgents: number;
    manualAgents: number;
    unrestrictedAgents: number;
    divisionBWithIVXAccess: number;
  };
} {
  const issues: string[] = [];

  if (ALL_AGENT_CONTRACTS.length !== 100) {
    issues.push(`Expected 100 contracts, found ${ALL_AGENT_CONTRACTS.length}`);
  }

  const numbers = ALL_AGENT_CONTRACTS.map((c) => c.agentNumber);
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) {
      issues.push(`Agent number gap/duplicate at position ${i + 1}: found ${numbers[i]}`);
      break;
    }
  }

  for (const contract of ALL_AGENT_CONTRACTS) {
    if (!contract.agentId) issues.push(`Agent ${contract.agentNumber}: missing agentId`);
    if (!contract.agentName) issues.push(`Agent ${contract.agentNumber}: missing name`);
    if (!contract.systemInstructions || contract.systemInstructions.length < 200) {
      issues.push(`Agent ${contract.agentNumber}: system instructions too short (${contract.systemInstructions?.length || 0} chars)`);
    }
    if (!contract.memoryNamespace) issues.push(`Agent ${contract.agentNumber}: missing memoryNamespace`);
    if (!contract.queueNamespace) issues.push(`Agent ${contract.agentNumber}: missing queueNamespace`);
    if (contract.allowedTools.length === 0) issues.push(`Agent ${contract.agentNumber}: no allowed tools`);
    if (contract.readPermissions.length === 0) issues.push(`Agent ${contract.agentNumber}: no read permissions`);

    // Division B agents must NOT have IVX write access
    if (contract.divisionId === 'B') {
      const hasIVXWrite = contract.writePermissions.some((p) => p.startsWith('ivx:') && p.includes('write') && !p.includes('memory'));
      if (hasIVXWrite) {
        issues.push(`Agent ${contract.agentNumber} (${contract.agentName}): Division B agent has IVX write access — SECURITY VIOLATION`);
      }
    }

    // Unrestricted agents (no prohibited tools)
    if (contract.prohibitedTools.length === 0 && contract.prohibitedTaskTypes.length === 0) {
      issues.push(`Agent ${contract.agentNumber}: no prohibited tools — unrestricted agent`);
    }
  }

  const divisionA = getContractsByDivision('A');
  const divisionB = getContractsByDivision('B');
  const scheduled = ALL_AGENT_CONTRACTS.filter((c) => c.schedulerConfig.mode === 'scheduled');
  const eventDriven = ALL_AGENT_CONTRACTS.filter((c) => c.schedulerConfig.mode === 'event_driven');
  const manual = ALL_AGENT_CONTRACTS.filter((c) => c.schedulerConfig.mode === 'manual');
  const divisionBWithIVX = ALL_AGENT_CONTRACTS.filter(
    (c) => c.divisionId === 'B' && c.writePermissions.some((p) => p.startsWith('ivx:') && p.includes('write') && !p.includes('memory')),
  );

  return {
    valid: issues.length === 0,
    totalContracts: ALL_AGENT_CONTRACTS.length,
    issues,
    summary: {
      activeAgents: ALL_AGENT_CONTRACTS.filter((c) => c.status === 'active').length,
      pausedAgents: ALL_AGENT_CONTRACTS.filter((c) => c.status === 'paused').length,
      disabledAgents: ALL_AGENT_CONTRACTS.filter((c) => c.status === 'disabled').length,
      divisionA: divisionA.length,
      divisionB: divisionB.length,
      scheduledAgents: scheduled.length,
      eventDrivenAgents: eventDriven.length,
      manualAgents: manual.length,
      unrestrictedAgents: ALL_AGENT_CONTRACTS.filter((c) => c.prohibitedTools.length === 0).length,
      divisionBWithIVXAccess: divisionBWithIVX.length,
    },
  };
}

// ── Agent Differentiation Test ──────────────────────────────────────────────

export type DifferentiationTestResult = {
  agentId: string;
  agentNumber: number;
  agentName: string;
  taskType: string;
  accepted: boolean;
  reason: string;
};

export function testAgentDifferentiation(taskType: string): DifferentiationTestResult[] {
  return ALL_AGENT_CONTRACTS.map((contract) => {
    const isAllowed = contract.allowedTaskTypes.some(
      (t) => t.toLowerCase().includes(taskType.toLowerCase()) || taskType.toLowerCase().includes(t.toLowerCase()),
    );
    const isProhibited = contract.prohibitedTaskTypes.some(
      (t) => t.toLowerCase().includes(taskType.toLowerCase()) || taskType.toLowerCase().includes(t.toLowerCase()),
    );

    let accepted = false;
    let reason = '';

    if (isProhibited) {
      accepted = false;
      reason = `Task type "${taskType}" is in prohibited list for this agent`;
    } else if (isAllowed) {
      accepted = true;
      reason = `Task type "${taskType}" matches agent capabilities`;
    } else {
      accepted = false;
      reason = `Task type "${taskType}" is not in agent's allowed capabilities — wrong agent for this task`;
    }

    return {
      agentId: contract.agentId,
      agentNumber: contract.agentNumber,
      agentName: contract.agentName,
      taskType,
      accepted,
      reason,
    };
  });
}
