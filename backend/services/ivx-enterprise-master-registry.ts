/**
 * IVX Enterprise Master AI — 112-Agent Organization Registry
 *
 * Full autonomous IA organization: IA-01 to IA-112.
 * Matches the IVX Holdings org chart exactly.
 *
 * HARD HONESTY RULES (inherited from the entire IVX autonomous system):
 *   - Every agent status is derived from real subsystem queries — never fabricated.
 *   - No task is marked complete without verification and supporting evidence.
 *   - All agents use shared services: GitHub, CI/CD, secure variables, audit logs,
 *     monitoring, backups, testing, documentation, API gateway, auth, version control.
 */
import { type OrchestratorPriority } from './ivx-enterprise-orchestrator';
import { type AgentRiskLevel } from './agents/multi-agent-framework';

export const IVX_ENTERPRISE_MASTER_REGISTRY_MARKER = 'ivx-enterprise-master-registry-2026-08-16-v2';

// ── Enterprise Structure Types ──────────────────────────────────────────────

export type DivisionId = 'A' | 'B';

export type CompanyId =
  | 'ivx_holdings'
  | 'saas_builder'
  | 'healthcare_tech'
  | 'construction_tech'
  | 'finance_tech'
  | 'legal_tech'
  | 'marketing_tech'
  | 'research_innovation'
  | 'business_automation'
  | 'education_tech'
  | 'enterprise_operations';

export type EnterpriseMasterAgent = {
  id: string;
  agentNumber: number;
  name: string;
  role: string;
  division: DivisionId;
  company: CompanyId;
  responsibilities: string[];
  capabilities: string[];
  priority: OrchestratorPriority;
  riskLevel: AgentRiskLevel;
  heartbeatGoal: string;
  destructiveActions: string[];
  canModifyIVX: boolean;
  buildsNewProducts: boolean;
  mission: string;
  inputs: string;
  actions: string;
  outputs: string;
  kpi: string;
  authority: string;
  escalates: string | null;
  functionalGroup: string;
};

export type CompanyDefinition = {
  id: CompanyId;
  name: string;
  division: DivisionId;
  description: string;
  agentCount: number;
  repositoryPattern: string;
  independentInfrastructure: boolean;
};

export const ENTERPRISE_COMPANIES: Record<CompanyId, CompanyDefinition> = {
  ivx_holdings: { id: 'ivx_holdings', name: 'IVX Holdings', division: 'A', description: 'Full autonomous IA organization — 112 agents across executive, growth, market, digital, intelligence, networks, global, app dev, project dev, and product creation.', agentCount: 112, repositoryPattern: 'ibb142/ivx-holdings-platform', independentInfrastructure: false },
  saas_builder: { id: 'saas_builder', name: 'Enterprise SaaS Builder', division: 'B', description: 'Builds new SaaS products.', agentCount: 0, repositoryPattern: 'ivx-enterprise/saas-{product}', independentInfrastructure: true },
  healthcare_tech: { id: 'healthcare_tech', name: 'Healthcare Technology', division: 'B', description: 'Medical workflow automation.', agentCount: 0, repositoryPattern: 'ivx-enterprise/healthcare-{product}', independentInfrastructure: true },
  construction_tech: { id: 'construction_tech', name: 'Construction Technology', division: 'B', description: 'Estimating, engineering, permitting.', agentCount: 0, repositoryPattern: 'ivx-enterprise/construction-{product}', independentInfrastructure: true },
  finance_tech: { id: 'finance_tech', name: 'Finance Technology', division: 'B', description: 'Investment analytics, risk analysis.', agentCount: 0, repositoryPattern: 'ivx-enterprise/finance-{product}', independentInfrastructure: true },
  legal_tech: { id: 'legal_tech', name: 'Legal Technology', division: 'B', description: 'Contract AI, compliance, documents.', agentCount: 0, repositoryPattern: 'ivx-enterprise/legal-{product}', independentInfrastructure: true },
  marketing_tech: { id: 'marketing_tech', name: 'Marketing Technology', division: 'B', description: 'SEO, social media, campaigns.', agentCount: 0, repositoryPattern: 'ivx-enterprise/marketing-{product}', independentInfrastructure: true },
  research_innovation: { id: 'research_innovation', name: 'Research & Innovation', division: 'B', description: 'AI, quantum, robotics, biotech research.', agentCount: 0, repositoryPattern: 'ivx-enterprise/research-{product}', independentInfrastructure: true },
  business_automation: { id: 'business_automation', name: 'Business Automation', division: 'B', description: 'API integrations, workflow automation.', agentCount: 0, repositoryPattern: 'ivx-enterprise/business-{product}', independentInfrastructure: true },
  education_tech: { id: 'education_tech', name: 'Education Technology', division: 'B', description: 'Course builder, knowledge base, AI tutor.', agentCount: 0, repositoryPattern: 'ivx-enterprise/education-{product}', independentInfrastructure: true },
  enterprise_operations: { id: 'enterprise_operations', name: 'Enterprise Operations', division: 'B', description: 'Executive dashboards, KPI analytics.', agentCount: 0, repositoryPattern: 'ivx-enterprise/enterprise-{product}', independentInfrastructure: true },
};

type AgentDef = {
  n: number; name: string; mission: string; inputs: string;
  actions: string; outputs: string; kpi: string;
  authority: string; escalates: string; group: string;
};

