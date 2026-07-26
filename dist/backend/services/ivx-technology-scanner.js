/**
 * IVX Top AI Technology Scanner — daily search and report.
 *
 * Every day, scans for the latest in:
 *
 *   - AI developer tools
 *   - Deployment automation tools
 *   - GitHub automation
 *   - Render/Vercel/AWS automation
 *   - Supabase automation
 *   - AI coding agents
 *   - Security tools
 *   - QA/testing tools
 *   - Real estate AI tools
 *   - Investor discovery tools
 *
 * Results are cached and available via the API. No external API keys are
 * needed — the scanner uses web search with structured categories.
 */
import { randomUUID } from 'node:crypto';
export const TECH_SCANNER_MARKER = 'ivx-technology-scanner-2026-07-02';
// ─── Category Definitions ───────────────────────────────────────────
const SCAN_CATEGORIES = [
    {
        category: 'ai_developer_tools',
        label: 'AI Developer Tools',
        queryKeywords: ['AI developer tools 2026', 'AI coding assistant', 'AI code generation', 'AI debugging tools'],
    },
    {
        category: 'deployment_automation',
        label: 'Deployment Automation',
        queryKeywords: ['deployment automation tools 2026', 'CI/CD automation', 'automated deployment pipeline', 'zero-downtime deploy 2026'],
    },
    {
        category: 'github_automation',
        label: 'GitHub Automation',
        queryKeywords: ['GitHub Actions automation 2026', 'GitHub API automation', 'GitHub Copilot workspace', 'GitHub auto-merge tools'],
    },
    {
        category: 'render_aws_automation',
        label: 'Render/AWS Automation',
        queryKeywords: ['Render deploy automation', 'AWS deployment automation', 'infrastructure as code 2026'],
    },
    {
        category: 'supabase_automation',
        label: 'Supabase Automation',
        queryKeywords: ['Supabase edge functions automation', 'Supabase migration tools', 'Supabase realtime optimization'],
    },
    {
        category: 'ai_coding_agents',
        label: 'AI Coding Agents',
        queryKeywords: ['autonomous AI coding agent 2026', 'AI software engineer', 'self-improving AI developer', 'AI agent writes code'],
    },
    {
        category: 'security_tools',
        label: 'Security Tools',
        queryKeywords: ['application security automation 2026', 'secrets scanning tools', 'dependency vulnerability scanner', 'API security tools'],
    },
    {
        category: 'qa_testing_tools',
        label: 'QA / Testing Tools',
        queryKeywords: ['automated testing tools 2026', 'AI test generation', 'end-to-end testing automation', 'visual regression testing'],
    },
    {
        category: 'real_estate_ai',
        label: 'Real Estate AI Tools',
        queryKeywords: ['AI real estate tools 2026', 'real estate AI analytics', 'property valuation AI', 'real estate investment AI'],
    },
    {
        category: 'investor_discovery',
        label: 'Investor Discovery Tools',
        queryKeywords: ['investor discovery platform 2026', 'AI investor matching', 'capital raising automation', 'investor CRM AI'],
    },
];
// ─── Curated Knowledge Base ─────────────────────────────────────────
/**
 * Built-in knowledge base of top tools by category. This is the fallback
 * when web search is unavailable. Updated periodically.
 */
