/**
 * IVX Provider Migration Roadmap — 7-phase plan to reduce dependency on
 * ChatGPT/Vercel AI Gateway and migrate to IVX-owned orchestration.
 *
 * Persists phase progress to `logs/audit/provider-roadmap.json` so each
 * overnight run can advance progress without losing prior state.
 *
 * NEVER removes existing providers automatically — OpenAI / Vercel remain
 * as fallbacks until self-hosted reliability exceeds production threshold.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
const ROADMAP_PATH = path.resolve(process.cwd(), 'logs/audit/provider-roadmap.json');
export const IVX_PROVIDER_ROADMAP_MARKER = 'ivx-provider-roadmap-2026-05-26';
const DEFAULT_PHASES = [
    { id: 1, name: 'Stabilize current production stack', description: 'Adaptive timeout, streaming, queue, telemetry — all on Vercel AI Gateway.', progressPercent: 90, status: 'in_progress', notes: ['streaming + adaptive timeout live', 'telemetry ring + JSONL active'], updatedAt: new Date(0).toISOString() },
    { id: 2, name: 'Provider abstraction layer', description: 'Single interface `IVXProvider` so any provider plugs in.', progressPercent: 30, status: 'in_progress', notes: ['ivx-ai-runtime already centralises requestIVXAIText / streamIVXAIText'], updatedAt: new Date(0).toISOString() },
    { id: 3, name: 'Multi-provider routing', description: 'Route by latency / cost / reliability with automatic fallback.', progressPercent: 5, status: 'not_started', notes: [], updatedAt: new Date(0).toISOString() },
    { id: 4, name: 'Self-hosted / open-source model integration', description: 'Add a self-hosted Llama / Mistral / DeepSeek endpoint behind same interface.', progressPercent: 0, status: 'not_started', notes: [], updatedAt: new Date(0).toISOString() },
    { id: 5, name: 'Memory + reasoning engine', description: 'Long-term semantic memory, code graph, dependency graph.', progressPercent: 10, status: 'not_started', notes: ['incident ring + telemetry ring are early memory'], updatedAt: new Date(0).toISOString() },
    { id: 6, name: 'Autonomous engineering workflows', description: 'Night ops, repair brain, staged replay, owner approval.', progressPercent: 60, status: 'in_progress', notes: ['repair brain + staged policy live', 'night ops scaffolded'], updatedAt: new Date(0).toISOString() },
    { id: 7, name: 'IVX-owned orchestration and intelligence layer', description: 'IVX brain runs the company without third-party providers.', progressPercent: 0, status: 'not_started', notes: [], updatedAt: new Date(0).toISOString() },
];
async function readSnapshotFile() {
    try {
        const text = await fs.readFile(ROADMAP_PATH, 'utf8');
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed.phases))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
async function writeSnapshotFile(snapshot) {
    try {
        await fs.mkdir(path.dirname(ROADMAP_PATH), { recursive: true });
        await fs.writeFile(ROADMAP_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
    }
    catch {
        // best-effort
    }
}
function computeOverall(phases) {
    if (phases.length === 0)
        return 0;
    const sum = phases.reduce((acc, p) => acc + Math.max(0, Math.min(100, p.progressPercent)), 0);
    return Math.round(sum / phases.length);
}
function pickCurrentPhase(phases) {
    for (const p of phases) {
        if (p.status !== 'complete')
            return p.id;
    }
    return 7;
}
export async function getProviderRoadmapSnapshot() {
    const existing = await readSnapshotFile();
    const phases = existing?.phases?.length ? existing.phases : DEFAULT_PHASES;
    const snapshot = {
        marker: IVX_PROVIDER_ROADMAP_MARKER,
        generatedAt: new Date().toISOString(),
        phases,
        currentPhase: pickCurrentPhase(phases),
        overallPercent: computeOverall(phases),
        fallbackPolicy: {
            keepOpenAI: true,
            keepVercelGateway: true,
            minSelfHostedReliabilityPercent: 95,
        },
    };
    if (!existing)
        await writeSnapshotFile(snapshot);
    return snapshot;
}
export async function advanceProviderRoadmap(input) {
    const snap = await getProviderRoadmapSnapshot();
    const phase = snap.phases.find((p) => p.id === input.phaseId);
    if (!phase) {
        throw new Error(`unknown phase id ${input.phaseId}`);
    }
    const before = phase.progressPercent;
    const next = Math.max(0, Math.min(100, before + (input.deltaPercent ?? 0)));
    phase.progressPercent = next;
    if (input.markStatus) {
        phase.status = input.markStatus;
    }
    else if (next >= 100) {
        phase.status = 'complete';
    }
    else if (next > 0) {
        phase.status = 'in_progress';
    }
    const noteTrim = (input.note ?? '').trim().slice(0, 240);
    if (noteTrim) {
        phase.notes = [...phase.notes.slice(-9), `${new Date().toISOString()} :: ${noteTrim}`];
    }
    phase.updatedAt = new Date().toISOString();
    snap.overallPercent = computeOverall(snap.phases);
    snap.currentPhase = pickCurrentPhase(snap.phases);
    snap.generatedAt = new Date().toISOString();
    await writeSnapshotFile(snap);
    return { phaseId: input.phaseId, before, after: next, status: phase.status, noteAdded: noteTrim || null };
}