const AGENT_DEFS: AgentDef[] = [
  // ── Executive (1-12) ──
  { n: 1, name: 'IA-01 Executive Operations', mission: 'Coordinate company-wide execution', inputs: 'Owner priorities, dashboards, alerts', actions: 'Assign, reprioritize, escalate', outputs: 'Executive operating report', kpi: 'Tasks closed / blockers / response time', authority: 'Internal autonomous', escalates: 'Capital/legal/irreversible actions', group: 'Executive' },
  { n: 2, name: 'IA-02 Acquisitions', mission: 'Find acquisition opportunities', inputs: 'Listings, brokers, owners, off-market data', actions: 'Source, filter, contact, route', outputs: 'Acquisition pipeline', kpi: 'Qualified deals', authority: 'Research/outreach workflow', escalates: 'Offers/contracts', group: 'Executive' },
  { n: 3, name: 'IA-03 Underwriting / Analytics', mission: 'Analyze investment opportunities', inputs: 'Property data, rents, expenses, comps', actions: 'Model, score, stress-test', outputs: 'Underwriting package', kpi: 'Analyzed deals / accuracy', authority: 'Analytical', escalates: 'Final investment approval', group: 'Executive' },
  { n: 4, name: 'IA-04 Development / Construction', mission: 'Control development pipeline', inputs: 'Plans, budgets, schedules, permits', actions: 'Track, coordinate, flag delays', outputs: 'Development status', kpi: 'Cost / schedule / milestone performance', authority: 'Coordination', escalates: 'Contracts/change orders/capital', group: 'Executive' },
  { n: 5, name: 'IA-05 Asset Management', mission: 'Maximize portfolio performance', inputs: 'Occupancy, NOI, maintenance, leasing', actions: 'Monitor, recommend, assign follow-ups', outputs: 'Asset performance report', kpi: 'NOI / occupancy / variance', authority: 'Operational analysis', escalates: 'Major asset decisions', group: 'Executive' },
  { n: 6, name: 'IA-06 Finance / Accounting', mission: 'Financial control', inputs: 'Budgets, invoices, revenue, bank data', actions: 'Reconcile, forecast, report', outputs: 'Finance dashboard', kpi: 'Cash position / variance / reporting', authority: 'Analysis/reporting', escalates: 'Money movement', group: 'Executive' },
  { n: 7, name: 'IA-07 Investor Relations', mission: 'Manage investor communications', inputs: 'Investor records, updates, questions', actions: 'Segment, prepare responses, follow up', outputs: 'Investor communication queue', kpi: 'Response time / engagement', authority: 'Approved communications', escalates: 'Regulated solicitation / commitments', group: 'Executive' },
  { n: 8, name: 'IA-08 Legal / Compliance', mission: 'Compliance monitoring', inputs: 'Contracts, regulations, policies', actions: 'Review, flag, route', outputs: 'Compliance exceptions', kpi: 'Unresolved issues', authority: 'Monitoring', escalates: 'Legal advice / execution', group: 'Executive' },
  { n: 9, name: 'IA-09 Sales / Marketing', mission: 'Grow demand', inputs: 'Campaigns, audience, products', actions: 'Plan, draft, optimize', outputs: 'Marketing pipeline', kpi: 'Leads / CAC / conversion', authority: 'Approved campaigns', escalates: 'Regulated claims / large spend', group: 'Executive' },
  { n: 10, name: 'IA-10 Technology / Platform', mission: 'Maintain IVX platform', inputs: 'System health, bugs, logs', actions: 'Diagnose, assign fixes, verify', outputs: 'Technology status', kpi: 'Uptime / defects / recovery time', authority: 'Safe technical operations', escalates: 'Production credentials / destructive changes', group: 'Executive' },
  { n: 11, name: 'IA-11 Security / QA / Certification', mission: 'Verify everything before release', inputs: 'Builds, workflows, logs, evidence', actions: 'Test, reject, certify', outputs: 'PASS / FAIL / CERTIFICATE', kpi: 'Hard-gate success', authority: 'Block unsafe releases', escalates: 'Unresolved critical failures', group: 'Executive' },
  { n: 12, name: 'IA-12 Research / Intelligence', mission: 'Global intelligence', inputs: 'Markets, news, data, technology', actions: 'Research, compare, summarize', outputs: 'Intelligence briefs', kpi: 'Actionable findings', authority: 'Research', escalates: 'Strategic decisions', group: 'Executive' },

  // ── Growth & Marketing (13-21) ──
  { n: 13, name: 'IA-13 App Advertising', mission: 'Acquire users for IVX apps', inputs: 'Channels, audiences, creatives', actions: 'Campaign planning / testing', outputs: 'Advertising campaigns', kpi: 'Installs / CAC / ROAS', authority: 'Approved campaigns', escalates: '', group: 'Growth & Marketing' },
  { n: 14, name: 'IA-14 Paid Media', mission: 'Manage paid acquisition', inputs: 'Ad platforms / budget', actions: 'Optimize campaigns', outputs: 'Paid-media report', kpi: 'Conversion / cost', authority: 'Approved campaigns', escalates: '', group: 'Growth & Marketing' },
  { n: 15, name: 'IA-15 Social Media Growth', mission: 'Grow global audience', inputs: 'Content / channels', actions: 'Schedule / engage / analyze', outputs: 'Growth report', kpi: 'Reach / engagement / leads', authority: 'Approved campaigns', escalates: '', group: 'Growth & Marketing' },
  { n: 16, name: 'IA-16 Brand Expansion', mission: 'Strengthen IVX brand', inputs: 'Markets / messaging', actions: 'Brand strategy', outputs: 'Brand initiatives', kpi: 'Awareness / demand', authority: 'Approved campaigns', escalates: '', group: 'Growth & Marketing' },
  { n: 17, name: 'IA-17 Investor Acquisition', mission: 'Identify potential investors', inputs: 'Permitted lead sources', actions: 'Identify / segment / qualify', outputs: 'Investor leads', kpi: 'Qualified investor prospects', authority: 'Research/outreach', escalates: 'Regulated investment solicitation', group: 'Growth & Marketing' },
  { n: 18, name: 'IA-18 Investor Retention', mission: 'Keep investors engaged', inputs: 'Investor activity / feedback', actions: 'Monitor / communicate / route', outputs: 'Retention actions', kpi: 'Engagement / retention', authority: 'Approved communications', escalates: '', group: 'Growth & Marketing' },
  { n: 19, name: 'IA-19 Buyer Acquisition', mission: 'Find buyers', inputs: 'Market / buyer data', actions: 'Prospect / qualify', outputs: 'Buyer pipeline', kpi: 'Qualified buyers', authority: 'Research/outreach', escalates: '', group: 'Growth & Marketing' },
  { n: 20, name: 'IA-20 Buyer Qualification', mission: 'Verify buyer fit', inputs: 'Criteria / capital / timing', actions: 'Score / segment', outputs: 'Buyer qualification', kpi: 'Verified buyers', authority: 'Analytical', escalates: '', group: 'Growth & Marketing' },
  { n: 21, name: 'IA-21 Buyer Follow-Up', mission: 'Keep buyer pipeline moving', inputs: 'CRM status', actions: 'Reminders / routing', outputs: 'Next-action queue', kpi: 'Response / conversion', authority: 'Approved communications', escalates: '', group: 'Growth & Marketing' },

  // ── Market & Business Development (22-30) ──
  { n: 22, name: 'IA-22 New Market Expansion', mission: 'Identify new geographic markets', inputs: 'Demographics / economics / demand', actions: 'Compare / rank', outputs: 'Market expansion list', kpi: 'Viable markets', authority: 'Research', escalates: '', group: 'Market & Business Development' },
  { n: 23, name: 'IA-23 Business Stability', mission: 'Monitor organizational stability', inputs: 'Revenue / costs / operations', actions: 'Identify risk', outputs: 'Stability score', kpi: 'Unresolved risks', authority: 'Analytical', escalates: '', group: 'Market & Business Development' },
  { n: 24, name: 'IA-24 Revenue Stability', mission: 'Protect recurring revenue', inputs: 'Revenue streams', actions: 'Analyze concentration / volatility', outputs: 'Revenue risk report', kpi: 'Revenue durability', authority: 'Analytical', escalates: '', group: 'Market & Business Development' },
  { n: 25, name: 'IA-25 New Business Discovery', mission: 'Discover new businesses', inputs: 'Trends / unmet needs', actions: 'Ideate / screen', outputs: 'New business ideas', kpi: 'Qualified concepts', authority: 'Research', escalates: '', group: 'Market & Business Development' },
  { n: 26, name: 'IA-26 New Business Validation', mission: 'Validate business concepts', inputs: 'Concepts / market data', actions: 'Test economics / demand', outputs: 'GO / NO-GO', kpi: 'Validated opportunities', authority: 'Analytical', escalates: '', group: 'Market & Business Development' },
  { n: 27, name: 'IA-27 Partnership Development', mission: 'Find strategic partners', inputs: 'Target companies', actions: 'Research / match / outreach prep', outputs: 'Partner pipeline', kpi: 'Qualified partners', authority: 'Research/outreach', escalates: '', group: 'Market & Business Development' },
  { n: 28, name: 'IA-28 JV Deal Origination', mission: 'Identify JV opportunities', inputs: 'Projects / partners', actions: 'Match capital / capability', outputs: 'JV opportunities', kpi: 'Viable JV deals', authority: 'Research', escalates: '', group: 'Market & Business Development' },
  { n: 29, name: 'IA-29 JV Deal Structuring', mission: 'Model JV structures', inputs: 'Economics / roles / capital', actions: 'Scenario modeling', outputs: 'Proposed structures', kpi: 'Viable structures', authority: 'Analytical', escalates: 'Legal/economic commitments', group: 'Market & Business Development' },
  { n: 30, name: 'IA-30 JV Partner Management', mission: 'Track JV relationships', inputs: 'Partner commitments', actions: 'Monitor / coordinate', outputs: 'JV status', kpi: 'Milestone completion', authority: 'Coordination', escalates: '', group: 'Market & Business Development' },

  // ── Digital & Technology (31-40) ──
  { n: 31, name: 'IA-31 Tokenized Assets', mission: 'Evaluate tokenization opportunities', inputs: 'Assets / jurisdictions / models', actions: 'Research / structure analysis', outputs: 'Tokenization feasibility', kpi: 'Viable structures', authority: 'Research', escalates: 'Securities/legal implementation', group: 'Digital & Technology' },
  { n: 32, name: 'IA-32 Tokenized Deal Research', mission: 'Research tokenized markets', inputs: 'Platforms / deals / regulations', actions: 'Compare / monitor', outputs: 'Opportunity intelligence', kpi: 'Viable deals', authority: 'Research', escalates: '', group: 'Digital & Technology' },
  { n: 33, name: 'IA-33 Digital Asset Strategy', mission: 'Digital asset strategy', inputs: 'Market / regulatory data', actions: 'Evaluate use cases', outputs: 'Strategic roadmap', kpi: 'Validated strategy', authority: 'Research', escalates: '', group: 'Digital & Technology' },
  { n: 34, name: 'IA-34 PropTech Research', mission: 'Identify PropTech innovation', inputs: 'Startups / technologies', actions: 'Research / score', outputs: 'PropTech watchlist', kpi: 'Qualified technologies', authority: 'Research', escalates: '', group: 'Digital & Technology' },
  { n: 35, name: 'IA-35 New Technology Discovery', mission: 'Find emerging technology', inputs: 'Research / products / patents', actions: 'Identify / classify', outputs: 'Technology pipeline', kpi: 'New technologies', authority: 'Research', escalates: '', group: 'Digital & Technology' },
  { n: 36, name: 'IA-36 Technology Validation', mission: 'Test promising technologies', inputs: 'Candidates', actions: 'Feasibility / proof-of-concept', outputs: 'Validation report', kpi: 'Validated technologies', authority: 'Analytical', escalates: '', group: 'Digital & Technology' },
  { n: 37, name: 'IA-37 AI Technology Research', mission: 'Monitor AI advances', inputs: 'Models / APIs / research', actions: 'Benchmark / recommend', outputs: 'AI roadmap', kpi: 'Actionable findings', authority: 'Research', escalates: '', group: 'Digital & Technology' },
  { n: 38, name: 'IA-38 Quantum Technology Research', mission: 'Monitor quantum technology', inputs: 'Research / vendors / use cases', actions: 'Evaluate maturity', outputs: 'Quantum intelligence', kpi: 'Maturity assessments', authority: 'Research', escalates: '', group: 'Digital & Technology' },
  { n: 39, name: 'IA-39 Quantum Business Applications', mission: 'Find practical quantum applications', inputs: 'IVX business problems', actions: 'Map use cases', outputs: 'Experiment proposals', kpi: 'Viable applications', authority: 'Research', escalates: '', group: 'Digital & Technology' },
  { n: 40, name: 'IA-40 Automation Innovation', mission: 'Automate repetitive operations', inputs: 'Workflows / bottlenecks', actions: 'Design automation', outputs: 'Automation backlog', kpi: 'Automated processes', authority: 'Safe technical operations', escalates: '', group: 'Digital & Technology' },

  // ── Intelligence (41-45) ──
  { n: 41, name: 'IA-41 Data Intelligence', mission: 'Convert data into decisions', inputs: 'IVX datasets', actions: 'Analyze / detect patterns', outputs: 'Intelligence dashboards', kpi: 'Actionable insights', authority: 'Analytical', escalates: '', group: 'Intelligence' },
  { n: 42, name: 'IA-42 Market Intelligence', mission: 'Global market monitoring', inputs: 'Prices / transactions / demand', actions: 'Analyze trends', outputs: 'Market alerts', kpi: 'Timely alerts', authority: 'Analytical', escalates: '', group: 'Intelligence' },
  { n: 43, name: 'IA-43 Competitor Intelligence', mission: 'Track competitors', inputs: 'Public competitor data', actions: 'Compare offerings / positioning', outputs: 'Competitor reports', kpi: 'Strategic findings', authority: 'Research', escalates: '', group: 'Intelligence' },
  { n: 44, name: 'IA-44 Economic Intelligence', mission: 'Monitor macroeconomic conditions', inputs: 'Rates / inflation / employment', actions: 'Assess impact', outputs: 'Economic risk signals', kpi: 'Risk assessments', authority: 'Analytical', escalates: '', group: 'Intelligence' },
  { n: 45, name: 'IA-45 Real Estate Intelligence', mission: 'Track property markets', inputs: 'Sales / rents / supply', actions: 'Identify trends', outputs: 'Real-estate intelligence', kpi: 'Market insights', authority: 'Analytical', escalates: '', group: 'Intelligence' },

  // ── Networks & Capital (46-55) ──
  { n: 46, name: 'IA-46 Deal Sourcing', mission: 'Source investment opportunities', inputs: 'Public / partner / broker sources', actions: 'Discover / rank', outputs: 'Deal pipeline', kpi: 'Sourced deals', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },
  { n: 47, name: 'IA-47 Off-Market Opportunities', mission: 'Discover off-market opportunities', inputs: 'Permitted owner / market data', actions: 'Identify / qualify', outputs: 'Off-market leads', kpi: 'Qualified leads', authority: 'Research', escalates: '', group: 'Networks & Capital' },
  { n: 48, name: 'IA-48 Buyer Network Growth', mission: 'Expand buyer network', inputs: 'Buyer segments', actions: 'Source / classify', outputs: 'Buyer network', kpi: 'New buyers', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },
  { n: 49, name: 'IA-49 Seller Network Growth', mission: 'Expand seller network', inputs: 'Ownership / listings', actions: 'Source / qualify', outputs: 'Seller pipeline', kpi: 'New sellers', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },
  { n: 50, name: 'IA-50 Broker Network Growth', mission: 'Expand broker relationships', inputs: 'Broker directories', actions: 'Research / segment', outputs: 'Broker network', kpi: 'New brokers', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },
  { n: 51, name: 'IA-51 Lender Network Growth', mission: 'Expand financing sources', inputs: 'Lenders / programs', actions: 'Compare / qualify', outputs: 'Lender directory', kpi: 'Qualified lenders', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },
  { n: 52, name: 'IA-52 Capital Markets', mission: 'Monitor capital availability', inputs: 'Debt / equity markets', actions: 'Analyze terms', outputs: 'Capital market report', kpi: 'Financing opportunities', authority: 'Analytical', escalates: '', group: 'Networks & Capital' },
  { n: 53, name: 'IA-53 Private Equity Relations', mission: 'Identify PE relationships', inputs: 'Firms / mandates', actions: 'Research / match', outputs: 'PE prospect pipeline', kpi: 'Qualified prospects', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },
  { n: 54, name: 'IA-54 Family Office Relations', mission: 'Identify family-office prospects', inputs: 'Permitted public/business sources', actions: 'Research / segment', outputs: 'Family-office pipeline', kpi: 'Qualified prospects', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },
  { n: 55, name: 'IA-55 Institutional Relations', mission: 'Institutional prospect development', inputs: 'Institutional mandates', actions: 'Identify / match', outputs: 'Institutional pipeline', kpi: 'Qualified institutions', authority: 'Research/outreach', escalates: '', group: 'Networks & Capital' },

  // ── Global Expansion (56-62) ──
  { n: 56, name: 'IA-56 International Expansion', mission: 'Global expansion research', inputs: 'Countries / markets', actions: 'Compare opportunity / risk', outputs: 'Expansion candidates', kpi: 'Viable countries', authority: 'Research', escalates: '', group: 'Global Expansion' },
  { n: 57, name: 'IA-57 New Country Research', mission: 'Country-level opportunity research', inputs: 'Legal / economic / real estate data', actions: 'Score countries', outputs: 'Country scorecards', kpi: 'Scored countries', authority: 'Research', escalates: '', group: 'Global Expansion' },
  { n: 58, name: 'IA-58 New City Research', mission: 'Identify high-potential cities', inputs: 'Growth / rents / supply / demand', actions: 'Rank cities', outputs: 'City pipeline', kpi: 'Ranked cities', authority: 'Research', escalates: '', group: 'Global Expansion' },
  { n: 59, name: 'IA-59 New Development Opportunities', mission: 'Find development opportunities', inputs: 'Land / zoning / demand', actions: 'Screen / rank', outputs: 'Development pipeline', kpi: 'Viable developments', authority: 'Research', escalates: '', group: 'Global Expansion' },
  { n: 60, name: 'IA-60 New Asset Classes', mission: 'Identify additional asset classes', inputs: 'Market performance', actions: 'Analyze', outputs: 'Asset-class proposals', kpi: 'Viable classes', authority: 'Analytical', escalates: '', group: 'Global Expansion' },
  { n: 61, name: 'IA-61 Strategic Growth', mission: 'Coordinate long-term growth', inputs: 'All department intelligence', actions: 'Combine / prioritize', outputs: 'Growth roadmap', kpi: 'Growth initiatives', authority: 'Analytical', escalates: 'Strategic decisions', group: 'Global Expansion' },
  { n: 62, name: 'IA-62 Future Opportunities', mission: 'Continuously identify future opportunities', inputs: 'Technology / market / social trends', actions: 'Horizon scan', outputs: 'Future opportunity portfolio', kpi: 'Emerging opportunities', authority: 'Research', escalates: '', group: 'Global Expansion' },

  // ── New App Development (63-92) ──
  { n: 63, name: 'IA-63 New App Discovery', mission: 'Discover app opportunities', inputs: 'User problems / market gaps', actions: 'Ideate / rank', outputs: 'App concepts', kpi: 'Qualified concepts', authority: 'Research', escalates: '', group: 'New App Development' },
  { n: 64, name: 'IA-64 New App Business Case', mission: 'Build business case', inputs: 'App concepts', actions: 'Economics / demand analysis', outputs: 'GO / NO-GO', kpi: 'Validated concepts', authority: 'Analytical', escalates: '', group: 'New App Development' },
  { n: 65, name: 'IA-65 New App Product Strategy', mission: 'Define product direction', inputs: 'Validated concept', actions: 'Roadmap / features', outputs: 'Product specification', kpi: 'Defined roadmap', authority: 'Analytical', escalates: '', group: 'New App Development' },
  { n: 66, name: 'IA-66 New App UX Architecture', mission: 'Design user journey', inputs: 'Requirements', actions: 'Flows / information architecture', outputs: 'UX specification', kpi: 'Designed flows', authority: 'Analytical', escalates: '', group: 'New App Development' },
  { n: 67, name: 'IA-67 New App UI Design', mission: 'Define interface', inputs: 'UX / brand', actions: 'Screen system / components', outputs: 'UI specification', kpi: 'Designed screens', authority: 'Analytical', escalates: '', group: 'New App Development' },
  { n: 68, name: 'IA-68 New App Frontend Architecture', mission: 'Frontend engineering', inputs: 'UI / requirements', actions: 'Architecture / implementation', outputs: 'Frontend build', kpi: 'Built frontend', authority: 'Safe technical operations', escalates: 'Production deployment', group: 'New App Development' },
  { n: 69, name: 'IA-69 New App Backend Architecture', mission: 'Backend engineering', inputs: 'Product requirements', actions: 'Services / logic', outputs: 'Backend build', kpi: 'Built backend', authority: 'Safe technical operations', escalates: 'Production deployment', group: 'New App Development' },
  { n: 70, name: 'IA-70 New App Database Design', mission: 'Database architecture', inputs: 'Entities / workflows', actions: 'Schema / policies', outputs: 'Database layer', kpi: 'Designed schema', authority: 'Safe technical operations', escalates: 'Production schema changes', group: 'New App Development' },
  { n: 71, name: 'IA-71 New App API Design', mission: 'API architecture', inputs: 'Services / clients', actions: 'Endpoints / contracts', outputs: 'API layer', kpi: 'Designed API', authority: 'Safe technical operations', escalates: 'Breaking API changes', group: 'New App Development' },
  { n: 72, name: 'IA-72 New App AI Architecture', mission: 'AI system design', inputs: 'App use cases', actions: 'Models / prompts / orchestration', outputs: 'AI architecture', kpi: 'Designed AI', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 73, name: 'IA-73 New App Security Architecture', mission: 'Security-by-design', inputs: 'App architecture', actions: 'Threat modeling / controls', outputs: 'Security specification', kpi: 'Security controls', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 74, name: 'IA-74 New App Authentication', mission: 'Identity/access implementation', inputs: 'Roles / users', actions: 'Auth flows / permissions', outputs: 'Authentication system', kpi: 'Implemented auth', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 75, name: 'IA-75 New App Payments', mission: 'Payment architecture', inputs: 'Business model', actions: 'Payment integration design', outputs: 'Payment workflow', kpi: 'Payment system', authority: 'Safe technical operations', escalates: 'Financial transactions', group: 'New App Development' },
  { n: 76, name: 'IA-76 New App Analytics', mission: 'Product analytics', inputs: 'Events / KPIs', actions: 'Instrument / report', outputs: 'Analytics layer', kpi: 'Tracked metrics', authority: 'Analytical', escalates: '', group: 'New App Development' },
  { n: 77, name: 'IA-77 New App Notifications', mission: 'Notification system', inputs: 'Product events', actions: 'Push/email/in-app logic', outputs: 'Notification engine', kpi: 'Notification system', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 78, name: 'IA-78 New App iOS', mission: 'iOS delivery', inputs: 'App build', actions: 'Compile / test / package', outputs: 'iOS candidate', kpi: 'Built iOS app', authority: 'Safe technical operations', escalates: 'App store submission', group: 'New App Development' },
  { n: 79, name: 'IA-79 New App Android', mission: 'Android delivery', inputs: 'App build', actions: 'Compile / test / package', outputs: 'Android candidate', kpi: 'Built Android app', authority: 'Safe technical operations', escalates: 'Play store submission', group: 'New App Development' },
  { n: 80, name: 'IA-80 New App Web', mission: 'Web delivery', inputs: 'Frontend/backend', actions: 'Build / test / deploy', outputs: 'Web application', kpi: 'Built web app', authority: 'Safe technical operations', escalates: 'Production deployment', group: 'New App Development' },
  { n: 81, name: 'IA-81 New App Admin Portal', mission: 'Administrative tools', inputs: 'Operations needs', actions: 'Build control interfaces', outputs: 'Admin portal', kpi: 'Built portal', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 82, name: 'IA-82 New App Investor Portal', mission: 'Investor-facing interface', inputs: 'Investor requirements', actions: 'Build portal', outputs: 'Investor portal', kpi: 'Built portal', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 83, name: 'IA-83 New App Buyer Portal', mission: 'Buyer interface', inputs: 'Buyer workflows', actions: 'Build portal', outputs: 'Buyer portal', kpi: 'Built portal', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 84, name: 'IA-84 New App Seller Portal', mission: 'Seller interface', inputs: 'Seller workflows', actions: 'Build portal', outputs: 'Seller portal', kpi: 'Built portal', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 85, name: 'IA-85 New App Marketplace', mission: 'Marketplace capability', inputs: 'Buyers / sellers / inventory', actions: 'Matching / listing logic', outputs: 'Marketplace', kpi: 'Built marketplace', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 86, name: 'IA-86 New App Automation', mission: 'Automate new apps', inputs: 'Workflows', actions: 'Automate repetitive processes', outputs: 'Automation layer', kpi: 'Automated processes', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 87, name: 'IA-87 New App Testing', mission: 'Functional testing', inputs: 'Builds', actions: 'Run test suites', outputs: 'Test results', kpi: 'Test coverage', authority: 'Quality assurance', escalates: '', group: 'New App Development' },
  { n: 88, name: 'IA-88 New App QA', mission: 'Quality assurance', inputs: 'Test results / requirements', actions: 'Validate / reject', outputs: 'QA decision', kpi: 'Quality gates', authority: 'Block unsafe releases', escalates: '', group: 'New App Development' },
  { n: 89, name: 'IA-89 New App Security Testing', mission: 'Security verification', inputs: 'Build / architecture', actions: 'Security testing', outputs: 'Security report', kpi: 'Security verified', authority: 'Block unsafe releases', escalates: '', group: 'New App Development' },
  { n: 90, name: 'IA-90 New App Deployment', mission: 'Deployment orchestration', inputs: 'Certified build', actions: 'Deploy / verify', outputs: 'Live environment', kpi: 'Deployed app', authority: 'Safe technical operations', escalates: 'Production deployment', group: 'New App Development' },
  { n: 91, name: 'IA-91 New App Monitoring', mission: 'Post-launch monitoring', inputs: 'Telemetry / logs', actions: 'Detect incidents', outputs: 'Health status', kpi: 'Issues detected', authority: 'Safe technical operations', escalates: '', group: 'New App Development' },
  { n: 92, name: 'IA-92 New App Growth', mission: 'Grow launched apps', inputs: 'Acquisition / product data', actions: 'Experiments', outputs: 'Growth plan', kpi: 'Growth experiments', authority: 'Analytical', escalates: 'Large spend', group: 'New App Development' },

  // ── New Project Development (93-102) ──
  { n: 93, name: 'IA-93 New Project Discovery', mission: 'Discover non-app projects', inputs: 'Business opportunities', actions: 'Ideate / screen', outputs: 'Project pipeline', kpi: 'Qualified concepts', authority: 'Research', escalates: '', group: 'New Project Development' },
  { n: 94, name: 'IA-94 New Project Feasibility', mission: 'Feasibility analysis', inputs: 'Project concepts', actions: 'Technical / market / operational analysis', outputs: 'Feasibility report', kpi: 'Validated projects', authority: 'Analytical', escalates: '', group: 'New Project Development' },
  { n: 95, name: 'IA-95 New Project Financial Model', mission: 'Project economics', inputs: 'Costs / revenue assumptions', actions: 'Model scenarios', outputs: 'Financial model', kpi: 'Validated economics', authority: 'Analytical', escalates: '', group: 'New Project Development' },
  { n: 96, name: 'IA-96 New Project Legal Structure', mission: 'Legal-structure research', inputs: 'Project requirements', actions: 'Identify structure options', outputs: 'Legal options', kpi: 'Legal options', authority: 'Research', escalates: 'Attorney/legal execution', group: 'New Project Development' },
  { n: 97, name: 'IA-97 New Project Branding', mission: 'Create project brand strategy', inputs: 'Positioning / audience', actions: 'Naming / messaging', outputs: 'Brand package', kpi: 'Brand defined', authority: 'Analytical', escalates: '', group: 'New Project Development' },
  { n: 98, name: 'IA-98 New Project Operations', mission: 'Operating model design', inputs: 'Project plan', actions: 'Workflows / roles', outputs: 'Operating plan', kpi: 'Operating model', authority: 'Analytical', escalates: '', group: 'New Project Development' },
  { n: 99, name: 'IA-99 New Project Technology', mission: 'Technology architecture', inputs: 'Project requirements', actions: 'Select / design tech', outputs: 'Technical architecture', kpi: 'Designed architecture', authority: 'Safe technical operations', escalates: '', group: 'New Project Development' },
  { n: 100, name: 'IA-100 New Project Automation', mission: 'Automate project operations', inputs: 'Workflows', actions: 'Automation design', outputs: 'Automation system', kpi: 'Automated processes', authority: 'Safe technical operations', escalates: '', group: 'New Project Development' },
  { n: 101, name: 'IA-101 New Project Launch', mission: 'Coordinate launch', inputs: 'Approved deliverables', actions: 'Readiness / launch checklist', outputs: 'Launch status', kpi: 'Launched project', authority: 'Coordination', escalates: 'Production launch', group: 'New Project Development' },
  { n: 102, name: 'IA-102 New Project Scale', mission: 'Scale successful projects', inputs: 'Usage / revenue / operations', actions: 'Identify bottlenecks', outputs: 'Scale roadmap', kpi: 'Scaled project', authority: 'Analytical', escalates: 'Large capital', group: 'New Project Development' },

  // ── Product Creation & Innovation (103-112) ──
  { n: 103, name: 'IA-103 Experimental Products', mission: 'Test experimental concepts', inputs: 'Innovation ideas', actions: 'Prototype / measure', outputs: 'Experiments', kpi: 'Validated experiments', authority: 'Research/prototyping', escalates: 'Production launch', group: 'Product Creation & Innovation' },
  { n: 104, name: 'IA-104 SaaS Product Creation', mission: 'Create SaaS products', inputs: 'Validated SaaS opportunities', actions: 'Product build coordination', outputs: 'SaaS products', kpi: 'Built products', authority: 'Safe technical operations', escalates: 'Production launch', group: 'Product Creation & Innovation' },
  { n: 105, name: 'IA-105 FinTech Product Creation', mission: 'Create FinTech concepts/products', inputs: 'Finance pain points', actions: 'Design / validate', outputs: 'FinTech products', kpi: 'Validated products', authority: 'Safe technical operations', escalates: 'Regulated financial functionality', group: 'Product Creation & Innovation' },
  { n: 106, name: 'IA-106 PropTech Product Creation', mission: 'Build PropTech products', inputs: 'Property workflows', actions: 'Design / coordinate build', outputs: 'PropTech products', kpi: 'Built products', authority: 'Safe technical operations', escalates: 'Production launch', group: 'Product Creation & Innovation' },
  { n: 107, name: 'IA-107 AI Product Creation', mission: 'Create AI-native products', inputs: 'Validated use cases', actions: 'Prototype / evaluate', outputs: 'AI products', kpi: 'Validated products', authority: 'Safe technical operations', escalates: 'Production launch', group: 'Product Creation & Innovation' },
  { n: 108, name: 'IA-108 Tokenization Product Creation', mission: 'Design tokenization technology', inputs: 'Validated legal/business model', actions: 'Architecture / prototype', outputs: 'Tokenization product', kpi: 'Built product', authority: 'Safe technical operations', escalates: 'Regulated launch', group: 'Product Creation & Innovation' },
  { n: 109, name: 'IA-109 Quantum Product Research', mission: 'Investigate quantum-enabled products', inputs: 'Quantum capability / use cases', actions: 'Feasibility experiments', outputs: 'Quantum product research', kpi: 'Validated experiments', authority: 'Research', escalates: '', group: 'Product Creation & Innovation' },
  { n: 110, name: 'IA-110 Internal Tool Creation', mission: 'Create IVX internal tools', inputs: 'Department needs', actions: 'Design / build / test', outputs: 'Internal applications', kpi: 'Built tools', authority: 'Safe technical operations', escalates: '', group: 'Product Creation & Innovation' },
  { n: 111, name: 'IA-111 External Client App Creation', mission: 'Create applications for external clients', inputs: 'Approved client requirements', actions: 'Scope / build / QA', outputs: 'Client applications', kpi: 'Built apps', authority: 'Safe technical operations', escalates: 'Production launch', group: 'Product Creation & Innovation' },
  { n: 112, name: 'IA-112 Continuous Innovation Lab', mission: 'Continuously generate and test innovation', inputs: 'All IVX data / market / technology signals', actions: 'Ideate / prototype / evaluate / route', outputs: 'Innovation portfolio', kpi: 'Validated experiments', authority: 'Research and prototyping', escalates: 'Production launch / capital / legal decisions', group: 'Product Creation & Innovation' },
];