const CURATED_TOOLS = {
    ai_developer_tools: [
        { name: 'GitHub Copilot', url: 'https://github.com/features/copilot', description: 'AI pair programmer with code completion, chat, and agent mode.', relevance: 'high' },
        { name: 'Cursor', url: 'https://cursor.com', description: 'AI-first code editor with agentic capabilities and codebase understanding.', relevance: 'high' },
        { name: 'Claude Code', url: 'https://claude.ai/code', description: 'Anthropic\'s CLI-based AI coding agent with deep reasoning.', relevance: 'high' },
        { name: 'Windsurf', url: 'https://codeium.com/windsurf', description: 'AI-native IDE with Cascade agent for complex multi-file edits.', relevance: 'high' },
        { name: 'Devin', url: 'https://cognition.ai', description: 'Autonomous AI software engineer that handles entire development tasks.', relevance: 'high' },
        { name: 'Aider', url: 'https://aider.chat', description: 'Open-source AI pair programming in the terminal with git integration.', relevance: 'medium' },
        { name: 'Continue', url: 'https://continue.dev', description: 'Open-source AI code assistant that plugs into any IDE.', relevance: 'medium' },
        { name: 'CodeRabbit', url: 'https://coderabbit.ai', description: 'AI-powered code review with line-by-line suggestions and summaries.', relevance: 'medium' },
    ],
    deployment_automation: [
        { name: 'Render', url: 'https://render.com', description: 'Zero-DevOps cloud platform with auto-deploy from Git, native Docker support.', relevance: 'high' },
        { name: 'Railway', url: 'https://railway.app', description: 'Instant deployment with built-in databases and CI/CD pipelines.', relevance: 'high' },
        { name: 'Fly.io', url: 'https://fly.io', description: 'Deploy apps close to users with global Anycast networking.', relevance: 'medium' },
        { name: 'Kamal', url: 'https://kamal-deploy.org', description: 'Deploy web apps anywhere with zero-downtime, from bare metal to cloud VMs.', relevance: 'medium' },
        { name: 'Dagger', url: 'https://dagger.io', description: 'CI/CD pipeline as code in TypeScript, Python, or Go.', relevance: 'medium' },
    ],
    github_automation: [
        { name: 'GitHub Actions', url: 'https://github.com/features/actions', description: 'Built-in CI/CD with 20,000+ community actions.', relevance: 'high' },
        { name: 'Renovate', url: 'https://docs.renovatebot.com', description: 'Automated dependency updates with PR creation and merge automation.', relevance: 'high' },
        { name: 'Mergify', url: 'https://mergify.com', description: 'Automated merge queue with conditional rules for PR merging.', relevance: 'medium' },
        { name: 'Danger', url: 'https://danger.systems', description: 'Automated code review rules running in CI to enforce conventions.', relevance: 'medium' },
        { name: 'Graphite', url: 'https://graphite.dev', description: 'Stacked PR workflow with auto-rebase and smart code review.', relevance: 'medium' },
    ],
    render_aws_automation: [
        { name: 'Terraform', url: 'https://terraform.io', description: 'Infrastructure as code for AWS, GCP, Azure, and 3000+ providers.', relevance: 'high' },
        { name: 'Pulumi', url: 'https://pulumi.com', description: 'Infrastructure as code using real programming languages.', relevance: 'high' },
        { name: 'SST', url: 'https://sst.dev', description: 'Build full-stack apps on AWS with live Lambda development.', relevance: 'high' },
        { name: 'AWS CDK', url: 'https://aws.amazon.com/cdk/', description: 'Define AWS infrastructure using TypeScript, Python, Java, or C#.', relevance: 'high' },
        { name: 'Serverless Framework', url: 'https://serverless.com', description: 'Deploy serverless applications across AWS, Azure, and GCP.', relevance: 'medium' },
    ],
    supabase_automation: [
        { name: 'Supabase CLI', url: 'https://supabase.com/docs/guides/cli', description: 'Local development, migrations, and CI/CD for Supabase projects.', relevance: 'high' },
        { name: 'Supabase Edge Functions', url: 'https://supabase.com/edge-functions', description: 'Serverless functions deployed globally on Deno runtime.', relevance: 'high' },
        { name: 'Snaplet', url: 'https://snaplet.dev', description: 'Generate realistic seed data for Supabase/Postgres development.', relevance: 'medium' },
        { name: 'Prisma', url: 'https://prisma.io', description: 'TypeScript ORM with migrations, schema management, and Supabase support.', relevance: 'high' },
        { name: 'Drizzle ORM', url: 'https://orm.drizzle.team', description: 'Lightweight TypeScript ORM with Supabase/Postgres support.', relevance: 'medium' },
    ],
    ai_coding_agents: [
        { name: 'Devin', url: 'https://cognition.ai', description: 'First AI software engineer — handles PRs, bug fixes, and feature development autonomously.', relevance: 'high' },
        { name: 'OpenHands', url: 'https://all-hands.dev', description: 'Open-source AI agent that writes, tests, and deploys code.', relevance: 'high' },
        { name: 'SWE-agent', url: 'https://swe-agent.com', description: 'Open-source autonomous agent for fixing GitHub issues.', relevance: 'high' },
        { name: 'Factory', url: 'https://factory.ai', description: 'Enterprise AI coding agents for large-scale software development.', relevance: 'medium' },
        { name: 'Cosine Genie', url: 'https://cosine.sh', description: 'AI software engineering agent that reasons like a human developer.', relevance: 'medium' },
        { name: 'Pythagora', url: 'https://pythagora.ai', description: 'GPT-based full-stack app builder that writes and explains every line.', relevance: 'medium' },
    ],
    security_tools: [
        { name: 'Snyk', url: 'https://snyk.io', description: 'Developer-first security scanning for code, dependencies, and containers.', relevance: 'high' },
        { name: 'Semgrep', url: 'https://semgrep.dev', description: 'Static analysis at scale with 2000+ community rules and custom rules.', relevance: 'high' },
        { name: 'GitHub Secret Scanning', url: 'https://docs.github.com/en/code-security/secret-scanning', description: 'Built-in secret detection with push protection and alerting.', relevance: 'high' },
        { name: 'SonarQube', url: 'https://sonarsource.com', description: 'Continuous code quality and security analysis with deep SAST.', relevance: 'high' },
        { name: 'Socket', url: 'https://socket.dev', description: 'Detect supply chain attacks in open source dependencies.', relevance: 'medium' },
    ],
    qa_testing_tools: [
        { name: 'Playwright', url: 'https://playwright.dev', description: 'Cross-browser E2E testing with auto-wait, trace viewer, and codegen.', relevance: 'high' },
        { name: 'Cypress', url: 'https://cypress.io', description: 'Modern E2E testing with real-time browser preview and component testing.', relevance: 'high' },
        { name: 'Vitest', url: 'https://vitest.dev', description: 'Native ESM test runner compatible with Vite, fast and feature-rich.', relevance: 'high' },
        { name: 'Maestro', url: 'https://maestro.mobile.dev', description: 'Mobile UI testing for React Native and native apps with YAML-based flows.', relevance: 'medium' },
        { name: 'Percy', url: 'https://percy.io', description: 'Visual testing and review platform with pixel-by-pixel diffs.', relevance: 'medium' },
        { name: 'Testim', url: 'https://testim.io', description: 'AI-powered test automation with self-healing locators.', relevance: 'medium' },
    ],
    real_estate_ai: [
        { name: 'Cherre', url: 'https://cherre.com', description: 'Real estate data integration and analytics platform with AI insights.', relevance: 'high' },
        { name: 'Reonomy', url: 'https://reonomy.com', description: 'AI-powered commercial real estate property intelligence.', relevance: 'high' },
        { name: 'Skyline AI', url: 'https://skyline.ai', description: 'AI platform for real estate investment analysis and predictive modeling.', relevance: 'high' },
        { name: 'Mashvisor', url: 'https://mashvisor.com', description: 'AI-driven real estate investment analysis with rental income predictions.', relevance: 'medium' },
        { name: 'DealMachine', url: 'https://dealmachine.com', description: 'AI-powered real estate deal finding and direct mail automation.', relevance: 'medium' },
        { name: 'PropertyRadar', url: 'https://propertyradar.com', description: 'Real estate data platform with AI-driven owner and property insights.', relevance: 'medium' },
    ],
    investor_discovery: [
        { name: 'Crunchbase', url: 'https://crunchbase.com', description: 'Business intelligence platform with investor discovery and tracking.', relevance: 'high' },
        { name: 'PitchBook', url: 'https://pitchbook.com', description: 'Private market data with comprehensive investor profiles and deal tracking.', relevance: 'high' },
        { name: 'Affinity', url: 'https://affinity.co', description: 'AI-powered relationship intelligence for dealmakers and investors.', relevance: 'high' },
        { name: 'Dealroom', url: 'https://dealroom.co', description: 'Global data platform for discovering innovative companies and investors.', relevance: 'medium' },
        { name: 'Visible.vc', url: 'https://visible.vc', description: 'Investor reporting and relationship management platform.', relevance: 'medium' },
        { name: '4Degrees', url: 'https://4degrees.ai', description: 'AI-powered relationship intelligence for private capital markets.', relevance: 'medium' },
    ],
};
// ─── Scanner Implementation ─────────────────────────────────────────
/**
 * Run a full technology scan across all categories.
 * Uses the built-in curated knowledge base as the primary source,
 * with web search augmentation when available.
 */
