/**
 * IVX Opportunity store — durable persistence for the Opportunity Intelligence Engine.
 *
 * Owner-only. Mirrors the proven `ivx-innovation-store` / `ivx-audit-item-store`
 * durability pattern (append-only JSONL log = source of truth + materialised JSON
 * state for fast reads, survives process restarts).
 *
 * Two record families:
 *   opportunities — scored, ranked high-upside opportunities (7 categories) with a
 *                   profit-ladder model, an execution plan, evidence, and explicit
 *                   risk + legal/compliance warnings.
 *   alerts        — owner alerts the engine raises (high-upside, investor match,
 *                   undervalued deal, urgent deadline, financing path, market move,
 *                   acquisition target).
 *
 * Layout (durable across restarts):
 *   logs/audit/opportunity/opportunities.jsonl  append-only event log
 *   logs/audit/opportunity/opportunities.json   materialised current state
 *   logs/audit/opportunity/alerts.jsonl         append-only event log
 *   logs/audit/opportunity/alerts.json          materialised current state
 *
 * Runtime-light + deterministic: only filesystem I/O, no AI/network. Fully
 * unit-testable. All scores are clamped to 0–100 integers.
 *
 * HARD RULES (encoded throughout the engine that writes here):
 *   - Never promise guaranteed profit. Never fabricate ROI / upside numbers.
 *   - Unknown economics stay `null` (not invented).
 *   - Every opportunity carries a legal/compliance warning + risk warnings.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_OPPORTUNITY_MARKER = 'ivx-opportunity-intelligence-2026-05-30';
const OPPORTUNITY_ROOT = path.join(process.cwd(), 'logs', 'audit', 'opportunity');
const VALID_CATEGORIES = new Set([
    'real_estate', 'distressed_asset', 'financing', 'investor', 'arbitrage', 'partnership', 'technology_business',
]);
const VALID_STATUS = new Set([
    'new', 'watching', 'pursuing', 'dismissed', 'closed',
]);
const VALID_ALERT_TYPES = new Set([
    'high_upside', 'investor_match', 'undervalued_deal', 'urgent_deadline', 'financing_path', 'market_movement', 'acquisition_target',
]);
const IDEAS_STATE = path.join(OPPORTUNITY_ROOT, 'opportunities.json');
const ALERTS_STATE = path.join(OPPORTUNITY_ROOT, 'alerts.json');
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
/** Clamp any input to a 0–100 integer score. */
export function clampScore(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}
function normalizeScores(input) {
    return {
        evidence: clampScore(input?.evidence),
        risk: clampScore(input?.risk),
        speed: clampScore(input?.speed),
        capital: clampScore(input?.capital),
        upside: clampScore(input?.upside),
    };
}
/**
 * Blend the five ranking dimensions into one 0–100 attractiveness score.
 * Evidence + upside dominate, but a high-upside opportunity with no evidence or
 * impractical risk/capital is correctly pulled down. Deterministic + testable.
 */
