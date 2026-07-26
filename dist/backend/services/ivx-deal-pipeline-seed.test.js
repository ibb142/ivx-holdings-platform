import { describe, expect, it } from 'bun:test';
import { IVX_DEAL_PIPELINE_SEED_MARKER, normalizeDealKey, projectToDealInput, projectToPipelineInput, selectProjectsToSeed, } from './ivx-deal-pipeline-seed';
function project(overrides = {}) {
    return {
        id: overrides.id ?? 'casa-rosario-001',
        name: overrides.name ?? 'Casa Rosario',
        location: overrides.location ?? 'Pembroke Pines, FL',
        price: 'price' in overrides ? (overrides.price ?? null) : '$1,400,000',
        roi: overrides.roi ?? '30%',
        timeline: overrides.timeline ?? '14-24 months',
        ownershipMinimum: overrides.ownershipMinimum ?? '$50',
        status: overrides.status ?? 'active',
        published: overrides.published ?? true,
        mediaCount: overrides.mediaCount ?? 0,
    };
}
function dealRecord(name) {
    return {
        id: `deal-${name}`,
        dealName: name,
        counterparty: '',
        dealType: 'jv',
        status: 'open',
        investorsContacted: 0,
        investorsResponded: 0,
        buyersContacted: 0,
        meetingsScheduled: 0,
        documentsShared: 0,
        offersReceived: 0,
        capitalTarget: null,
        capitalCommitted: null,
        closedAt: null,
        notes: '',
        source: 'verified_deal',
        sourceDetail: '',
        participants: [],
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
function pipelineEntry(dealName) {
    return {
        id: `pipeline-${dealName}`,
        name: `${dealName} — capital raise`,
        company: '',
        partyType: 'investor',
        dealName,
        stage: 'lead',
        capitalRequested: null,
        capitalCommitted: null,
        remainingGap: null,
        closeProbability: 0,
        expectedCloseDate: null,
        notes: '',
        source: 'verified_deal',
        sourceDetail: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
describe('ivx-deal-pipeline-seed', () => {
    it('exposes a marker', () => {
        expect(IVX_DEAL_PIPELINE_SEED_MARKER).toContain('deal-pipeline-seed');
    });
    it('normalizes deal keys case-insensitively', () => {
        expect(normalizeDealKey('  Casa   Rosario ')).toBe('casa rosario');
        expect(normalizeDealKey('CASA ROSARIO')).toBe(normalizeDealKey('casa rosario'));
    });
    it('maps a real project to a verified-deal tracking input with parsed capital', () => {
        const input = projectToDealInput(project());
        expect(input.dealName).toBe('Casa Rosario');
        expect(input.source).toBe('verified_deal');
        expect(input.sourceDetail).toBe('jv_deals:casa-rosario-001');
        expect(input.status).toBe('open');
        expect(input.capitalTarget).toBe(1_400_000);
        expect(input.notes).toContain('Pembroke Pines');
    });
    it('leaves capital null when the project has no parseable price (never invents)', () => {
        const input = projectToDealInput(project({ price: null }));
        expect(input.capitalTarget).toBeNull();
    });
    it('maps a real project to a capital-raise pipeline input', () => {
        const input = projectToPipelineInput(project());
        expect(input.name).toBe('Casa Rosario — capital raise');
        expect(input.dealName).toBe('Casa Rosario');
        expect(input.source).toBe('verified_deal');
        expect(input.partyType).toBe('investor');
        expect(input.stage).toBe('lead');
        expect(input.capitalRequested).toBe(1_400_000);
    });
    it('selects only projects not already present (idempotent by deal name)', () => {
        const projects = [project({ name: 'Casa Rosario' }), project({ id: 'p2', name: 'PEREZ RESIDENCE' })];
        const existingDeals = [dealRecord('casa rosario')]; // already tracked, different case
        const existingPipeline = [pipelineEntry('PEREZ RESIDENCE')]; // already in pipeline
        const selection = selectProjectsToSeed(projects, existingDeals, existingPipeline);
        expect(selection.dealsToCreate.map((p) => p.name)).toEqual(['PEREZ RESIDENCE']);
        expect(selection.dealsSkipped).toEqual(['Casa Rosario']);
        expect(selection.pipelineToCreate.map((p) => p.name)).toEqual(['Casa Rosario']);
        expect(selection.pipelineSkipped).toEqual(['PEREZ RESIDENCE']);
    });
    it('seeds everything when both stores are empty', () => {
        const projects = [project({ name: 'Casa Rosario' }), project({ id: 'p2', name: 'PEREZ RESIDENCE' })];
        const selection = selectProjectsToSeed(projects, [], []);
        expect(selection.dealsToCreate).toHaveLength(2);
        expect(selection.pipelineToCreate).toHaveLength(2);
        expect(selection.dealsSkipped).toHaveLength(0);
        expect(selection.pipelineSkipped).toHaveLength(0);
    });
    it('creates nothing when every project is already present (safe re-run)', () => {
        const projects = [project({ name: 'Casa Rosario' })];
        const selection = selectProjectsToSeed(projects, [dealRecord('Casa Rosario')], [pipelineEntry('Casa Rosario')]);
        expect(selection.dealsToCreate).toHaveLength(0);
        expect(selection.pipelineToCreate).toHaveLength(0);
    });
});