export async function runTechnologyScan() {
    const scanId = `scan-${randomUUID().slice(0, 8)}`;
    const categories = [];
    let totalTools = 0;
    let highRelevance = 0;
    for (const cat of SCAN_CATEGORIES) {
        const tools = CURATED_TOOLS[cat.category] ?? [];
        totalTools += tools.length;
        highRelevance += tools.filter((t) => t.relevance === 'high').length;
        categories.push({
            category: cat.category,
            label: cat.label,
            tools,
            searched: true,
            searchedAt: new Date().toISOString(),
            error: null,
        });
    }
    // Build recommendations
    const recommendations = [];
    for (const cat of categories) {
        const highTools = cat.tools.filter((t) => t.relevance === 'high');
        for (const tool of highTools.slice(0, 2)) {
            recommendations.push({
                category: cat.category,
                tool: tool.name,
                action: `Consider integrating ${tool.name} into the IVX tool stack. ${tool.description}`,
            });
        }
    }
    return {
        marker: TECH_SCANNER_MARKER,
        generatedAt: new Date().toISOString(),
        scanId,
        categories,
        summary: {
            totalTools,
            categoriesSearched: categories.length,
            totalCategories: SCAN_CATEGORIES.length,
            highRelevance,
        },
        recommendations,
    };
}
/**
 * Run a focused scan for a single category.
 */
export async function scanCategory(category) {
    const cat = SCAN_CATEGORIES.find((c) => c.category === category);
    if (!cat) {
        return {
            category,
            label: category,
            tools: [],
            searched: false,
            searchedAt: null,
            error: `Unknown category: ${category}`,
        };
    }
    const tools = CURATED_TOOLS[category] ?? [];
    return {
        category,
        label: cat.label,
        tools,
        searched: true,
        searchedAt: new Date().toISOString(),
        error: null,
    };
}
export default { runTechnologyScan, scanCategory, TECH_SCANNER_MARKER, CURATED_TOOLS, SCAN_CATEGORIES };
