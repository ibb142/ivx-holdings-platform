/**
 * IVX Repair Brain — autonomous diagnosis + repair-proposal engine.
 *
 * Given an incident id, gathers context (incident record, recent diagnostic
 * stages for the same conversation, lightly-sampled source files referenced
 * by the stack), asks the IVX AI runtime for a structured diagnosis, and
 * writes a repair-proposal artifact to `logs/audit/repair-proposals/`.
 *
 * Never auto-applies code: Rork manages the code path; the brain produces a
 * structured plan that the owner (or a downstream worker) can act on.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getIncident, updateIncident, } from './ivx-incident-store';
import { listOwnerAIDiagnostics } from './ivx-owner-ai-diagnostics-log';
import { requestIVXAIText } from '../ivx-ai-runtime';
const PROPOSAL_DIR = path.resolve(process.cwd(), 'logs/audit/repair-proposals');
function extractJsonBlock(text) {
    if (!text)
        return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start)
        return null;
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    }
    catch {
        return null;
    }
}
function fileCandidatesFromStack(stack, fileLine) {
    const set = new Set();
    if (fileLine)
        set.add(fileLine.split(':')[0]);
    if (stack) {
        const matches = stack.match(/[\w./@\-]+\.(?:ts|tsx|js|jsx)(?::\d+)?/g) ?? [];
        for (const m of matches)
            set.add(m.split(':')[0]);
    }
    return Array.from(set)
        .filter((p) => !p.includes('node_modules'))
        .filter((p) => /backend|expo|src|app|components|services|lib/.test(p))
        .slice(0, 4);
}
async function readSafeSlice(relativePath) {
    const cleaned = relativePath.replace(/^\/+/, '');
    const full = path.resolve(process.cwd(), cleaned);
    if (!full.startsWith(process.cwd()))
        return null;
    try {
        const stat = await fs.stat(full);
        if (!stat.isFile() || stat.size > 256 * 1024)
            return null;
        const text = await fs.readFile(full, 'utf8');
        return text.slice(0, 4000);
    }
    catch {
        return null;
    }
}
async function gatherSourceContext(incident) {
    const candidates = fileCandidatesFromStack(incident.stack, incident.fileLine);
    const out = [];
    for (const file of candidates) {
        const excerpt = await readSafeSlice(file);
        if (excerpt)
            out.push({ file, excerpt });
    }
    return out;
}
function buildPrompt(incident, source, stages) {
    const isSilentFailure = incident.source === 'silent_failure'
        || incident.checkpoint === 'BACKEND_POST_FINISHED'
        || /timed out|timeout|silent[_ ]failure/i.test(incident.message);
    const silentFailureRecipe = isSilentFailure
        ? [
            '',
            'SILENT_FAILURE RECIPE — this incident is a watchdog-detected stall (request started but downstream checkpoint never reached). Prefer one or more of these patch directions in `patchPlan`, ordered by impact:',
            '  1. STREAMING: switch `requestOwnerAI` → `streamIVXAIText` so partial tokens render immediately (backend/api/ivx-owner-ai-stream.ts already exists; wire it in expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts).',
            '  2. ADAPTIVE TIMEOUT: compute timeout from prompt length / requested maxOutputTokens (already in `computeAdaptiveTimeoutMs` in backend/ivx-ai-runtime.ts) — pass `promptChars` + `maxOutputTokens` through.',
            '  3. CHUNKED GENERATION: split long analytical answers into sections (e.g. 800-token slices) with a continuation token; assistant bubble grows progressively.',
            '  4. BACKGROUND JOB: if estimated output > 4k tokens, enqueue via `ivx-ai-job-queue.ts` and return a job id; client polls /api/ivx/owner-ai/jobs/:id and renders "Generating report…".',
            '  5. RETRY WITH SMALLER CONTEXT: on first timeout, retry with truncated history (last 6 turns) + a "continue from here" instruction.',
            'Set `riskLevel` = "low" for adaptive-timeout / retry-smaller-context, "medium" for streaming wire-up / chunked generation, "high" for background-job orchestration.',
            'Always include a user-visible fallback so the assistant bubble renders something within 10s even on full failure.',
        ].join('\n')
        : '';
    const system = [
        'You are the IVX AI Repair Brain. Given a single runtime incident, produce a structured JSON diagnosis.',
        'You MUST return ONLY a JSON object with this exact shape:',
        '{',
        '  "rootCause": string,',
        '  "fileLine": string | null,',
        '  "patchPlan": string,',
        '  "riskLevel": "low" | "medium" | "high",',
        '  "rollbackPlan": string',
        '}',
        'No prose outside the JSON. Be specific: cite file paths and line numbers when possible.',
        'Risk levels: "low" = isolated UI/log fix; "medium" = shared module or API; "high" = auth, payments, data migration, deploy config.',
        silentFailureRecipe,
    ].filter(Boolean).join('\n');
    const relevantStages = stages.filter((s) => s.conversationId === incident.conversationId).slice(0, 3);
    const prompt = [
        `Incident ${incident.id} (${incident.severity}, source=${incident.source})`,
        `message: ${incident.message}`,
        `checkpoint: ${incident.checkpoint ?? 'n/a'}`,
        `fileLine hint: ${incident.fileLine ?? 'n/a'}`,
        `responseStatus: ${incident.responseStatus ?? 'n/a'}`,
        `environment: ${incident.environment} build=${incident.buildId ?? 'n/a'}`,
        `requestBodyPreview: ${incident.requestBodyPreview ?? 'n/a'}`,
        '',
        'Stack (capped):',
        incident.stack ?? '(no stack)',
        '',
        'Recent matching diagnostic stages:',
        relevantStages.length === 0
            ? '(none)'
            : relevantStages
                .map((s) => `- ${s.requestId} stages=${s.stages.map((x) => x.stage).join('>')} error=${s.error ?? 'none'}`)
                .join('\n'),
        '',
        'Source excerpts:',
        source.length === 0
            ? '(no source files identifiable from stack)'
            : source.map((s) => `--- ${s.file} ---\n${s.excerpt}`).join('\n'),
        '',
        'Return the JSON object now.',
    ].join('\n');
    return { system, prompt };
}
async function writeProposalArtifact(incident, diagnosis) {
    try {
        await fs.mkdir(PROPOSAL_DIR, { recursive: true });
        const filePath = path.join(PROPOSAL_DIR, `${incident.id}.json`);
        const artifact = {
            incidentId: incident.id,
            createdAt: new Date().toISOString(),
            incident: {
                message: incident.message,
                source: incident.source,
                severity: incident.severity,
                fileLine: incident.fileLine,
                responseStatus: incident.responseStatus,
                environment: incident.environment,
                buildId: incident.buildId,
            },
            diagnosis,
        };
        await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf8');
        return filePath;
    }
    catch {
        return null;
    }
}
export async function diagnoseIncident(incidentId) {
    const incident = getIncident(incidentId);
    if (!incident) {
        return { ok: false, incidentId, diagnosis: null, proposalArtifactPath: null, error: 'incident not found' };
    }
    updateIncident(incidentId, { status: 'diagnosing' });
    const sources = await gatherSourceContext(incident);
    const stages = listOwnerAIDiagnostics(50);
    const { system, prompt } = buildPrompt(incident, sources, stages);
    let raw = '';
    let model = null;
    try {
        const result = await requestIVXAIText({
            module: 'p1-plan-creator',
            requestId: `repair_${incidentId}`,
            system,
            prompt,
            maxOutputTokens: 1200,
        });
        raw = result.text ?? '';
        model = result.providerMetadata?.model ?? null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateIncident(incidentId, { status: 'open' });
        return { ok: false, incidentId, diagnosis: null, proposalArtifactPath: null, error: `repair-brain AI call failed: ${message}` };
    }
    const parsed = extractJsonBlock(raw);
    const diagnosis = {
        rootCause: parsed?.rootCause?.trim() || 'Unable to parse structured diagnosis from model output.',
        fileLine: parsed?.fileLine?.trim() || incident.fileLine,
        patchPlan: parsed?.patchPlan?.trim() || 'No patch plan returned.',
        riskLevel: ['low', 'medium', 'high'].includes(parsed?.riskLevel)
            ? parsed.riskLevel
            : 'medium',
        rollbackPlan: parsed?.rollbackPlan?.trim() || 'Roll back to previous deploy via Render API.',
        model,
        diagnosedAt: new Date().toISOString(),
    };
    const proposalArtifactPath = await writeProposalArtifact(incident, diagnosis);
    const nextStatus = diagnosis.riskLevel === 'low' ? 'fix_proposed' : 'awaiting_approval';
    updateIncident(incidentId, { status: nextStatus, diagnosis });
    return { ok: true, incidentId, diagnosis, proposalArtifactPath };
}
