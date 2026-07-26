/**
 * IVX Innovation API (owner-only) — Research Lab + Innovation Dashboard backend.
 *
 *   GET  /api/ivx/innovation/dashboard          → ideas + hypotheses + experiments + business value
 *   POST /api/ivx/innovation/scan               → run the engine: generate scored ideas from live signals
 *   GET  /api/ivx/innovation/ideas              → list scored ideas (priority-ranked)
 *   POST /api/ivx/innovation/ideas/:id/status   → approve / reject / ship an idea
 *   GET  /api/ivx/innovation/hypotheses         → list Research Lab hypotheses
 *   POST /api/ivx/innovation/hypotheses         → create a hypothesis
 *   POST /api/ivx/innovation/hypotheses/:id/status → set hypothesis status
 *   GET  /api/ivx/innovation/experiments        → list experiments
 *   POST /api/ivx/innovation/experiments        → create an experiment
 *   POST /api/ivx/innovation/experiments/:id    → update experiment status/result
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { runInnovationScan } from '../services/ivx-innovation-engine';
import { buildInnovationDashboard } from '../services/ivx-innovation-dashboard';
import { createExperiment, createHypothesis, listExperiments, listHypotheses, listIdeas, setHypothesisStatus, setIdeaStatus, updateExperiment, } from '../services/ivx-innovation-store';
export const OPTIONS = () => ownerOnlyOptions();
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
async function readJsonBody(request) {
    try {
        const text = await request.text();
        if (!text)
            return {};
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
export async function handleInnovationDashboardRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await buildInnovationDashboard();
    return ownerOnlyJson({ ok: true, dashboard: dashboard });
}
export async function handleInnovationScanRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const conversationCount = typeof body.conversationCount === 'number' ? body.conversationCount : undefined;
    const result = await runInnovationScan({ conversationCount });
    return ownerOnlyJson({ ok: true, scan: result });
}
export async function handleInnovationIdeasListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const ideas = await listIdeas();
    return ownerOnlyJson({ ok: true, ideas });
}
export async function handleInnovationIdeaStatusRequest(request, ideaId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    const updated = await setIdeaStatus(ideaId, status);
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Idea not found or invalid status.' }, 404);
    }
    return ownerOnlyJson({ ok: true, idea: updated });
}
export async function handleInnovationHypothesesListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const hypotheses = await listHypotheses();
    return ownerOnlyJson({ ok: true, hypotheses });
}
export async function handleInnovationHypothesisCreateRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const statement = asString(body.statement);
    if (!statement) {
        return ownerOnlyJson({ ok: false, error: 'A hypothesis statement is required.' }, 400);
    }
    const hypothesis = await createHypothesis({
        statement,
        rationale: asString(body.rationale),
        ideaId: asString(body.ideaId) || null,
    });
    return ownerOnlyJson({ ok: true, hypothesis });
}
export async function handleInnovationHypothesisStatusRequest(request, hypothesisId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    const updated = await setHypothesisStatus(hypothesisId, status);
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Hypothesis not found or invalid status.' }, 404);
    }
    return ownerOnlyJson({ ok: true, hypothesis: updated });
}
export async function handleInnovationExperimentsListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const experiments = await listExperiments();
    return ownerOnlyJson({ ok: true, experiments });
}
export async function handleInnovationExperimentCreateRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const title = asString(body.title);
    if (!title) {
        return ownerOnlyJson({ ok: false, error: 'An experiment title is required.' }, 400);
    }
    const experiment = await createExperiment({
        title,
        method: asString(body.method),
        metric: asString(body.metric),
        hypothesisId: asString(body.hypothesisId) || null,
    });
    return ownerOnlyJson({ ok: true, experiment });
}
export async function handleInnovationExperimentUpdateRequest(request, experimentId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    const result = body.result === null ? null : asString(body.result) || undefined;
    const updated = await updateExperiment(experimentId, {
        status: status || undefined,
        result,
    });
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Experiment not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, experiment: updated });
}
