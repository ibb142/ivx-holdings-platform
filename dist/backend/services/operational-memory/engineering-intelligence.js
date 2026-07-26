/**
 * IVX Block 24 — Active Engineering Intelligence.
 *
 * Continuous operational awareness: monitoring, incident detection &
 * severity classification, autonomous root-cause analysis, decision &
 * fix-outcome memory, architecture snapshots, confidence scoring,
 * protected deploy gates, telemetry ingestion, and dashboard data.
 *
 * Storage strategy: reuse the existing public.ivx_operational_memory
 * vector store via category + metadata.kind, and add a small dedicated
 * public.ivx_telemetry table for high-volume client/server telemetry.
 *
 * Safety: this module never deploys, reverts, or mutates files. The
 * deploy-gate decision is advisory and surfaces through owner-approved
 * Block 21/22 routes.
 */
import { ensureOperationalMemorySchema, listMemoryByCategory, upsertMemory } from './vector-memory';
import { getOperationalSnapshot } from './operational-adapters';
import { OPERATIONAL_MEMORY_MARKER } from './memory-types';
// ---------- Telemetry table ----------
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
function getSupabaseRestBaseUrl() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    if (!url)
        throw new Error('EXPO_PUBLIC_SUPABASE_URL is required for IVX engineering intelligence.');
    return `${url}/rest/v1`;
}
function decodeJwtRole(token) {
    const seg = token.split('.')[1];
    if (!seg)
        return null;
    try {
        const padded = seg.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(seg.length / 4) * 4, '=');
        const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        return typeof parsed.role === 'string' ? parsed.role : null;
    }
    catch {
        return null;
    }
}
function getServiceRoleKey() {
    const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
    const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const role = decodeJwtRole(key);
    if (!key || key === anonKey || (role !== 'service_role' && role !== 'supabase_admin')) {
        throw new Error('A backend-only Supabase service-role key is required for engineering intelligence.');
    }
    return key;
}
function restHeaders(prefer) {
    const k = getServiceRoleKey();
    return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) };
}
async function rest(path, init = {}, prefer) {
    const r = await fetch(`${getSupabaseRestBaseUrl()}${path}`, { ...init, headers: { ...restHeaders(prefer), ...(init.headers ?? {}) } });
    const text = await r.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        }
        catch {
            payload = { message: text.slice(0, 200) };
        }
    }
    if (!r.ok) {
        const rec = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
        throw new Error(readTrimmed(rec.message) || readTrimmed(rec.error) || `HTTP ${r.status}`);
    }
    return payload;
}
async function execSql(sql) {
    const payload = await rest('/rpc/ivx_exec_sql', {
        method: 'POST',
        body: JSON.stringify({ sql_text: sql }),
    });
    return payload && typeof payload === 'object' ? payload : {};
}
let telemetrySchemaReady = null;
export async function ensureEngineeringIntelligenceSchema() {
    await ensureOperationalMemorySchema();
    if (!telemetrySchemaReady) {
        telemetrySchemaReady = (async () => {
            const stmts = [
                `create table if not exists public.ivx_telemetry (
          id text primary key default gen_random_uuid()::text,
          source text not null,
          area text not null,
          level text not null check (level in ('debug','info','warn','error','fatal')),
          message text not null,
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        )`,
                `create index if not exists ivx_telemetry_area_idx on public.ivx_telemetry (area, created_at desc)`,
                `create index if not exists ivx_telemetry_level_idx on public.ivx_telemetry (level, created_at desc)`,
                `alter table public.ivx_telemetry enable row level security`,
                `select pg_notify('pgrst','reload schema')`,
            ];
            for (const sql of stmts) {
                const r = await execSql(sql);
                if (r.ok === false) {
                    throw new Error(`Engineering intelligence schema setup failed: ${readTrimmed(r.error) || 'unknown'}`);
                }
            }
        })().catch((error) => { telemetrySchemaReady = null; throw error; });
    }
    await telemetrySchemaReady;
}
export async function ingestTelemetry(input) {
    await ensureEngineeringIntelligenceSchema();
    const payload = {
        source: input.source.slice(0, 80) || 'unknown',
        area: input.area.slice(0, 40) || 'unknown',
        level: input.level,
        message: input.message.slice(0, 2000) || '(empty)',
        metadata: input.metadata ?? {},
    };
    const rows = await rest('/ivx_telemetry?select=*', {
        method: 'POST',
        body: JSON.stringify(payload),
    }, 'return=representation');
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row)
        throw new Error('Failed to insert telemetry row.');
    return {
        id: String(row.id ?? ''),
        source: String(row.source ?? payload.source),
        area: String(row.area ?? payload.area),
        level: String(row.level ?? payload.level),
        message: String(row.message ?? payload.message),
        metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)) ? row.metadata : {},
        created_at: String(row.created_at ?? nowIso()),
    };
}
export async function getTelemetryStats(windowMinutes = 60) {
    await ensureEngineeringIntelligenceSchema();
    const minutes = Math.min(Math.max(Math.floor(windowMinutes), 1), 24 * 60);
    const sql = `
    with recent as (
      select level, area from public.ivx_telemetry
      where created_at > now() - interval '${minutes} minutes'
    )
    select
      (select count(*) from recent)::int as total,
      (select count(*) from recent where level in ('error','fatal'))::int as errors,
      (select coalesce(json_object_agg(level, c), '{}'::json) from (select level, count(*)::int as c from recent group by level) s) as by_level,
      (select coalesce(json_object_agg(area, c), '{}'::json) from (select area, count(*)::int as c from recent group by area) s) as by_area;
  `;
    const result = await execSql(sql);
    const row = Array.isArray(result.rows) ? result.rows[0] : null;
    const total = Number(row?.total ?? 0);
    const errors = Number(row?.errors ?? 0);
    const byLevel = (row?.by_level && typeof row.by_level === 'object' && !Array.isArray(row.by_level)) ? row.by_level : {};
    const byArea = (row?.by_area && typeof row.by_area === 'object' && !Array.isArray(row.by_area)) ? row.by_area : {};
    return {
        total,
        errorRate: total > 0 ? errors / total : 0,
        byLevel,
        byArea,
        windowMinutes: minutes,
    };
}
function classifySeverity(area, signal) {
    if (area === 'auth' || area === 'investor_workflow')
        return 'high';
    if (area === 'render' && signal.deployFailed === true)
        return 'critical';
    if (area === 'supabase' && signal.reachable === false)
        return 'critical';
    if (area === 'api' && Number(signal.errorRate ?? 0) >= 0.25)
        return 'critical';
    if (area === 'api' && Number(signal.errorRate ?? 0) >= 0.10)
        return 'high';
    if (area === 'latency' && Number(signal.p95Ms ?? 0) >= 5000)
        return 'high';
    if (area === 'queue' && Number(signal.failureRate ?? 0) >= 0.20)
        return 'high';
    return 'medium';
}
function buildRootCause(area, signal, snapshot) {
    const recentSha = snapshot.github.latestSha ? snapshot.github.latestSha.slice(0, 8) : 'unknown';
    const renderStatus = snapshot.render.latestDeployStatus ?? 'unknown';
    switch (area) {
        case 'deploy':
            return `Render deploy ${snapshot.render.latestDeployId ?? '?'} status=${renderStatus} on commit ${recentSha}. Likely cause: build/deploy failure or service suspension.`;
        case 'render':
            return `Render API/service unhealthy. configured=${snapshot.render.configured}, error=${snapshot.render.error ?? 'none'}.`;
        case 'supabase':
            return `Supabase reachable=${snapshot.supabase.reachable}, vector=${snapshot.supabase.vectorExtension}, opMem=${snapshot.supabase.operationalMemoryTable}. Likely cause: db credentials, network, or missing schema.`;
        case 'api':
            return `Elevated error rate ${(Number(signal.errorRate ?? 0) * 100).toFixed(1)}% over recent telemetry window. Recent commit ${recentSha}.`;
        case 'auth':
            return `Auth failure spike detected. Likely cause: token rotation, JWT_SECRET drift, or owner registration regression.`;
        case 'queue':
            return `Agent job queue failure rate ${(Number(signal.failureRate ?? 0) * 100).toFixed(1)}%.`;
        case 'latency':
            return `p95 latency ${signal.p95Ms ?? '?'}ms exceeds threshold. Recent commit ${recentSha}.`;
        case 'investor_workflow':
            return `Investor workflow signal=${JSON.stringify(signal).slice(0, 200)}. Recent commit ${recentSha}.`;
        default:
            return `Unclassified signal: ${JSON.stringify(signal).slice(0, 200)}.`;
    }
}
function makeId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
export async function recordIncident(params) {
    const signals = params.signals ?? {};
    const snapshot = await getOperationalSnapshot();
    const severity = params.severity ?? classifySeverity(params.area, signals);
    const rootCause = buildRootCause(params.area, signals, snapshot);
    const id = makeId('incident');
    const detectedAt = nowIso();
    await upsertMemory({
        category: 'incident',
        title: `[${severity.toUpperCase()}] ${params.area}: ${params.title}`.slice(0, 200),
        content: `${params.summary}\n\nROOT CAUSE: ${rootCause}\nSIGNALS: ${JSON.stringify(signals)}`,
        metadata: {
            kind: 'incident',
            incidentId: id,
            area: params.area,
            severity,
            signals,
            rootCause,
            githubSha: snapshot.github.latestSha,
            renderDeployId: snapshot.render.latestDeployId,
            detectedAt,
            marker: OPERATIONAL_MEMORY_MARKER,
        },
        source: 'engineering_intelligence',
        refId: id,
    });
    return {
        id,
        area: params.area,
        severity,
        title: params.title,
        summary: params.summary,
        rootCause,
        signals,
        detectedAt,
    };
}
/** Run all detectors against fresh operational snapshot + telemetry. */
export async function detectIncidents(options = {}) {
    await ensureEngineeringIntelligenceSchema();
    const [snapshot, telemetry] = await Promise.all([
        getOperationalSnapshot(),
        getTelemetryStats(options.windowMinutes ?? 60),
    ]);
    const incidents = [];
    // Render deploy / service health
    if (snapshot.render.configured && !snapshot.render.ok) {
        incidents.push(await recordIncident({
            area: 'render',
            title: 'Render service unhealthy',
            summary: snapshot.render.error ?? 'Render API/service health check failed.',
            signals: { configured: snapshot.render.configured, error: snapshot.render.error, status: snapshot.render.latestDeployStatus },
        }));
    }
    if (snapshot.render.latestDeployStatus && /fail|deactiv|cancel/i.test(snapshot.render.latestDeployStatus)) {
        incidents.push(await recordIncident({
            area: 'deploy',
            title: 'Latest Render deploy did not succeed',
            summary: `Latest deploy ${snapshot.render.latestDeployId} status=${snapshot.render.latestDeployStatus}.`,
            signals: { deployFailed: true, status: snapshot.render.latestDeployStatus, deployId: snapshot.render.latestDeployId },
        }));
    }
    // Supabase health
    if (snapshot.supabase.configured && !snapshot.supabase.ok) {
        incidents.push(await recordIncident({
            area: 'supabase',
            title: 'Supabase health check failed',
            summary: snapshot.supabase.error ?? 'Supabase reachable check or required schema missing.',
            signals: {
                reachable: snapshot.supabase.reachable,
                vector: snapshot.supabase.vectorExtension,
                opMem: snapshot.supabase.operationalMemoryTable,
                agentTasks: snapshot.supabase.agentTasksTable,
            },
        }));
    }
    // API error rate from telemetry
    if (telemetry.total >= 5 && telemetry.errorRate >= 0.10) {
        incidents.push(await recordIncident({
            area: 'api',
            title: 'Elevated API error rate',
            summary: `${(telemetry.errorRate * 100).toFixed(1)}% errors over ${telemetry.windowMinutes}m (${telemetry.total} events).`,
            signals: { errorRate: telemetry.errorRate, total: telemetry.total, byLevel: telemetry.byLevel },
        }));
    }
    // Auth failure spike
    const authErrors = Number(telemetry.byArea['auth'] ?? 0);
    if (authErrors >= 5) {
        incidents.push(await recordIncident({
            area: 'auth',
            title: 'Auth failure spike',
            summary: `${authErrors} auth events in ${telemetry.windowMinutes}m window.`,
            signals: { authErrors, byLevel: telemetry.byLevel },
        }));
    }
    // Queue failure
    const queueErrors = Number(telemetry.byArea['queue'] ?? 0);
    if (queueErrors >= 3) {
        incidents.push(await recordIncident({
            area: 'queue',
            title: 'Queue failures detected',
            summary: `${queueErrors} queue failures in ${telemetry.windowMinutes}m window.`,
            signals: { queueErrors, failureRate: telemetry.total > 0 ? queueErrors / telemetry.total : 0 },
        }));
    }
    // Investor workflow signal
    const investorErrors = Number(telemetry.byArea['investor_workflow'] ?? 0);
    if (investorErrors >= 1) {
        incidents.push(await recordIncident({
            area: 'investor_workflow',
            title: 'Investor workflow failure',
            summary: `${investorErrors} investor workflow errors in ${telemetry.windowMinutes}m window.`,
            signals: { investorErrors },
        }));
    }
    return { snapshot, telemetry, incidents, marker: OPERATIONAL_MEMORY_MARKER };
}
// ---------- Decisions, snapshots, fix outcomes ----------
export async function recordDecision(params) {
    const id = makeId('decision');
    const decidedAt = nowIso();
    const outcome = params.outcome ?? 'pending';
    await upsertMemory({
        category: 'note',
        title: `decision:${params.kind}:${params.title}`.slice(0, 200),
        content: `KIND: ${params.kind}\nOUTCOME: ${outcome}\nREASON: ${params.reason}`,
        metadata: { kind: 'decision', decisionKind: params.kind, decisionId: id, outcome, decidedAt, ...(params.metadata ?? {}) },
        source: 'engineering_intelligence',
        refId: id,
    });
    return { id, kind: params.kind, title: params.title, reason: params.reason, outcome, metadata: params.metadata ?? {}, decidedAt };
}
export async function recordArchitectureSnapshot(label, data) {
    const id = makeId('snapshot');
    const capturedAt = nowIso();
    await upsertMemory({
        category: 'architecture',
        title: `snapshot:${label}`.slice(0, 200),
        content: JSON.stringify(data).slice(0, 4000),
        metadata: { kind: 'architecture_snapshot', snapshotId: id, label, capturedAt, marker: OPERATIONAL_MEMORY_MARKER },
        source: 'engineering_intelligence',
        refId: id,
    });
    return { id, label, capturedAt };
}
export async function recordFixOutcome(params) {
    const id = makeId('fixoutcome');
    const decidedAt = nowIso();
    await upsertMemory({
        category: 'fix',
        title: `fix_outcome:${params.outcome}:${params.area}`.slice(0, 200),
        content: params.summary.slice(0, 4000),
        metadata: { kind: 'fix_outcome', fixOutcomeId: id, taskId: params.taskId ?? null, outcome: params.outcome, area: params.area, decidedAt },
        source: 'engineering_intelligence',
        refId: id,
    });
    return { id, taskId: params.taskId ?? null, outcome: params.outcome, area: params.area, summary: params.summary, decidedAt };
}
// ---------- Listing helpers ----------
function metaOf(row) {
    return row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
}
export async function listIncidents(limit = 25) {
    const rows = await listMemoryByCategory('incident', limit);
    return rows
        .filter((r) => metaOf(r).kind === 'incident')
        .map((r) => {
        const m = metaOf(r);
        return {
            id: String(m.incidentId ?? r.id),
            area: String(m.area ?? 'unknown'),
            severity: String(m.severity ?? 'medium'),
            title: r.title.replace(/^\[[A-Z]+\]\s+\w+:\s+/, ''),
            summary: r.content.split('\n')[0] ?? r.content,
            rootCause: String(m.rootCause ?? ''),
            signals: (m.signals && typeof m.signals === 'object' && !Array.isArray(m.signals)) ? m.signals : {},
            detectedAt: String(m.detectedAt ?? r.created_at),
        };
    });
}
export async function listDecisions(limit = 25) {
    const rows = await listMemoryByCategory('note', limit);
    return rows
        .filter((r) => metaOf(r).kind === 'decision')
        .map((r) => {
        const m = metaOf(r);
        return {
            id: String(m.decisionId ?? r.id),
            kind: String(m.decisionKind ?? 'note'),
            title: r.title.replace(/^decision:[a-z]+:/, ''),
            reason: r.content,
            outcome: String(m.outcome ?? 'pending'),
            metadata: m,
            decidedAt: String(m.decidedAt ?? r.created_at),
        };
    });
}
export async function listFixOutcomes(limit = 25) {
    const rows = await listMemoryByCategory('fix', limit);
    return rows
        .filter((r) => metaOf(r).kind === 'fix_outcome')
        .map((r) => {
        const m = metaOf(r);
        return {
            id: String(m.fixOutcomeId ?? r.id),
            taskId: m.taskId != null ? String(m.taskId) : null,
            outcome: String(m.outcome ?? 'success'),
            area: String(m.area ?? 'unknown'),
            summary: r.content,
            decidedAt: String(m.decidedAt ?? r.created_at),
        };
    });
}
export async function listSnapshots(limit = 25) {
    const rows = await listMemoryByCategory('architecture', limit);
    return rows
        .filter((r) => metaOf(r).kind === 'architecture_snapshot')
        .map((r) => {
        const m = metaOf(r);
        return {
            id: String(m.snapshotId ?? r.id),
            label: String(m.label ?? r.title.replace(/^snapshot:/, '')),
            capturedAt: String(m.capturedAt ?? r.created_at),
            data: r.content,
        };
    });
}
// ---------- Confidence + deploy gates ----------
/**
 * Compute a confidence score in [0, 1] for an upcoming deploy/patch.
 * Lower = riskier. Combines: open critical incidents, recent failed
 * fixes, telemetry error rate, and snapshot health.
 */
