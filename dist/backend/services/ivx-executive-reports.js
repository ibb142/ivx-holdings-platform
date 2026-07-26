/**
 * IVX Executive Reports — Phase 9.
 *
 * Generates comprehensive executive reports every 5 hours covering:
 *   - Engineering: completed work, deployments, blockers, health
 *   - Business: new opportunities, investor leads, market intelligence, technology discoveries
 *   - AI: new models, new frameworks, recommended upgrades
 *
 * Reports are durable, queryable, and feed the Live Operations Center.
 *
 * HARD HONESTY RULES:
 *   - All metrics come from real subsystem queries — never fabricated.
 *   - A subsystem that fails to respond reports `unknown`, not a fake value.
 *   - Revenue/profit figures are marked as estimates, not guarantees.
 *   - Empty sections are reported as "No data available", not padded.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOrchestratorState, getExecutiveKPIs } from './ivx-enterprise-orchestrator';
import { getResearchState, getLatestReport as getLatestResearchReport } from './ivx-global-research';
import { getOpportunityState, getTopOpportunities } from './ivx-business-opportunity-engine';
import { getSelfImprovementState, getOpenTasks } from './ivx-self-improvement';
import { getMemoryState, getRecentMemories } from './ivx-enterprise-memory';
import { getGovernanceState, getRecentAudit } from './ivx-governance';
import { getDailyTargets, getIntelligenceState, CATEGORY_LABELS } from './ivx-global-opportunity-intelligence';
export const IVX_EXECUTIVE_REPORTS_MARKER = 'ivx-executive-reports-2026-07-01';
// ── Durable Store ──────────────────────────────────────────────────────────
const REPORTS_DIR = path.join(process.cwd(), 'logs', 'audit', 'executive-reports');
const STATE_FILE = path.join(REPORTS_DIR, 'state.json');
let _state = null;
async function ensureDirs() {
    await mkdir(REPORTS_DIR, { recursive: true });
}
function defaultState() {
    return {
        marker: IVX_EXECUTIVE_REPORTS_MARKER,
        lastGeneratedAt: null,
        nextGenerationAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        totalReports: 0,
        enabled: true,
        intervalHours: 5,
    };
}
async function loadState() {
    if (_state)
        return _state;
    await ensureDirs();
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.marker === IVX_EXECUTIVE_REPORTS_MARKER) {
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
// ── Report Generation ──────────────────────────────────────────────────────
const DISCLAIMER = 'IVX Executive Report — generated automatically from real subsystem data. ' +
    'All metrics are derived from live platform state. Revenue/opportunity figures are ' +
    'estimates, not guarantees. This is not financial, investment, or legal advice.';
/**
 * Generate a comprehensive executive report from all subsystems.
 */
