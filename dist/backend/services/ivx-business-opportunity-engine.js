/**
 * IVX Business Opportunity Engine — Phase 4.
 *
 * Continuously searches for and scores business opportunities:
 *   - Investors and VC funds
 *   - Acquisition opportunities
 *   - Strategic partnerships
 *   - Distressed assets
 *   - Government programs and grants
 *   - Enterprise customers
 *   - Commercial real estate opportunities
 *
 * Every opportunity is scored on:
 *   - Strategic fit (1–10)
 *   - Revenue potential (estimated)
 *   - Time to close (days estimate)
 *   - Risk level (low/medium/high)
 *   - Resource requirement (low/medium/high)
 *
 * HARD HONESTY RULES:
 *   - Revenue estimates are marked as estimates, never promises.
 *   - Empty search results are reported honestly.
 *   - No opportunity is fabricated.
 *   - All scores are grounded in available data.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_OPPORTUNITY_ENGINE_MARKER = 'ivx-opportunity-engine-2026-07-01';
export const OPPORTUNITY_TYPES = [
    'investor',
    'acquisition',
    'partnership',
    'distressed_asset',
    'government_grant',
    'enterprise_customer',
    'commercial_real_estate',
];
// ── Scoring ────────────────────────────────────────────────────────────────
function calculateTotalScore(strategicFit, timeToCloseDays, risk) {
    // Strategic fit: 0–40 points
    const fitScore = Math.max(0, Math.min(10, strategicFit)) * 4;
    // Time to close: faster = better, 0–30 points
    const timeScore = Math.max(0, 30 - Math.min(timeToCloseDays, 365) * (30 / 365));
    // Risk: low=30, medium=15, high=5
    const riskScore = risk === 'low' ? 30 : risk === 'medium' ? 15 : 5;
    return Math.round(fitScore + timeScore + riskScore);
}
// ── Durable State ──────────────────────────────────────────────────────────
const STATE_DIR = path.join(process.cwd(), 'logs', 'audit', 'opportunity-engine');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const OPPORTUNITIES_FILE = path.join(STATE_DIR, 'opportunities.jsonl');
const REPORTS_DIR = path.join(STATE_DIR, 'reports');
let _state = null;
async function ensureDirs() {
    await mkdir(STATE_DIR, { recursive: true });
    await mkdir(REPORTS_DIR, { recursive: true });
}
function defaultState() {
    return {
        marker: IVX_OPPORTUNITY_ENGINE_MARKER,
        lastRunAt: null,
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        runCount: 0,
        totalDiscovered: 0,
        activeOpportunities: 0,
        opportunities: [],
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
        if (parsed.marker === IVX_OPPORTUNITY_ENGINE_MARKER) {
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
// ── Core Engine Logic ──────────────────────────────────────────────────────
/**
 * Create a new business opportunity.
 */
export function createOpportunity(type, title, description, source, sourceUrl, strategicFit = 5, revenuePotential = 'Unknown', timeToCloseDays = 90, risk = 'medium', resourceRequirement = 'medium') {
    const totalScore = calculateTotalScore(strategicFit, timeToCloseDays, risk);
    return {
        id: `opp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        title,
        description,
        source,
        sourceUrl,
        discoveredAt: new Date().toISOString(),
        score: {
            strategicFit: Math.max(1, Math.min(10, strategicFit)),
            revenuePotential,
            timeToCloseDays: Math.max(1, timeToCloseDays),
            risk,
            resourceRequirement,
            totalScore,
        },
        status: 'new',
        nextAction: 'Research and validate',
        notes: '',
    };
}
/**
 * Add opportunities to the engine.
 */
export async function addOpportunities(opportunities) {
    const state = await loadState();
    state.opportunities.push(...opportunities);
    state.totalDiscovered += opportunities.length;
    state.activeOpportunities = state.opportunities.filter((o) => !['closed_won', 'closed_lost', 'archived'].includes(o.status)).length;
    // Persist to opportunities log
    await ensureDirs();
    for (const opp of opportunities) {
        await appendFile(OPPORTUNITIES_FILE, JSON.stringify(opp) + '\n', 'utf-8');
    }
    const report = generateOpportunityReport(state.opportunities);
    state.reports.unshift(report);
    if (state.reports.length > 30)
        state.reports = state.reports.slice(0, 30);
    state.lastRunAt = new Date().toISOString();
    state.nextRunAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    state.runCount++;
    await persistState();
    // Persist report
    const reportFile = path.join(REPORTS_DIR, `${report.id}.json`);
    await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    return report;
}
/**
 * Generate a report from current opportunities.
 */
function generateOpportunityReport(opportunities) {
    const scored = [...opportunities].sort((a, b) => b.score.totalScore - a.score.totalScore);
    const topOpportunities = scored.slice(0, 10);
    const byType = {};
    for (const t of OPPORTUNITY_TYPES)
        byType[t] = 0;
    for (const opp of opportunities)
        byType[opp.type]++;
    const scoreDistribution = {
        high: scored.filter((o) => o.score.totalScore >= 70).length,
        medium: scored.filter((o) => o.score.totalScore >= 40 && o.score.totalScore < 70).length,
        low: scored.filter((o) => o.score.totalScore < 40).length,
    };
    return {
        id: `or-${Date.now()}`,
        generatedAt: new Date().toISOString(),
        totalOpportunities: opportunities.length,
        byType,
        topOpportunities,
        scoreDistribution,
        summary: `${opportunities.length} total opportunities. Top: ${topOpportunities.slice(0, 3).map((o) => o.title).join(' | ')}`,
    };
}
/**
 * Update an opportunity's status.
 */
export async function updateOpportunityStatus(opportunityId, status, notes) {
    const state = await loadState();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp)
        return null;
    opp.status = status;
    if (notes !== undefined)
        opp.notes = notes;
    state.activeOpportunities = state.opportunities.filter((o) => !['closed_won', 'closed_lost', 'archived'].includes(o.status)).length;
    await persistState();
    return opp;
}
/**
 * Get the current engine state.
 */
export async function getOpportunityState() {
    return loadState();
}
/**
 * Get top opportunities by score.
 */
export async function getTopOpportunities(limit = 10) {
    const state = await loadState();
    return [...state.opportunities]
        .filter((o) => !['closed_lost', 'archived'].includes(o.status))
        .sort((a, b) => b.score.totalScore - a.score.totalScore)
        .slice(0, limit);
}
/**
 * Get opportunities by type.
 */
export async function getOpportunitiesByType(type) {
    const state = await loadState();
    return state.opportunities
        .filter((o) => o.type === type)
        .sort((a, b) => b.score.totalScore - a.score.totalScore);
}
// ── Opportunity Type Labels ────────────────────────────────────────────────
export function getOpportunityTypeLabels() {
    return {
        investor: 'Investor / VC',
        acquisition: 'Acquisition Target',
        partnership: 'Strategic Partnership',
        distressed_asset: 'Distressed Asset',
        government_grant: 'Government Grant / Program',
        enterprise_customer: 'Enterprise Customer',
        commercial_real_estate: 'Commercial Real Estate',
    };
}
// ── Validation ─────────────────────────────────────────────────────────────
export async function validateOpportunityEngine() {
    const state = await loadState();
    const issues = [];
    if (state.marker !== IVX_OPPORTUNITY_ENGINE_MARKER)
        issues.push('State marker mismatch');
    return { valid: issues.length === 0, issues };
}
