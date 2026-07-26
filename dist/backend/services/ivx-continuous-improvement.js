/**
 * IVX Autonomous Continuous Improvement System.
 *
 * Moves IVX from autonomous EXECUTION to autonomous EVOLUTION: a daily
 * self-audit that composes the technical-debt + freeze-risk scanner, the
 * architecture-drift detector, and the existing priority queue into a single
 * set of evidence-backed improvement proposals. Each proposal carries hard
 * evidence (file:line + snippet + why) and an HONEST `safeToAutoApply` flag
 * (true only for mechanical, owner-safe categories) so the safe
 * auto-improvement planner can route low-risk work into the existing safe lane
 * while everything else stays owner-gated. No fabrication: an empty codebase
 * produces an empty, honest audit.
 *
 * The proposal builder (`buildImprovementProposals`) is pure and unit-testable;
 * `runDailySelfAudit` performs the real scans + persists a durable audit run.
 */
import { mkdir, writeFile, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWorkspaceForTechDebt, } from './ivx-tech-debt-scanner';
import { detectArchitectureDrift, } from './ivx-architecture-drift';
export const CONTINUOUS_IMPROVEMENT_MARKER = 'ivx-continuous-improvement-2026-06-02';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_DIR = path.join(SERVER_ROOT, 'logs', 'audit', 'continuous-improvement');
const INDEX_FILE = path.join(STORE_DIR, 'index.jsonl');
const LATEST_FILE = path.join(STORE_DIR, 'latest.json');
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
/** The only mechanical, behavior-preserving categories safe to route into the auto-apply lane. */
const SAFE_CATEGORIES = new Set([
    'logging_fix',
    'error_message_fix',
]);
function shortHash(input) {
    let h = 5381;
    for (let i = 0; i < input.length; i += 1)
        h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
    return h.toString(36);
}
function classifyDebtFinding(finding) {
    if (finding.kind === 'freeze_risk') {
        if (finding.marker === 'empty-catch') {
            return {
                category: 'logging_fix',
                recommended: 'Log the caught error (sanitized) instead of swallowing it, so the failure is observable.',
            };
        }
        if (finding.marker === 'noop-handler') {
            return {
                category: 'ui_fix',
                recommended: 'Wire the handler to a real action or remove the dead control — owner review required.',
            };
        }
        return {
            category: 'refactor',
            recommended: 'Implement the unfinished path or guard it behind an honest "not available" state — owner review required.',
        };
    }
    if (finding.kind === 'oversized_file') {
        return {
            category: 'refactor',
            recommended: 'Split this module into focused units to reduce blast radius — owner review required.',
        };
    }
    // debt_marker
    return {
        category: 'debt_cleanup',
        recommended: 'Resolve or formally schedule the deferred work referenced by the marker — owner review required.',
    };
}
function highestSeverity(findings) {
    return findings.reduce((acc, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[acc] ? f.severity : acc), 'low');
}
function driftSeverityToDebt(s) {
    if (s === 'critical')
        return 'critical';
    if (s === 'high')
        return 'high';
    if (s === 'medium')
        return 'medium';
    return 'low';
}
/**
 * Pure: turn the scan reports into ranked, evidence-backed improvement proposals.
 * Debt markers are grouped per (file × category) to avoid hundreds of tiny items;
 * freeze risks stay individual (high signal); drift becomes one proposal per metric.
 */
