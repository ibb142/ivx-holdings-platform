/**
 * IVX Block 29 — Autonomous Real-World Engineering Cycle routes (owner-only).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';
import { AUTONOMOUS_CYCLE_MARKER, classifyIssue, describeAgents, getCycle, listCycles, runAutonomousCycle, runAutonomousCycleValidation, } from '../services/agents/autonomous-cycle';
const VALID_KINDS = new Set([
    'ui_bug', 'lint_type_issue', 'stale_dependency', 'broken_endpoint', 'deploy_warning', 'performance_anomaly',
]);
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getStatus(error) {
    const m = error instanceof Error ? error.message.toLowerCase() : '';
    if (m.includes('missing bearer token') || m.includes('invalid or expired'))
        return 401;
    if (m.includes('privileged ivx access is required'))
        return 403;
    if (m.includes('required') || m.includes('not found'))
        return 400;
    return 500;
}
function errorResponse(error) {
    const msg = error instanceof Error ? error.message : 'IVX autonomous-cycle route failed.';
    return ownerOnlyJson({
        ok: false,
        error: msg.slice(0, 320),
        marker: AUTONOMOUS_CYCLE_MARKER,
        timestamp: new Date().toISOString(),
    }, getStatus(error));
}
export function OPTIONS() { return ownerOnlyOptions(); }
function readSignal(body) {
    const description = readTrimmed(body.description);
    if (!description)
        throw new Error('description is required.');
    const hintRaw = readTrimmed(body.hintKind);
    const hintKind = VALID_KINDS.has(hintRaw) ? hintRaw : undefined;
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : undefined;
    return { description, hintKind, metadata };
}
export async function handleStatus(request) {
    try {
        await assertIVXOwnerOnly(request);
        return ownerOnlyJson({
            ok: true,
            block: 'block29-autonomous-cycle',
            marker: AUTONOMOUS_CYCLE_MARKER,
            agents: describeAgents(),
            issueKinds: Array.from(VALID_KINDS),
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleClassify(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const signal = readSignal(body);
        return ownerOnlyJson({
            ok: true,
            classification: classifyIssue(signal),
            marker: AUTONOMOUS_CYCLE_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleRun(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const signal = readSignal(body);
        const approverEmail = readTrimmed(body.approverEmail) || undefined;
        // Pre-Execution Feasibility Gate (Stage 0)
        try {
            const gate = await checkPreExecutionGate(request, {
                prompt: `autonomous cycle run signal=${signal}`,
                ownerSessionPresent: true,
                entryPoint: 'autonomous-cycle-run',
            });
            if (gate.blocked && gate.response)
                return gate.response;
        }
        catch (gateError) {
            console.log('[IVXAutonomousCycle] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
        }
        const cycle = await runAutonomousCycle({ signal, approverEmail });
        return ownerOnlyJson({
            ok: cycle.status === 'completed' || cycle.status === 'blocked',
            cycle,
            marker: AUTONOMOUS_CYCLE_MARKER,
            timestamp: new Date().toISOString(),
        }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleList(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
        return ownerOnlyJson({
            ok: true,
            cycles: listCycles(limit).map((c) => ({
                id: c.id,
                kind: c.classification.kind,
                agent: c.task?.assignedAgent ?? c.classification.preferredAgent,
                risk: c.task?.risk ?? null,
                status: c.status,
                confidence: c.classification.confidence,
                deployAction: c.deploy?.action ?? null,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
            })),
            marker: AUTONOMOUS_CYCLE_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleGet(request, cycleId) {
    try {
        await assertIVXOwnerOnly(request);
        const cycle = getCycle(cycleId);
        if (!cycle)
            throw new Error('cycle not found');
        return ownerOnlyJson({
            ok: true,
            cycle,
            marker: AUTONOMOUS_CYCLE_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleValidate(request) {
    try {
        await assertIVXOwnerOnly(request);
        const result = await runAutonomousCycleValidation();
        return ownerOnlyJson({
            ok: result.ok,
            validation: {
                ok: result.ok,
                marker: result.marker,
                checks: result.checks,
                cycleSummaries: result.cycles.map((c) => ({
                    id: c.id,
                    kind: c.classification.kind,
                    confidence: c.classification.confidence,
                    agent: c.task?.assignedAgent ?? c.classification.preferredAgent,
                    risk: c.task?.risk ?? null,
                    status: c.status,
                    deployAction: c.deploy?.action ?? null,
                    rollbackStrategy: c.rollback?.rollbackStrategy ?? null,
                })),
            },
            marker: AUTONOMOUS_CYCLE_MARKER,
            timestamp: new Date().toISOString(),
        }, result.ok ? 200 : 207);
    }
    catch (error) {
        return errorResponse(error);
    }
}