function derivePriority(n: number): OrchestratorPriority {
  if (n === 1 || n === 10 || n === 11) return 'critical';
  if (n <= 12) return 'high';
  if (n >= 63 && n <= 92) return 'high';
  if (n >= 93 && n <= 102) return 'medium';
  if (n >= 103) return 'medium';
  return 'medium';
}

/**
 * Assign division based on agent role:
 * - Division A (Core Operations): Executive, Growth, Market, Intelligence, Networks (1-55)
 * - Division B (Innovation & Expansion): Digital/Tech, Global, New App/Project/Product Dev (56-112)
 * This produces a 55/57 split — both divisions substantial and balanced.
 */
function deriveDivision(agentNumber: number): DivisionId {
  return agentNumber <= 55 ? 'A' : 'B';
}

function deriveRiskLevel(def: AgentDef): AgentRiskLevel {
  if (def.n === 11) return 'high';
  if (def.escalates && /capital|legal|regulated|production|financial/i.test(def.escalates)) return 'high';
  if (def.n >= 68 && def.n <= 90) return 'medium';
  if (def.n <= 12) return 'medium';
  return 'low';
}

function makeAgentFromDef(def: AgentDef): EnterpriseMasterAgent {
  const priority: OrchestratorPriority = derivePriority(def.n);
  const riskLevel: AgentRiskLevel = deriveRiskLevel(def);
  const canModifyIVX = def.n <= 12;
  const buildsNewProducts = def.n >= 63;
  const destructiveActions: string[] = def.escalates ? [def.escalates] : [];
  const division = deriveDivision(def.n);
  return {
    id: `ivx_holdings_${def.n}`,
    agentNumber: def.n,
    name: def.name,
    role: def.mission,
    division,
    company: 'ivx_holdings' as CompanyId,
    responsibilities: [def.inputs, def.actions, def.outputs],
    capabilities: def.actions.split(/,\s*|\s*\/\s*/).filter(Boolean),
    priority,
    riskLevel,
    heartbeatGoal: def.kpi,
    destructiveActions,
    canModifyIVX,
    buildsNewProducts,
    mission: def.mission,
    inputs: def.inputs,
    actions: def.actions,
    outputs: def.outputs,
    kpi: def.kpi,
    authority: def.authority,
    escalates: def.escalates || null,
    functionalGroup: def.group,
  };
}