export async function computeDeployConfidence() {
    const [incidents, fixes, telemetry, snapshot] = await Promise.all([
        listIncidents(40),
        listFixOutcomes(40),
        getTelemetryStats(60),
        getOperationalSnapshot(),
    ]);
    const openIncidents = incidents.length;
    const criticalIncidents = incidents.filter((i) => i.severity === 'critical' || i.severity === 'high').length;
    const recentFailedFixes = fixes.filter((f) => f.outcome === 'failed' || f.outcome === 'rolled_back').length;
    const snapshotOk = snapshot.supabase.reachable && snapshot.render.ok !== false;
    const telemetryErrorRate = telemetry.errorRate;
    let score = 1;
    score -= Math.min(0.4, criticalIncidents * 0.15);
    score -= Math.min(0.2, openIncidents * 0.02);
    score -= Math.min(0.2, recentFailedFixes * 0.05);
    score -= Math.min(0.3, telemetryErrorRate * 1.5);
    if (!snapshotOk)
        score -= 0.2;
    score = Math.max(0, Math.min(1, score));
    return {
        confidence: Number(score.toFixed(3)),
        signals: { openIncidents, criticalIncidents, recentFailedFixes, snapshotOk, telemetryErrorRate },
    };
}
export async function evaluateDeployGate() {
    const { confidence, signals } = await computeDeployConfidence();
    const reasons = [];
    let riskLevel;
    let action;
    if (signals.criticalIncidents > 0 || confidence < 0.4) {
        riskLevel = 'high';
        action = 'blocked';
        reasons.push(`High risk: critical=${signals.criticalIncidents}, confidence=${confidence}.`);
    }
    else if (confidence < 0.75 || signals.openIncidents > 0 || signals.telemetryErrorRate > 0.05) {
        riskLevel = 'medium';
        action = 'require_owner_approval';
        reasons.push(`Medium risk: confidence=${confidence}, openIncidents=${signals.openIncidents}.`);
    }
    else {
        riskLevel = 'low';
        action = 'auto_deploy';
        reasons.push(`Low risk: confidence=${confidence}, no open incidents.`);
    }
    const decision = {
        riskLevel,
        confidence,
        action,
        reasons,
        signals,
        decidedAt: nowIso(),
        marker: OPERATIONAL_MEMORY_MARKER,
    };
    await recordDecision({
        kind: 'gate',
        title: `deploy_gate:${riskLevel}:${action}`,
        reason: reasons.join(' '),
        outcome: action === 'blocked' ? 'blocked' : action === 'auto_deploy' ? 'success' : 'pending',
        metadata: { ...decision },
    });
    return decision;
}
export async function getEngineeringDashboard() {
    await ensureEngineeringIntelligenceSchema();
    const [snapshot, telemetry, incidents, decisions, fixOutcomes, snapshots, deployGate] = await Promise.all([
        getOperationalSnapshot(),
        getTelemetryStats(60),
        listIncidents(20),
        listDecisions(20),
        listFixOutcomes(20),
        listSnapshots(10),
        evaluateDeployGate(),
    ]);
    return {
        ok: true,
        marker: OPERATIONAL_MEMORY_MARKER,
        generatedAt: nowIso(),
        snapshot,
        telemetry,
        incidents,
        decisions,
        fixOutcomes,
        snapshots: snapshots.map(({ id, label, capturedAt }) => ({ id, label, capturedAt })),
        deployGate,
    };
}
export async function simulateFailure(kind) {
    await ensureEngineeringIntelligenceSchema();
    const writes = [];
    let count = 0;
    if (kind === 'deploy_failure') {
        writes.push(ingestTelemetry({ source: 'simulation', area: 'deploy', level: 'fatal', message: 'simulated render deploy failed' }));
        count = 1;
    }
    else if (kind === 'api_5xx_burst') {
        for (let i = 0; i < 12; i++) {
            writes.push(ingestTelemetry({ source: 'simulation', area: 'api', level: 'error', message: `simulated 5xx #${i + 1}`, metadata: { status: 500 } }));
        }
        count = 12;
    }
    else if (kind === 'auth_spike') {
        for (let i = 0; i < 8; i++) {
            writes.push(ingestTelemetry({ source: 'simulation', area: 'auth', level: 'error', message: `simulated auth failure #${i + 1}` }));
        }
        count = 8;
    }
    else if (kind === 'queue_failure') {
        for (let i = 0; i < 5; i++) {
            writes.push(ingestTelemetry({ source: 'simulation', area: 'queue', level: 'error', message: `simulated queue failure #${i + 1}` }));
        }
        count = 5;
    }
    else if (kind === 'investor_workflow') {
        for (let i = 0; i < 3; i++) {
            writes.push(ingestTelemetry({ source: 'simulation', area: 'investor_workflow', level: 'error', message: `simulated investor workflow failure #${i + 1}` }));
        }
        count = 3;
    }
    await Promise.all(writes);
    // Run detection so incidents are persisted.
    const detection = await detectIncidents({ windowMinutes: 60 });
    let fixOutcome;
    let decision;
    if (kind === 'deploy_failure') {
        fixOutcome = await recordFixOutcome({ outcome: 'rolled_back', area: 'deploy', summary: 'Simulated deploy failure auto-rollback recorded.' });
        decision = await recordDecision({
            kind: 'rollback',
            title: 'simulated rollback after deploy_failure',
            reason: 'Simulated deploy failure triggered automatic rollback record.',
            outcome: 'success',
        });
    }
    const deployGate = await evaluateDeployGate();
    return {
        kind,
        telemetryWritten: count,
        incidents: detection.incidents,
        fixOutcome,
        decision,
        deployGate,
    };
}
