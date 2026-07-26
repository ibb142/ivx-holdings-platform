import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { clampScore, computeRemainingGap, createPipelineEntry, deletePipelineEntry, getPipelineEntry, listPipelineEntries, normalizeAmount, setPipelineStage, summarizePipeline, updatePipelineEntry, validateCreatePipeline, } from './ivx-capital-pipeline-store';
const ROOT = path.join(process.cwd(), 'logs', 'audit', 'capital-pipeline');
async function clean() {
    await rm(ROOT, { recursive: true, force: true });
}
function baseInput(overrides = {}) {
    return {
        name: overrides.name ?? 'Acme Family Office',
        source: overrides.source ?? 'owner_entered',
        ...overrides,
    };
}
beforeEach(clean);
afterEach(clean);
describe('helpers', () => {
    it('clamps scores to 0–100 integers', () => {
        expect(clampScore(150)).toBe(100);
        expect(clampScore(-5)).toBe(0);
        expect(clampScore('nope')).toBe(0);
    });
    it('normalizes amounts and strips $ and commas', () => {
        expect(normalizeAmount('$1,400,000')).toBe(1400000);
        expect(normalizeAmount(250000)).toBe(250000);
        expect(normalizeAmount('')).toBeNull();
        expect(normalizeAmount(-10)).toBeNull();
        expect(normalizeAmount('garbage')).toBeNull();
    });
    it('computes remaining gap from requested − committed, never negative', () => {
        expect(computeRemainingGap(1000000, 250000)).toBe(750000);
        expect(computeRemainingGap(1000000, null)).toBe(1000000);
        expect(computeRemainingGap(500000, 800000)).toBe(0);
        expect(computeRemainingGap(null, 100)).toBeNull();
    });
});
describe('validateCreatePipeline (no fabrication rule)', () => {
    it('requires a name', () => {
        expect(validateCreatePipeline(baseInput({ name: '  ' })).ok).toBe(false);
    });
    it('requires a valid source', () => {
        expect(validateCreatePipeline({ name: 'X', source: 'made_up' }).ok).toBe(false);
    });
    it('requires attribution for public_source and crm_import', () => {
        expect(validateCreatePipeline(baseInput({ source: 'public_source', sourceDetail: '' })).ok).toBe(false);
        expect(validateCreatePipeline(baseInput({ source: 'crm_import', sourceDetail: '' })).ok).toBe(false);
        expect(validateCreatePipeline(baseInput({ source: 'public_source', sourceDetail: 'https://sec.gov/...' })).ok).toBe(true);
    });
});
describe('CRUD lifecycle', () => {
    it('creates, reads, updates, advances stage, and deletes', async () => {
        const created = await createPipelineEntry(baseInput({
            name: 'Jane Capital',
            partyType: 'investor',
            dealName: 'Casa Rosario',
            capitalRequested: 1000000,
            capitalCommitted: 250000,
            closeProbability: 140,
        }));
        expect(created.ok).toBe(true);
        if (!created.ok)
            return;
        expect(created.entry.stage).toBe('lead');
        expect(created.entry.remainingGap).toBe(750000);
        expect(created.entry.closeProbability).toBe(100); // clamped
        const id = created.entry.id;
        expect((await getPipelineEntry(id))?.name).toBe('Jane Capital');
        const updated = await updatePipelineEntry(id, { capitalCommitted: 400000 });
        expect(updated?.remainingGap).toBe(600000); // recomputed
        expect(updated?.capitalRequested).toBe(1000000); // preserved
        const moved = await setPipelineStage(id, 'meeting');
        expect(moved?.stage).toBe('meeting');
        expect(await setPipelineStage(id, 'bogus')).toBeNull();
        expect(await listPipelineEntries()).toHaveLength(1);
        expect(await deletePipelineEntry(id)).toBe(true);
        expect(await deletePipelineEntry(id)).toBe(false);
        expect(await listPipelineEntries()).toHaveLength(0);
    });
    it('rejects a create with no name and never persists it', async () => {
        const result = await createPipelineEntry(baseInput({ name: '' }));
        expect(result.ok).toBe(false);
        expect(await listPipelineEntries()).toHaveLength(0);
    });
});
describe('summarizePipeline', () => {
    it('rolls up totals, raised capital, weighted pipeline, and active parties', async () => {
        await createPipelineEntry(baseInput({
            name: 'Open Investor', partyType: 'investor', stage: 'soft_commit',
            capitalRequested: 1000000, capitalCommitted: 200000, closeProbability: 50,
        }));
        await createPipelineEntry(baseInput({
            name: 'Open Buyer', partyType: 'buyer', stage: 'meeting',
            capitalRequested: 500000, capitalCommitted: null, closeProbability: 20,
        }));
        await createPipelineEntry(baseInput({
            name: 'Closed Deal', partyType: 'investor', stage: 'closed',
            capitalRequested: 800000, capitalCommitted: 800000, closeProbability: 100,
        }));
        const summary = await summarizePipeline();
        expect(summary.total).toBe(3);
        expect(summary.closed).toBe(1);
        expect(summary.dealsInProgress).toBe(2);
        expect(summary.activeInvestors).toBe(1);
        expect(summary.activeBuyers).toBe(1);
        // open requested only: 1,000,000 + 500,000
        expect(summary.totalPipeline).toBe(1500000);
        // committed on closed entries
        expect(summary.capitalRaised).toBe(800000);
        // all committed: 200k + 0 + 800k
        expect(summary.capitalCommitted).toBe(1000000);
        // weighted on open: (200000*50% = 100000) + (500000*20% = 100000)
        expect(summary.weightedPipeline).toBe(200000);
        expect(summary.byStage.closed).toBe(1);
    });
});
