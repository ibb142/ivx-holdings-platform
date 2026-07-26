/**
 * IVX Block 24 — Active Engineering Intelligence routes (owner-only).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { detectIncidents, ensureEngineeringIntelligenceSchema, evaluateDeployGate, computeDeployConfidence, getEngineeringDashboard, getTelemetryStats, ingestTelemetry, listDecisions, listFixOutcomes, listIncidents, listSnapshots, recordArchitectureSnapshot, recordDecision, recordFixOutcome, recordIncident, simulateFailure, } from '../services/operational-memory/engineering-intelligence';
import { OPERATIONAL_MEMORY_MARKER } from '../services/operational-memory/memory-types';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function sanitizeError(error, fallback) {
    const raw = error instanceof Error ? error.message : fallback;
    return raw
        .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
        .replace(/(apikey[=:]\s*)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
        .slice(0, 320) || fallback;
}
function getErrorStatus(error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (msg.includes('missing bearer token') || msg.includes('invalid or expired'))
        return 401;
    if (msg.includes('privileged ivx access is required'))
        return 403;
    if (msg.includes('required') || msg.includes('not configured'))
        return 503;
    return 500;
}
function errorResponse(error) {
    return ownerOnlyJson({
        ok: false,
        error: sanitizeError(error, 'IVX engineering intelligence route failed.'),
        marker: OPERATIONAL_MEMORY_MARKER,
        timestamp: new Date().toISOString(),
    }, getErrorStatus(error));
}
const VALID_AREAS = new Set([
    'deploy', 'api', 'queue', 'supabase', 'render', 'auth', 'latency', 'investor_workflow', 'unknown',
]);
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_SIMS = new Set(['deploy_failure', 'api_5xx_burst', 'auth_spike', 'queue_failure', 'investor_workflow']);
export function OPTIONS() {
    return ownerOnlyOptions();
}
export async function handleStatus(request) {
    try {
        await assertIVXOwnerOnly(request);
        await ensureEngineeringIntelligenceSchema();
        return ownerOnlyJson({
            ok: true,
            marker: OPERATIONAL_MEMORY_MARKER,
            block: 'block24-engineering-intelligence',
            tables: ['ivx_operational_memory', 'ivx_agent_tasks', 'ivx_telemetry'],
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleDashboard(request) {
    try {
        await assertIVXOwnerOnly(request);
        const dash = await getEngineeringDashboard();
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, dashboard: dash, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleDetect(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const windowMinutes = Number.parseInt(readTrimmed(url.searchParams.get('window')), 10) || 60;
        const result = await detectIncidents({ windowMinutes });
        return ownerOnlyJson({ ok: true, ...result, marker: OPERATIONAL_MEMORY_MARKER, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleListIncidents(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(readTrimmed(url.searchParams.get('limit')), 10) || 25;
        const rows = await listIncidents(limit);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, incidents: rows, count: rows.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleListDecisions(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(readTrimmed(url.searchParams.get('limit')), 10) || 25;
        const rows = await listDecisions(limit);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, decisions: rows, count: rows.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleListFixOutcomes(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(readTrimmed(url.searchParams.get('limit')), 10) || 25;
        const rows = await listFixOutcomes(limit);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, fixOutcomes: rows, count: rows.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleListSnapshots(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(readTrimmed(url.searchParams.get('limit')), 10) || 25;
        const rows = await listSnapshots(limit);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, snapshots: rows, count: rows.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleTelemetryIngest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const source = readTrimmed(body.source) || 'client';
        const area = readTrimmed(body.area) || 'unknown';
        const level = readTrimmed(body.level);
        const message = readTrimmed(body.message);
        if (!VALID_LEVELS.has(level) || !message) {
            return ownerOnlyJson({ ok: false, error: 'level (debug|info|warn|error|fatal) and message are required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const metadata = (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) ? body.metadata : {};
        const row = await ingestTelemetry({ source, area, level, message, metadata });
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, row, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleTelemetryStats(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const window = Number.parseInt(readTrimmed(url.searchParams.get('window')), 10) || 60;
        const stats = await getTelemetryStats(window);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, stats, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleConfidence(request) {
    try {
        await assertIVXOwnerOnly(request);
        const result = await computeDeployConfidence();
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, ...result, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleGate(request) {
    try {
        await assertIVXOwnerOnly(request);
        const decision = await evaluateDeployGate();
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, decision, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleRecordIncident(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const area = readTrimmed(body.area);
        const title = readTrimmed(body.title);
        const summary = readTrimmed(body.summary);
        if (!VALID_AREAS.has(area) || !title || !summary) {
            return ownerOnlyJson({ ok: false, error: 'area, title, summary required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const severityRaw = readTrimmed(body.severity);
        const severity = VALID_SEVERITIES.has(severityRaw) ? severityRaw : undefined;
        const signals = (body.signals && typeof body.signals === 'object' && !Array.isArray(body.signals)) ? body.signals : {};
        const row = await recordIncident({ area, title, summary, signals, severity });
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, incident: row, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleRecordDecision(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const kindRaw = readTrimmed(body.kind);
        const allowedKinds = ['patch', 'rollback', 'deploy', 'gate', 'note'];
        if (!allowedKinds.includes(kindRaw)) {
            return ownerOnlyJson({ ok: false, error: 'kind must be one of patch|rollback|deploy|gate|note.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const title = readTrimmed(body.title);
        const reason = readTrimmed(body.reason);
        if (!title || !reason) {
            return ownerOnlyJson({ ok: false, error: 'title and reason required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const outcomeRaw = readTrimmed(body.outcome);
        const outcome = ['pending', 'success', 'failed', 'blocked'].includes(outcomeRaw) ? outcomeRaw : 'pending';
        const metadata = (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) ? body.metadata : {};
        const row = await recordDecision({ kind: kindRaw, title, reason, outcome, metadata });
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, decision: row, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleRecordFixOutcome(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const area = readTrimmed(body.area);
        const outcomeRaw = readTrimmed(body.outcome);
        const summary = readTrimmed(body.summary);
        const outcomes = ['success', 'failed', 'partial', 'rolled_back'];
        if (!VALID_AREAS.has(area) || !outcomes.includes(outcomeRaw) || !summary) {
            return ownerOnlyJson({ ok: false, error: 'area, outcome (success|failed|partial|rolled_back), summary required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const taskId = readTrimmed(body.taskId) || null;
        const row = await recordFixOutcome({ area, outcome: outcomeRaw, summary, taskId });
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, fixOutcome: row, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleSnapshotCapture(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const label = readTrimmed(body.label) || `snapshot-${Date.now()}`;
        const data = (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ? body.data : {};
        const row = await recordArchitectureSnapshot(label, data);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, snapshot: row, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleSimulate(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const kind = readTrimmed(body.kind);
        if (!VALID_SIMS.has(kind)) {
            return ownerOnlyJson({ ok: false, error: 'kind must be one of deploy_failure|api_5xx_burst|auth_spike|queue_failure|investor_workflow.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const result = await simulateFailure(kind);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, result, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
