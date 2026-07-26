/**
 * IVX Global AI Research Agent — Phase 3.
 *
 * Continuously researches worldwide AI developments:
 *   - New AI models and capabilities
 *   - AI startups and funding rounds
 *   - Research papers and breakthroughs
 *   - Enterprise software innovations
 *   - Real estate technology
 *   - Investment technology
 *   - Construction technology
 *   - Automation and robotics
 *   - Fintech innovations
 *
 * Produces ranked opportunities with:
 *   - Technology assessment
 *   - Competitor analysis
 *   - Implementation priority
 *   - Expected business impact
 *
 * HARD HONESTY RULES:
 *   - Research is real-time via web search; never fabricates findings.
 *   - Every finding includes source attribution.
 *   - Impact estimates are labeled as estimates, not guarantees.
 *   - Empty results are reported honestly, not padded.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_GLOBAL_RESEARCH_MARKER = 'ivx-global-research-2026-07-01';
export const RESEARCH_DOMAINS = [
    'ai_models',
    'ai_startups',
    'research_papers',
    'enterprise_software',
    'real_estate_tech',
    'investment_tech',
    'construction_tech',
    'automation_robotics',
    'fintech',
];
// ── Durable State ──────────────────────────────────────────────────────────
const STATE_DIR = path.join(process.cwd(), 'logs', 'audit', 'global-research');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const REPORTS_DIR = path.join(STATE_DIR, 'reports');
let _state = null;
async function ensureDirs() {
    await mkdir(STATE_DIR, { recursive: true });
    await mkdir(REPORTS_DIR, { recursive: true });
}
function defaultState() {
    return {
        marker: IVX_GLOBAL_RESEARCH_MARKER,
        lastRunAt: null,
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        runCount: 0,
        totalFindings: 0,
        reports: [],
        enabled: true,
    };
}
async function loadState() {
    if (_state)
        return _state;
    await ensureDirs();
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.marker === IVX_GLOBAL_RESEARCH_MARKER) {
            _state = parsed;
            return _state;
        }
    }
    catch { /* first run */ }
    _state = defaultState();
    await persistState();
    return _state;
}
async function persistState() {
    if (!_state)
        return;
    await ensureDirs();
    const tmp = STATE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(_state, null, 2), 'utf-8');
    await rename(tmp, STATE_FILE);
}
// ── Research Domain Configuration ──────────────────────────────────────────
const DOMAIN_CONFIG = {
    ai_models: {
        label: 'AI Models',
        searchQueries: [
            'new AI models 2026 breakthroughs',
            'latest LLM releases June 2026',
            'best AI models for enterprise 2026',
        ],
    },
    ai_startups: {
        label: 'AI Startups',
        searchQueries: [
            'AI startups funding 2026',
            'most promising AI startups 2026',
            'AI startup acquisitions 2026',
        ],
    },
    research_papers: {
        label: 'Research Papers',
        searchQueries: [
            'breakthrough AI research papers 2026',
            'arxiv AI top papers June 2026',
            'AI research trends 2026',
        ],
    },
    enterprise_software: {
        label: 'Enterprise Software',
        searchQueries: [
            'enterprise AI software trends 2026',
            'best enterprise automation platforms 2026',
            'enterprise software market 2026',
        ],
    },
    real_estate_tech: {
        label: 'Real Estate Technology',
        searchQueries: [
            'real estate AI technology 2026',
            'proptech innovations 2026',
            'commercial real estate software 2026',
        ],
    },
    investment_tech: {
        label: 'Investment Technology',
        searchQueries: [
            'investment technology trends 2026',
            'AI investment platforms 2026',
            'fintech investment innovations 2026',
        ],
    },
    construction_tech: {
        label: 'Construction Technology',
        searchQueries: [
            'construction technology innovations 2026',
            'AI construction automation 2026',
            'contech startups 2026',
        ],
    },
    automation_robotics: {
        label: 'Automation & Robotics',
        searchQueries: [
            'robotics automation breakthroughs 2026',
            'industrial AI robotics 2026',
            'autonomous systems enterprise 2026',
        ],
    },
    fintech: {
        label: 'Fintech',
        searchQueries: [
            'fintech innovations 2026',
            'AI fintech platforms 2026',
            'payment technology trends 2026',
        ],
    },
};
// ── Core Research Logic ────────────────────────────────────────────────────
/**
 * Generate search queries for a domain.
 */