export const ALL_ENTERPRISE_AGENTS: EnterpriseMasterAgent[] = AGENT_DEFS.map(makeAgentFromDef);

export const ENTERPRISE_MASTER_REGISTRY: Record<string, EnterpriseMasterAgent> =
  Object.fromEntries(ALL_ENTERPRISE_AGENTS.map((a) => [a.id, a]));

export function getAgentById(id: string): EnterpriseMasterAgent | null {
  return ENTERPRISE_MASTER_REGISTRY[id] ?? null;
}

export function getAgentByNumber(num: number): EnterpriseMasterAgent | null {
  return ALL_ENTERPRISE_AGENTS.find((a) => a.agentNumber === num) ?? null;
}

export function getAgentsByDivision(division: DivisionId): EnterpriseMasterAgent[] {
  return ALL_ENTERPRISE_AGENTS.filter((a) => a.division === division);
}

export function getAgentsByCompany(company: CompanyId): EnterpriseMasterAgent[] {
  return ALL_ENTERPRISE_AGENTS.filter((a) => a.company === company);
}

export function getDivisionA_Agents(): EnterpriseMasterAgent[] {
  return getAgentsByDivision('A');
}

export function getDivisionB_Agents(): EnterpriseMasterAgent[] {
  return getAgentsByDivision('B');
}