export function computeOverallScore(scores) {
    const blended = scores.evidence * 0.26 +
        scores.upside * 0.24 +
        scores.risk * 0.2 +
        scores.speed * 0.16 +
        scores.capital * 0.14;
    return clampScore(blended);
}
async function readJsonFile(file, fallback) {
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeJsonFile(file, value) {
    await mkdir(OPPORTUNITY_ROOT, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(logFile, event) {
    await mkdir(OPPORTUNITY_ROOT, { recursive: true });
    await appendFile(path.join(OPPORTUNITY_ROOT, logFile), `${JSON.stringify(event)}\n`, 'utf8');
}
const DEFAULT_LEGAL_WARNING = 'Decision support only — not financial, investment, tax, or legal advice. No profit is guaranteed. ' +
    'Verify every figure against primary documents and confirm regulatory/securities/AML compliance with licensed counsel before committing capital.';
const EMPTY_EXECUTION_PLAN = {
    actionPlan: [],
    contacts: [],
    documentsNeeded: [],
    fundingPath: '',
    expectedUpside: '',
    worstCaseRisk: '',
    nextThreeActions: [],
};
function sanitizeNumber(value) {
    if (value === null || value === undefined)
        return null;
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
export async function listOpportunities() {
    const items = await readJsonFile(IDEAS_STATE, []);
    return [...items].sort((a, b) => b.overall - a.overall || b.updatedAt.localeCompare(a.updatedAt));
}
/**
 * Insert opportunities, de-duplicating by normalized title so repeated scans
 * refresh in place instead of creating duplicates. Returns the ranked list.
 */
export async function upsertOpportunities(inputs) {
    const existing = await readJsonFile(IDEAS_STATE, []);
    const byKey = new Map(existing.map((item) => [item.title.trim().toLowerCase(), item]));
    for (const input of inputs) {
        const key = input.title.trim().toLowerCase();
        if (!key)
            continue;
        const prior = byKey.get(key);
        const scores = normalizeScores(input.scores);
        const opportunity = {
            id: prior?.id ?? createId('opp'),
            title: input.title.trim(),
            summary: input.summary.trim(),
            category: VALID_CATEGORIES.has(input.category) ? input.category : 'real_estate',
            capitalRequiredUsd: sanitizeNumber(input.capitalRequiredUsd),
            upsideLowUsd: sanitizeNumber(input.upsideLowUsd),
            upsideHighUsd: sanitizeNumber(input.upsideHighUsd),
            timeline: input.timeline.trim() || 'unspecified',
            scores,
            overall: computeOverallScore(scores),
            confidence: clampScore(input.confidence ?? scores.evidence),
            evidence: input.evidence.trim(),
            evidenceLinks: (input.evidenceLinks ?? []).map((l) => l.trim()).filter(Boolean),
            riskWarnings: (input.riskWarnings ?? []).map((r) => r.trim()).filter(Boolean),
            legalWarning: (input.legalWarning ?? DEFAULT_LEGAL_WARNING).trim(),
            nextActions: (input.nextActions ?? []).map((a) => a.trim()).filter(Boolean),
            profitLadder: input.profitLadder ?? [],
            executionPlan: input.executionPlan ?? EMPTY_EXECUTION_PLAN,
            // Never silently reset a reviewed opportunity back to new.
            status: prior?.status ?? 'new',
            createdAt: prior?.createdAt ?? nowIso(),
            updatedAt: nowIso(),
        };
        byKey.set(key, opportunity);
        await appendEvent('opportunities.jsonl', { type: 'upsert', opportunity, at: opportunity.updatedAt });
    }
    const next = Array.from(byKey.values());
    await writeJsonFile(IDEAS_STATE, next);
    return [...next].sort((a, b) => b.overall - a.overall);
}
export async function setOpportunityStatus(opportunityId, status) {
    if (!VALID_STATUS.has(status))
        return null;
    const items = await readJsonFile(IDEAS_STATE, []);
    const index = items.findIndex((item) => item.id === opportunityId);
    if (index === -1)
        return null;
    const updated = { ...items[index], status, updatedAt: nowIso() };
    items[index] = updated;
    await appendEvent('opportunities.jsonl', { type: 'set_status', opportunityId, status, at: updated.updatedAt });
    await writeJsonFile(IDEAS_STATE, items);
    return updated;
}
export async function listAlerts(limit = 100) {
    const items = await readJsonFile(ALERTS_STATE, []);
    return [...items]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(1, limit));
}
/**
 * Raise alerts, de-duplicating by (type + opportunityId + message) so repeated
 * scans don't spam the owner with the same alert.
 */
export async function raiseAlerts(inputs) {
    const existing = await readJsonFile(ALERTS_STATE, []);
    const seen = new Set(existing.map((a) => `${a.type}::${a.opportunityId ?? ''}::${a.message}`));
    const created = [];
    for (const input of inputs) {
        if (!VALID_ALERT_TYPES.has(input.type))
            continue;
        const message = input.message.trim();
        if (!message)
            continue;
        const dedupeKey = `${input.type}::${input.opportunityId ?? ''}::${message}`;
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        const alert = {
            id: createId('alert'),
            opportunityId: input.opportunityId?.trim() || null,
            type: input.type,
            severity: input.severity ?? 'info',
            message,
            acknowledged: false,
            createdAt: nowIso(),
        };
        existing.push(alert);
        created.push(alert);
        await appendEvent('alerts.jsonl', { type: 'raise', alert, at: alert.createdAt });
    }
    if (created.length > 0) {
        await writeJsonFile(ALERTS_STATE, existing);
    }
    return created;
}
export async function acknowledgeAlert(alertId) {
    const items = await readJsonFile(ALERTS_STATE, []);
    const index = items.findIndex((item) => item.id === alertId);
    if (index === -1)
        return null;
    const updated = { ...items[index], acknowledged: true };
    items[index] = updated;
    await appendEvent('alerts.jsonl', { type: 'acknowledge', alertId, at: nowIso() });
    await writeJsonFile(ALERTS_STATE, items);
    return updated;
}