export function getResearchQueries(domain) {
    return DOMAIN_CONFIG[domain]?.searchQueries ?? [];
}
/**
 * Create a finding from a raw result.
 */
export function createFinding(domain, title, summary, source, sourceUrl, relevance = 'medium', businessImpact = 'Under assessment', implementationPriority = 5) {
    return {
        id: `rf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        domain,
        title,
        summary,
        source,
        sourceUrl,
        discoveredAt: new Date().toISOString(),
        relevance,
        businessImpact,
        implementationPriority: Math.max(1, Math.min(10, implementationPriority)),
        competitorRelevance: false,
        adoptionRecommendation: 'monitor',
    };
}
/**
 * Rank findings by priority and business impact.
 */
function rankFindings(findings) {
    const relevanceWeight = {
        critical: 100,
        high: 75,
        medium: 50,
        low: 25,
    };
    return [...findings].sort((a, b) => {
        const scoreA = relevanceWeight[a.relevance] + a.implementationPriority * 5;
        const scoreB = relevanceWeight[b.relevance] + b.implementationPriority * 5;
        return scoreB - scoreA;
    });
}
/**
 * Generate a research report from findings.
 */
export async function generateResearchReport(findings) {
    const ranked = rankFindings(findings);
    const topOpportunities = ranked.slice(0, 10);
    const technologiesWorthAdopting = ranked.filter((f) => f.adoptionRecommendation === 'adopt_now');
    const domains = [...new Set(findings.map((f) => f.domain))];
    const competitorFindings = findings.filter((f) => f.competitorRelevance);
    const competitorAnalysis = competitorFindings.length > 0
        ? `${competitorFindings.length} competitor-relevant findings. ${competitorFindings.map((f) => f.title).join('; ')}`
        : 'No competitor-relevant findings this cycle.';
    const report = {
        id: `rr-${Date.now()}`,
        generatedAt: new Date().toISOString(),
        domainsCovered: domains,
        findings: ranked,
        topOpportunities,
        competitorAnalysis,
        technologiesWorthAdopting,
        summary: `Research cycle complete: ${findings.length} findings across ${domains.length} domains. ${topOpportunities.length} top opportunities identified.`,
    };
    // Persist report
    await ensureDirs();
    const reportFile = path.join(REPORTS_DIR, `${report.id}.json`);
    await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    // Update state
    const state = await loadState();
    state.lastRunAt = report.generatedAt;
    state.nextRunAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    state.runCount++;
    state.totalFindings += findings.length;
    state.reports.unshift(report);
    if (state.reports.length > 30)
        state.reports = state.reports.slice(0, 30);
    await persistState();
    return report;
}
/**
 * Run research on a specific domain (simulated — caller provides findings from web search).
 */
export async function recordResearchFindings(findings) {
    return generateResearchReport(findings);
}
/**
 * Get the current research state.
 */
export async function getResearchState() {
    return loadState();
}
/**
 * Get the latest research report.
 */
export async function getLatestReport() {
    const state = await loadState();
    return state.reports[0] ?? null;
}
/**
 * List historical reports.
 */
export async function listReports(limit = 10) {
    const state = await loadState();
    return state.reports.slice(0, limit);
}
// ── Domain Summary (for dashboard) ─────────────────────────────────────────
export function getDomainSummary() {
    return RESEARCH_DOMAINS.map((d) => ({
        domain: d,
        label: DOMAIN_CONFIG[d].label,
        queries: DOMAIN_CONFIG[d].searchQueries.length,
    }));
}
// ── Validation ─────────────────────────────────────────────────────────────
export async function validateGlobalResearch() {
    const state = await loadState();
    const issues = [];
    if (state.marker !== IVX_GLOBAL_RESEARCH_MARKER) {
        issues.push('State marker mismatch');
    }
    if (state.runCount < 0)
        issues.push('Negative run count');
    if (state.totalFindings < 0)
        issues.push('Negative findings count');
    return { valid: issues.length === 0, issues };
}