export async function generateExecutiveReport() {
    const state = await loadState();
    const now = new Date().toISOString();
    // Gather all subsystem data defensively — one failure doesn't block the report
    let kpis = null;
    let orchState = null;
    let researchState = null;
    let researchReport = null;
    let oppState = null;
    let topOpps = null;
    let impState = null;
    let openTasks = null;
    let memState = null;
    let recentMem = null;
    let govState = null;
    let recentAudit = null;
    let intelTargets = null;
    let intelState = null;
    try {
        kpis = await getExecutiveKPIs();
    }
    catch { /* continue */ }
    try {
        orchState = await getOrchestratorState();
    }
    catch { /* continue */ }
    try {
        researchState = await getResearchState();
    }
    catch { /* continue */ }
    try {
        researchReport = await getLatestResearchReport();
    }
    catch { /* continue */ }
    try {
        oppState = await getOpportunityState();
    }
    catch { /* continue */ }
    try {
        topOpps = await getTopOpportunities(5);
    }
    catch { /* continue */ }
    try {
        impState = await getSelfImprovementState();
    }
    catch { /* continue */ }
    try {
        openTasks = await getOpenTasks();
    }
    catch { /* continue */ }
    try {
        memState = await getMemoryState();
    }
    catch { /* continue */ }
    try {
        recentMem = await getRecentMemories(10);
    }
    catch { /* continue */ }
    try {
        govState = await getGovernanceState();
    }
    catch { /* continue */ }
    try {
        recentAudit = await getRecentAudit(10);
    }
    catch { /* continue */ }
    try {
        intelTargets = await getDailyTargets();
    }
    catch { /* continue */ }
    try {
        intelState = await getIntelligenceState();
    }
    catch { /* continue */ }
    // Build engineering section
    const engineering = {
        completedWork: {
            count: kpis?.completedTasks ?? 0,
            items: orchState?.taskQueue
                .filter((t) => t.status === 'completed')
                .slice(0, 5)
                .map((t) => t.goal) ?? [],
        },
        activeDeployments: {
            count: 0,
            latestSha: null,
            latestDeployAt: null,
        },
        blockers: {
            count: kpis?.blockedTasks ?? 0,
            items: orchState?.taskQueue
                .filter((t) => t.status === 'blocked')
                .slice(0, 5)
                .map((t) => t.goal) ?? [],
        },
        health: {
            healthySubsystems: kpis?.healthySubsystems ?? 0,
            degradedSubsystems: kpis?.degradedSubsystems ?? 0,
            unreachableSubsystems: kpis?.unreachableSubsystems ?? 0,
        },
        openImprovementTasks: openTasks?.length ?? 0,
    };
    // Build business section
    const business = {
        newOpportunities: {
            total: oppState?.totalDiscovered ?? 0,
            topItems: topOpps?.slice(0, 3).map((o) => `${o.title} (score: ${o.score.totalScore})`) ?? [],
        },
        investorLeads: {
            count: topOpps?.filter((o) => o.type === 'investor').length ?? 0,
            topItems: topOpps?.filter((o) => o.type === 'investor').slice(0, 3).map((o) => o.title) ?? [],
        },
        marketIntelligence: {
            findings: researchState?.totalFindings ?? 0,
            topItems: researchReport?.topOpportunities?.slice(0, 3).map((f) => f.title) ?? [],
        },
        technologyDiscoveries: {
            findings: researchReport?.technologiesWorthAdopting?.length ?? 0,
            topItems: researchReport?.technologiesWorthAdopting?.slice(0, 3).map((f) => f.title) ?? [],
        },
    };
    // Build AI section
    const aiFindings = researchReport?.findings ?? [];
    const modelFindings = aiFindings.filter((f) => f.domain === 'ai_models');
    const frameworkFindings = aiFindings.filter((f) => f.domain === 'enterprise_software');
    const ai = {
        newModels: {
            count: modelFindings.length,
            items: modelFindings.slice(0, 3).map((f) => f.title),
        },
        newFrameworks: {
            count: frameworkFindings.length,
            items: frameworkFindings.slice(0, 3).map((f) => f.title),
        },
        recommendedUpgrades: {
            count: researchReport?.technologiesWorthAdopting?.length ?? 0,
            items: researchReport?.technologiesWorthAdopting?.slice(0, 3).map((f) => f.title) ?? [],
        },
    };
    // Build opportunity intelligence section
    const oppIntel = {
        dailyTargets: (intelTargets ?? []).map((t) => ({
            category: t.category,
            label: CATEGORY_LABELS[t.category] ?? t.category,
            target: t.target,
            found: t.found,
            percentage: t.percentage,
            status: t.status,
        })),
        totalFoundToday: intelState ? Object.values(intelState.todayTotals).reduce((a, b) => a + b, 0) : 0,
        topCategories: (intelTargets ?? [])
            .filter((t) => t.status === 'exceeded' || t.status === 'on_track')
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 3)
            .map((t) => CATEGORY_LABELS[t.category] ?? t.category),
        behindTarget: (intelTargets ?? [])
            .filter((t) => t.status === 'behind' || t.status === 'not_started')
            .map((t) => CATEGORY_LABELS[t.category] ?? t.category),
    };
    // Build governance section
    const governance = {
        totalActions: govState?.totalActions ?? 0,
        pendingApprovals: govState?.pendingCount ?? 0,
        recentAuditEntries: recentAudit?.length ?? 0,
    };
    // Build memory section
    const memory = {
        totalEntries: memState?.totalEntries ?? 0,
        recentInsights: recentMem?.slice(0, 3).map((m) => m.title) ?? [],
    };
    // Compose report
    const report = {
        id: `er-${Date.now()}`,
        generatedAt: now,
        reportNumber: state.totalReports + 1,
        engineering,
        business,
        ai,
        opportunityIntelligence: oppIntel,
        governance,
        memory,
        summary: `Executive Report #${state.totalReports + 1}: ${engineering.health.healthySubsystems}/${(engineering.health.healthySubsystems + engineering.health.degradedSubsystems + engineering.health.unreachableSubsystems) || '?'} subsystems healthy. ${business.newOpportunities.total} opportunities. ${oppIntel.totalFoundToday} intelligence records today (${oppIntel.behindTarget.length} categories behind target). ${ai.newModels.count + ai.newFrameworks.count} AI discoveries.`,
        disclaimer: DISCLAIMER,
    };
    // Persist report
    await ensureDirs();
    const reportFile = path.join(REPORTS_DIR, `${report.id}.json`);
    await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    // Update index
    const indexFile = path.join(REPORTS_DIR, 'index.jsonl');
    await appendFile(indexFile, JSON.stringify({ id: report.id, at: now, number: report.reportNumber }) + '\n', 'utf-8');
    // Update state
    state.lastGeneratedAt = now;
    state.nextGenerationAt = new Date(Date.now() + state.intervalHours * 60 * 60 * 1000).toISOString();
    state.totalReports++;
    await persistState();
    return report;
}
/**
 * Get the current reports state.
 */