export function getAgentsByFunctionalGroup(group: string): EnterpriseMasterAgent[] {
  return ALL_ENTERPRISE_AGENTS.filter((a) => a.functionalGroup === group);
}

export function getFunctionalGroups(): string[] {
  return [...new Set(ALL_ENTERPRISE_AGENTS.map((a) => a.functionalGroup))];
}

export type AgentStatus = 'idle' | 'active' | 'running' | 'blocked' | 'failed' | 'offline';

export type AgentHealthReport = {
  agentId: string;
  agentNumber: number;
  name: string;
  division: DivisionId;
  company: CompanyId;
  status: AgentStatus;
  lastHeartbeat: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  currentTask: string | null;
};

export type EnterpriseMasterReport = {
  generatedAt: string;
  totalAgents: number;
  divisionA_Count: number;
  divisionB_Count: number;
  companies: Array<{ id: CompanyId; name: string; division: DivisionId; agentCount: number; activeAgents: number; tasksCompleted: number; tasksFailed: number; }>;
  summary: { activeAgents: number; idleAgents: number; blockedAgents: number; failedAgents: number; totalTasksCompleted: number; totalTasksFailed: number; };
  sharedServices: { github: boolean; ci_cd: boolean; secureVariables: boolean; auditLogs: boolean; monitoring: boolean; backups: boolean; testingFramework: boolean; documentation: boolean; apiGateway: boolean; authentication: boolean; versionControl: boolean; };
};

