/**
 * IVX Senior Developer Build-Out API
 *
 *   POST /api/ivx/senior-dev/proof          body: ProofRequest
 *   GET  /api/ivx/senior-dev/proofs         recent proof reports
 *   GET  /api/ivx/senior-dev/evidence       structured evidence bundle
 *   GET  /api/ivx/senior-dev/otel           OpenTelemetry scaffold status
 *   POST /api/ivx/senior-dev/repo-search    body: { query, org?, perPage? }
 *   POST /api/ivx/senior-dev/test-report    body: { suite }
 *   GET  /api/ivx/senior-dev/e2e            current E2E plan
 *   POST /api/ivx/senior-dev/e2e/run        dry-run E2E plan
 *
 * All routes are owner-only. No secret values are ever returned.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildProofReport, listRecentProofReports } from '../services/ivx-proof-pipeline';
import { buildEvidenceMode } from '../services/ivx-evidence-mode';
import { getOTelStatus } from '../services/ivx-otel';
import { searchAcrossIVXRepos } from '../services/ivx-repo-search';
import { runStructuredTestReport } from '../services/ivx-test-reporter';
import { getE2EPlan, runE2EDryRun } from '../services/ivx-e2e-pipeline';
import { getExecutionSnapshot, recordExecutionEvent } from '../services/ivx-execution-stream';
import { listRepairJobs } from '../services/ivx-repair-jobs';
import { listIncidents } from '../services/ivx-incident-store';
export function OPTIONS() {
    return ownerOnlyOptions();
}
function asString(value) {
    return typeof value === 'string' ? value : '';
}
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
export async function handleProofRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const workItem = asString(body.workItem).trim();
        if (!workItem)
            return ownerOnlyJson({ ok: false, error: 'workItem is required' }, 400);
        const claims = Array.isArray(body.claims) ? body.claims.map((c) => ({
            label: asString(c.label),
            file: asString(c.file),
            startLine: asNumber(c.startLine),
            endLine: asNumber(c.endLine),
            runtimeSignal: asString(c.runtimeSignal) || undefined,
        })).filter((c) => c.file) : [];
        const status = body.status === 'before' || body.status === 'after' || body.status === 'progress' ? body.status : 'progress';
        const report = await buildProofReport({ workItem, status, claims });
        return ownerOnlyJson(report);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'proof failed' }, 500);
    }
}
export async function handleProofListRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '25', 10);
        const rows = await listRecentProofReports(Number.isFinite(limit) ? limit : 25);
        return ownerOnlyJson({ ok: true, proofs: rows });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'list failed' }, 500);
    }
}
export async function handleEvidenceRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const includeTypecheck = url.searchParams.get('typecheck') === '1';
        const query = url.searchParams.get('query') ?? undefined;
        const bundle = await buildEvidenceMode({ includeTypecheck, repoSearchQuery: query });
        return ownerOnlyJson(bundle);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'evidence failed' }, 500);
    }
}
export async function handleOTelStatusRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        return ownerOnlyJson(getOTelStatus());
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'otel failed' }, 500);
    }
}
export async function handleRepoSearchRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const query = asString(body.query).trim();
        if (!query)
            return ownerOnlyJson({ ok: false, error: 'query is required' }, 400);
        const org = asString(body.org).trim() || undefined;
        const perPage = asNumber(body.perPage);
        const result = await searchAcrossIVXRepos(query, { org, perPage });
        return ownerOnlyJson(result);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'repo search failed' }, 500);
    }
}
export async function handleTestReportRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const suite = asString(body.suite).trim();
        if (suite !== 'typecheck' && suite !== 'lint' && suite !== 'smoke') {
            return ownerOnlyJson({ ok: false, error: 'suite must be typecheck | lint | smoke' }, 400);
        }
        const report = await runStructuredTestReport(suite);
        return ownerOnlyJson(report);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'test report failed' }, 500);
    }
}
export async function handleE2EPlanRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        return ownerOnlyJson(getE2EPlan());
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'e2e plan failed' }, 500);
    }
}
export async function handleE2ERunRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const plan = await runE2EDryRun();
        return ownerOnlyJson(plan);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'e2e run failed' }, 500);
    }
}
/**
 * Advanced Execution Mode — unified live snapshot powering the
 * IVX Senior Developer panel. Combines the in-memory execution stream
 * with recent repair-job stages and open incidents (watchdog timeline)
 * so the owner sees real engineering activity in a single payload.
 */
export async function handleExecutionStreamRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const sinceSeq = Number.parseInt(url.searchParams.get('sinceSeq') ?? '0', 10);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '120', 10);
        const snapshot = getExecutionSnapshot({
            sinceSeq: Number.isFinite(sinceSeq) ? sinceSeq : 0,
            limit: Number.isFinite(limit) ? limit : 120,
        });
        const repairJobs = listRepairJobs(8).map((job) => ({
            id: job.id,
            incidentId: job.incidentId,
            stage: job.stage,
            classification: job.classification,
            stepsTail: job.steps.slice(-6).map((s) => ({ stage: s.stage, ok: s.ok, at: s.at, note: s.note })),
            proposalArtifactPath: job.proposalArtifactPath,
            error: job.error,
            updatedAt: job.updatedAt,
        }));
        let openIncidents = [];
        try {
            const rows = await Promise.resolve(listIncidents(40));
            openIncidents = rows
                .filter((r) => r.status === 'open' || r.status === 'awaiting_approval' || r.status === 'awaiting_production_approval')
                .slice(0, 12)
                .map((r) => ({ id: r.id, severity: r.severity, status: r.status, checkpoint: r.checkpoint ?? '', fileLine: r.fileLine, createdAt: r.createdAt }));
        }
        catch { /* ignore */ }
        return ownerOnlyJson({ ...snapshot, repairJobs, openIncidents });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'execution stream failed' }, 500);
    }
}
/**
 * Record an execution event from a trusted owner client (e.g. the chat
 * surface flagging a high-level workflow phase like "comparing commits").
 * Owner-only; never accepts secrets — payload is meta-only.
 */
export async function handleExecutionRecordRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const category = asString(body.category);
        const allowed = new Set(['file_activity', 'tool_call', 'reasoning', 'patch_event', 'test_event', 'watchdog_event', 'thinking', 'repo_activity', 'evidence_card']);
        if (!allowed.has(category))
            return ownerOnlyJson({ ok: false, error: 'invalid category' }, 400);
        const label = asString(body.label).trim();
        if (!label)
            return ownerOnlyJson({ ok: false, error: 'label required' }, 400);
        const statusVal = asString(body.status);
        const statusAllowed = new Set(['pending', 'running', 'pass', 'fail', 'info', 'blocked']);
        const event = recordExecutionEvent({
            category: category,
            label,
            fileLine: asString(body.fileLine) || undefined,
            symbol: asString(body.symbol) || undefined,
            status: statusAllowed.has(statusVal) ? statusVal : 'info',
            confidence: asNumber(body.confidence),
            progressPct: asNumber(body.progressPct),
            meta: body.meta && typeof body.meta === 'object' ? body.meta : undefined,
        });
        return ownerOnlyJson({ ok: true, event: event });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'record failed' }, 500);
    }
}