export function buildImprovementProposals(input) {
    const proposals = [];
    // --- group debt + freeze + oversized findings ---
    const groups = new Map();
    for (const finding of input.debt.findings) {
        const { category, recommended } = classifyDebtFinding(finding);
        const source = finding.kind === 'freeze_risk' ? 'freeze_risk' : 'tech_debt';
        // Freeze risks: one proposal per occurrence. Others: group per file × category.
        const key = finding.kind === 'freeze_risk'
            ? `freeze:${finding.relativePath}:${finding.line}:${finding.marker}`
            : `${category}:${finding.relativePath}`;
        const existing = groups.get(key);
        if (existing)
            existing.findings.push(finding);
        else
            groups.set(key, { category, recommended, source, findings: [finding] });
    }
    for (const [key, group] of groups) {
        const severity = highestSeverity(group.findings);
        const evidence = group.findings.slice(0, 8).map((f) => ({
            relativePath: f.relativePath,
            line: f.line,
            snippet: f.snippet,
            why: f.why,
        }));
        const file = group.findings[0]?.relativePath ?? 'unknown';
        const count = group.findings.length;
        const title = group.source === 'freeze_risk'
            ? `Freeze risk (${group.findings[0]?.marker}) in ${file}:${group.findings[0]?.line}`
            : count > 1
                ? `${count} ${group.category.replace('_', ' ')} items in ${file}`
                : `${group.category.replace('_', ' ')} in ${file}`;
        proposals.push({
            id: `imp_${shortHash(key)}`,
            title,
            category: group.category,
            severity,
            source: group.source,
            evidence,
            recommendedAction: group.recommended,
            safeToAutoApply: SAFE_CATEGORIES.has(group.category),
        });
    }
    // --- architecture drift → one proposal per drifted metric (high/critical only as actionable) ---
    for (const d of input.drift.drift) {
        if (d.severity === 'none' || d.severity === 'low')
            continue;
        proposals.push({
            id: `imp_drift_${shortHash(`${d.metric}:${d.baseline}:${d.current}`)}`,
            title: `Architecture drift: ${d.metric} ${d.delta > 0 ? '+' : ''}${d.delta}`,
            category: 'architecture',
            severity: driftSeverityToDebt(d.severity),
            source: 'architecture_drift',
            evidence: [{ relativePath: 'logs/audit/architecture-baseline.json', line: 0, snippet: `${d.metric}: ${d.baseline} → ${d.current}`, why: d.note }],
            recommendedAction: d.metric === 'cycles'
                ? 'Break the new import cycle(s) to keep the dependency graph acyclic — owner review required.'
                : 'Review the structural growth and confirm it is intentional — owner review required.',
            safeToAutoApply: false,
        });
    }
    proposals.sort((a, b) => {
        const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (sev !== 0)
            return sev;
        if (a.safeToAutoApply !== b.safeToAutoApply)
            return a.safeToAutoApply ? -1 : 1;
        return a.title.localeCompare(b.title);
    });
    return proposals;
}
function summarizeProposals(proposals) {
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const byCategory = {};
    let safe = 0;
    for (const p of proposals) {
        bySeverity[p.severity] += 1;
        byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
        if (p.safeToAutoApply)
            safe += 1;
    }
    return { totalProposals: proposals.length, safeToAutoApply: safe, bySeverity, byCategory };
}
async function persistAuditRun(run) {
    try {
        await mkdir(STORE_DIR, { recursive: true });
        const runFile = path.join(STORE_DIR, `${run.auditId}.json`);
        const tmp = `${runFile}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(run, null, 2), 'utf8');
        await rename(tmp, runFile);
        const latestTmp = `${LATEST_FILE}.${Date.now()}.tmp`;
        await writeFile(latestTmp, JSON.stringify(run, null, 2), 'utf8');
        await rename(latestTmp, LATEST_FILE);
        const indexLine = JSON.stringify({
            auditId: run.auditId,
            generatedAt: run.generatedAt,
            totalProposals: run.summary.totalProposals,
            safeToAutoApply: run.summary.safeToAutoApply,
        }) + '\n';
        await writeFile(INDEX_FILE, indexLine, { flag: 'a' });
    }
    catch {
        // Persistence failures must never break the audit; the run is still returned.
    }
}
/** Run a full daily self-audit: real scans → proposals → durable persistence. */
export async function runDailySelfAudit() {
    const start = Date.now();
    const auditId = `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const [debt, drift] = await Promise.all([
        scanWorkspaceForTechDebt().catch(() => null),
        detectArchitectureDrift().catch(() => null),
    ]);
    const safeDebt = debt ?? {
        marker: 'unavailable', generatedAt: new Date().toISOString(), root: SERVER_ROOT, durationMs: 0,
        filesScanned: 0, totals: { findings: 0, debtMarkers: 0, freezeRisks: 0, oversizedFiles: 0 },
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, findings: [],
    };
    const safeDrift = drift ?? {
        marker: 'unavailable', generatedAt: new Date().toISOString(), hasBaseline: false,
        baselineCapturedAt: null, baseline: null,
        current: { capturedAt: new Date().toISOString(), files: 0, services: 0, apis: 0, routes: 0, dependencies: 0, appScreens: 0, cycles: 0, topHotspotDegree: 0, available: false },
        drift: [], overallSeverity: 'none', summary: 'Architecture drift unavailable.',
    };
    const proposals = buildImprovementProposals({ debt: safeDebt, drift: safeDrift });
    const run = {
        marker: CONTINUOUS_IMPROVEMENT_MARKER,
        auditId,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        techDebt: { filesScanned: safeDebt.filesScanned, totals: safeDebt.totals, bySeverity: safeDebt.bySeverity },
        architectureDrift: {
            hasBaseline: safeDrift.hasBaseline,
            overallSeverity: safeDrift.overallSeverity,
            driftCount: safeDrift.drift.length,
            summary: safeDrift.summary,
        },
        proposals,
        summary: summarizeProposals(proposals),
    };
    await persistAuditRun(run);
    return run;
}
/** The most recent persisted audit run, or null if none has run yet. */
export async function getLatestSelfAudit() {
    try {
        const raw = await readFile(LATEST_FILE, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * Filter the latest (or a fresh) audit to ONLY the safe-to-auto-apply proposals,
 * ranked highest-severity first. These are the proposals the existing safe
 * auto-apply lane (BLOCK 15) may action without owner approval; everything else
 * stays owner-gated.
 */
export async function planSafeAutoImprovements(options) {
    const audit = options?.audit ?? (await getLatestSelfAudit()) ?? (await runDailySelfAudit());
    const safeProposals = audit.proposals.filter((p) => p.safeToAutoApply);
    return {
        marker: CONTINUOUS_IMPROVEMENT_MARKER,
        generatedAt: new Date().toISOString(),
        sourceAuditId: audit.auditId,
        totalProposals: audit.proposals.length,
        safeProposals,
        note: safeProposals.length === 0
            ? 'No safe-to-auto-apply proposals — every current finding needs owner review.'
            : `${safeProposals.length} mechanical, owner-safe proposal(s) eligible for the safe auto-apply lane.`,
    };
}
/** List recent audit runs (index summaries), newest first. */
export async function listSelfAudits(limit = 20) {
    try {
        const raw = await readFile(INDEX_FILE, 'utf8');
        const lines = raw.split('\n').filter(Boolean);
        const parsed = lines.map((l) => JSON.parse(l));
        return parsed.reverse().slice(0, Math.max(1, limit));
    }
    catch {
        return [];
    }
}
/** Ensure the store directory exists (used by callers that pre-create it). */
export async function ensureContinuousImprovementStore() {
    try {
        await mkdir(STORE_DIR, { recursive: true });
        await readdir(STORE_DIR);
    }
    catch {
        // best effort
    }
}