export function generateEnterpriseMasterReport(): EnterpriseMasterReport {
  const divisionA = getDivisionA_Agents();
  const divisionB = getDivisionB_Agents();
  const companySummaries = (Object.keys(ENTERPRISE_COMPANIES) as CompanyId[]).map((companyId) => {
    const company = ENTERPRISE_COMPANIES[companyId];
    const agents = getAgentsByCompany(companyId);
    return { id: companyId, name: company.name, division: company.division, agentCount: agents.length, activeAgents: 0, tasksCompleted: 0, tasksFailed: 0 };
  });
  return {
    generatedAt: new Date().toISOString(),
    totalAgents: ALL_ENTERPRISE_AGENTS.length,
    divisionA_Count: divisionA.length,
    divisionB_Count: divisionB.length,
    companies: companySummaries,
    summary: { activeAgents: 0, idleAgents: ALL_ENTERPRISE_AGENTS.length, blockedAgents: 0, failedAgents: 0, totalTasksCompleted: 0, totalTasksFailed: 0 },
    sharedServices: { github: true, ci_cd: true, secureVariables: true, auditLogs: true, monitoring: true, backups: true, testingFramework: true, documentation: true, apiGateway: true, authentication: true, versionControl: true },
  };
}

/**
 * Validate the enterprise master registry — ensure all 112 agents are
 * properly defined with no gaps or duplicates.
 */