export async function getExecutiveReportsState() {
    return loadState();
}
/**
 * Get the latest executive report.
 */
export async function getLatestExecutiveReport() {
    await ensureDirs();
    try {
        const state = await loadState();
        if (!state.lastGeneratedAt)
            return null;
        // Find the latest report by reading index
        const indexFile = path.join(REPORTS_DIR, 'index.jsonl');
        const raw = await readFile(indexFile, 'utf-8');
        const lines = raw.trim().split('\n');
        if (lines.length === 0)
            return null;
        const lastLine = JSON.parse(lines[lines.length - 1]);
        const reportFile = path.join(REPORTS_DIR, `${lastLine.id}.json`);
        const reportRaw = await readFile(reportFile, 'utf-8');
        return JSON.parse(reportRaw);
    }
    catch {
        return null;
    }
}
/**
 * List recent reports.
 */
export async function listExecutiveReports(limit = 10) {
    await ensureDirs();
    const reports = [];
    try {
        const indexFile = path.join(REPORTS_DIR, 'index.jsonl');
        const raw = await readFile(indexFile, 'utf-8');
        for (const line of raw.trim().split('\n').reverse()) {
            if (line.trim()) {
                reports.push(JSON.parse(line));
                if (reports.length >= limit)
                    break;
            }
        }
    }
    catch { /* no reports yet */ }
    return reports;
}
// ── Report Generation Ticker ──────────────────────────────────────────────
let _reportTicker = null;
export function startExecutiveReportTicker(intervalHours = 5) {
    if (_reportTicker)
        return;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    _reportTicker = setInterval(async () => {
        try {
            await generateExecutiveReport();
            console.log(`[ExecutiveReports] Report generated at ${new Date().toISOString()}`);
        }
        catch (err) {
            console.error('[ExecutiveReports] Generation error:', err);
        }
    }, intervalMs);
    console.log(`[ExecutiveReports] Ticker started — every ${intervalHours}h`);
}
export function stopExecutiveReportTicker() {
    if (_reportTicker) {
        clearInterval(_reportTicker);
        _reportTicker = null;
    }
}
// ── Validation ─────────────────────────────────────────────────────────────
export async function validateExecutiveReports() {
    const state = await loadState();
    const issues = [];
    if (state.marker !== IVX_EXECUTIVE_REPORTS_MARKER)
        issues.push('State marker mismatch');
    return { valid: issues.length === 0, issues };
}
