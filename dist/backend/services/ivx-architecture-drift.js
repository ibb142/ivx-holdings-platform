/**
 * IVX architecture-drift detector.
 *
 * Captures a compact structural snapshot of the codebase (from the existing
 * code-index + code-graph summaries) and compares it against a persisted
 * baseline. Drift = the deltas that matter for maintainability and risk:
 * file/service/API/route/dependency growth, new import cycles, and new
 * dependency hotspots. Each drift entry carries a signed delta + severity so
 * the continuous-improvement system can propose evidence-backed action.
 *
 * The comparison core (`compareArchitectureSnapshots`) is pure and unit-testable;
 * the baseline is persisted to `logs/audit/architecture-baseline.json`.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCodeIndexSummary } from './ivx-code-index';
import { getCodeGraphSummary } from './ivx-code-graph';
export const ARCHITECTURE_DRIFT_MARKER = 'ivx-architecture-drift-2026-06-02';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_FILE = path.join(SERVER_ROOT, 'logs', 'audit', 'architecture-baseline.json');
const ZERO_SNAPSHOT = {
    capturedAt: '',
    files: 0,
    services: 0,
    apis: 0,
    routes: 0,
    dependencies: 0,
    appScreens: 0,
    cycles: 0,
    topHotspotDegree: 0,
    available: false,
};
/** Build the current structural snapshot from the live code-index + code-graph summaries. */
export async function captureArchitectureSnapshot() {
    const [index, graph] = await Promise.all([
        getCodeIndexSummary().catch(() => null),
        getCodeGraphSummary().catch(() => null),
    ]);
    const totals = index?.totals ?? null;
    const topHotspotDegree = graph?.hotspots?.[0]?.dependents ?? 0;
    return {
        capturedAt: new Date().toISOString(),
        files: totals?.files ?? 0,
        services: totals?.services ?? 0,
        apis: totals?.apis ?? 0,
        routes: totals?.routes ?? 0,
        dependencies: totals?.dependencies ?? 0,
        appScreens: totals?.appScreens ?? 0,
        cycles: graph?.totals?.cycles ?? 0,
        topHotspotDegree,
        available: Boolean(index?.available || graph?.available),
    };
}
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
/** Classify the severity of a single metric's growth. `cycles` growth is always high. */
function classifyMetricDrift(metric, delta) {
    if (delta === 0)
        return 'none';
    if (metric === 'cycles') {
        if (delta > 0)
            return delta >= 3 ? 'critical' : 'high';
        return 'low'; // cycles removed → low (improvement, still report)
    }
    if (metric === 'topHotspotDegree') {
        if (delta >= 10)
            return 'high';
        if (delta >= 4)
            return 'medium';
        return delta > 0 ? 'low' : 'none';
    }
    // Count metrics (files/services/apis/routes/dependencies/appScreens).
    const growth = Math.abs(delta);
    if (delta < 0)
        return 'low'; // shrinkage is informational, not a risk
    if (metric === 'dependencies' && growth >= 5)
        return 'high';
    if (growth >= 25)
        return 'high';
    if (growth >= 10)
        return 'medium';
    return 'low';
}
function noteForMetric(metric, delta) {
    const dir = delta > 0 ? 'grew' : 'shrank';
    const mag = Math.abs(delta);
    switch (metric) {
        case 'cycles':
            return delta > 0
                ? `Import cycles ${dir} by ${mag} — new circular dependencies increase fragility and blast radius.`
                : `Import cycles ${dir} by ${mag} — circular dependencies reduced (improvement).`;
        case 'topHotspotDegree':
            return `Top dependency hotspot ${dir} by ${mag} dependents — a single file is becoming a larger single point of change.`;
        case 'dependencies':
            return `npm dependencies ${dir} by ${mag} — new third-party surface area to audit and maintain.`;
        default:
            return `${metric} ${dir} by ${mag} since the baseline.`;
    }
}
const COMPARED_METRICS = [
    'files', 'services', 'apis', 'routes', 'dependencies', 'appScreens', 'cycles', 'topHotspotDegree',
];
/**
 * Pure: compare two snapshots into a drift report body (without persistence).
 * `baseline` null → no baseline yet (every metric reported as no-drift baseline=current).
 */
export function compareArchitectureSnapshots(baseline, current) {
    if (!baseline) {
        return {
            drift: [],
            overallSeverity: 'none',
            summary: 'No architecture baseline set yet — capture one to start tracking drift.',
        };
    }
    const drift = [];
    for (const metric of COMPARED_METRICS) {
        const b = Number(baseline[metric] ?? 0);
        const c = Number(current[metric] ?? 0);
        const delta = c - b;
        if (delta === 0)
            continue;
        const severity = classifyMetricDrift(metric, delta);
        drift.push({ metric, baseline: b, current: c, delta, severity, note: noteForMetric(metric, delta) });
    }
    drift.sort((a, b) => {
        const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (s !== 0)
            return s;
        return Math.abs(b.delta) - Math.abs(a.delta);
    });
    const overallSeverity = drift[0]?.severity ?? 'none';
    const risky = drift.filter((d) => d.severity === 'critical' || d.severity === 'high').length;
    const summary = drift.length === 0
        ? 'No architecture drift since the baseline.'
        : `${drift.length} metric(s) drifted since the baseline (${risky} high/critical). Top: ${drift[0].metric} ${drift[0].delta > 0 ? '+' : ''}${drift[0].delta}.`;
    return { drift, overallSeverity, summary };
}
async function readBaseline() {
    try {
        const raw = await readFile(BASELINE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...ZERO_SNAPSHOT, ...parsed, available: true };
    }
    catch {
        return null;
    }
}
/** Detect architecture drift: capture current, load baseline, compare. */
export async function detectArchitectureDrift() {
    const [baseline, current] = await Promise.all([readBaseline(), captureArchitectureSnapshot()]);
    const { drift, overallSeverity, summary } = compareArchitectureSnapshots(baseline, current);
    return {
        marker: ARCHITECTURE_DRIFT_MARKER,
        generatedAt: new Date().toISOString(),
        hasBaseline: Boolean(baseline),
        baselineCapturedAt: baseline?.capturedAt ?? null,
        baseline,
        current,
        drift,
        overallSeverity,
        summary,
    };
}
/** Persist the current snapshot as the new baseline (atomic write). */
export async function setArchitectureBaseline() {
    const current = await captureArchitectureSnapshot();
    await mkdir(path.dirname(BASELINE_FILE), { recursive: true });
    const tmp = `${BASELINE_FILE}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8');
    await rename(tmp, BASELINE_FILE);
    return current;
}