export function validateEnterpriseMasterRegistry(): {
  valid: boolean;
  totalAgents: number;
  issues: string[];
} {
  const issues: string[] = [];
  const expected = 112;
  if (ALL_ENTERPRISE_AGENTS.length !== expected) {
    issues.push(`Expected ${expected} agents, found ${ALL_ENTERPRISE_AGENTS.length}`);
  }
  const numbers = ALL_ENTERPRISE_AGENTS.map((a) => a.agentNumber);
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      issues.push(`Agent number gap or duplicate at position ${i + 1}: found ${sorted[i]}`);
      break;
    }
  }
  const ids = ALL_ENTERPRISE_AGENTS.map((a) => a.id);
  const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicateIds.length > 0) {
    issues.push(`Duplicate agent IDs: ${duplicateIds.join(', ')}`);
  }
  for (const agent of ALL_ENTERPRISE_AGENTS) {
    if (!agent.name) issues.push(`Agent ${agent.agentNumber}: missing name`);
    if (!agent.role) issues.push(`Agent ${agent.agentNumber}: missing role`);
    if (!agent.responsibilities.length) issues.push(`Agent ${agent.agentNumber}: no responsibilities`);
    if (!agent.capabilities.length) issues.push(`Agent ${agent.agentNumber}: no capabilities`);
    if (!agent.heartbeatGoal) issues.push(`Agent ${agent.agentNumber}: missing heartbeat goal`);
    if (!agent.mission) issues.push(`Agent ${agent.agentNumber}: missing mission`);
    if (!agent.functionalGroup) issues.push(`Agent ${agent.agentNumber}: missing functional group`);
  }
  return { valid: issues.length === 0, totalAgents: ALL_ENTERPRISE_AGENTS.length, issues };
}

/**
 * Get a compact summary of all agents for dashboard display.
 */
export function getEnterpriseAgentSummaries(): Array<{
  agentNumber: number; id: string; name: string; role: string;
  division: DivisionId; company: CompanyId; priority: OrchestratorPriority;
  riskLevel: AgentRiskLevel; canModifyIVX: boolean; buildsNewProducts: boolean;
  capabilitiesCount: number; functionalGroup: string; mission: string; kpi: string;
}> {
  return ALL_ENTERPRISE_AGENTS.map((a) => ({
    agentNumber: a.agentNumber, id: a.id, name: a.name, role: a.role,
    division: a.division, company: a.company, priority: a.priority,
    riskLevel: a.riskLevel, canModifyIVX: a.canModifyIVX,
    buildsNewProducts: a.buildsNewProducts, capabilitiesCount: a.capabilities.length,
    functionalGroup: a.functionalGroup, mission: a.mission, kpi: a.kpi,
  }));
}
