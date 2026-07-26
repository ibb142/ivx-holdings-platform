import { describe, expect, test } from 'bun:test';
import { buildBusinessContextBlock, getCompanyContext, getLandingContext, getOwnerContext, } from './ivx-business-context';
function projectsResult(overrides) {
    return {
        ok: true,
        configured: true,
        source: 'supabase:jv_deals',
        fetchedAt: '2026-05-30T00:00:00.000Z',
        httpStatus: 200,
        totalRows: 0,
        publishedCount: 0,
        projects: [],
        projectNames: [],
        error: null,
        missingEnv: [],
        ...overrides,
    };
}
function context(projects) {
    return {
        loadedAt: '2026-05-30T00:00:00.000Z',
        projects,
        company: getCompanyContext(),
        landing: getLandingContext(),
        owner: getOwnerContext(),
    };
}
describe('static context buckets', () => {
    test('company context names IVX and its model', () => {
        const company = getCompanyContext();
        expect(company.name).toContain('IVX');
        expect(company.model.toLowerCase()).toContain('joint');
    });
    test('landing context defaults to ivxholding.com', () => {
        const landing = getLandingContext();
        expect(landing.url).toContain('ivxholding.com');
    });
    test('owner context exposes a role even without an email', () => {
        const owner = getOwnerContext();
        expect(owner.role.toLowerCase()).toContain('owner');
    });
});
describe('buildBusinessContextBlock', () => {
    test('always includes company, landing, and owner context', () => {
        const block = buildBusinessContextBlock(context(projectsResult({})));
        expect(block).toContain('IVX BUSINESS CONTEXT');
        expect(block).toContain('COMPANY:');
        expect(block).toContain('LANDING PAGE:');
        expect(block).toContain('OWNER:');
    });
    test('answers Casa Rosario from loaded deal data', () => {
        const block = buildBusinessContextBlock(context(projectsResult({
            totalRows: 1,
            publishedCount: 1,
            projects: [
                {
                    id: 'casa-rosario-001',
                    name: 'Casa Rosario',
                    location: 'Pembroke Pines, FL',
                    price: '$1,200,000',
                    roi: '25%',
                    timeline: 'Monthly',
                    ownershipMinimum: '$50,000',
                    status: 'active',
                    published: true,
                    mediaCount: 3,
                },
            ],
            projectNames: ['Casa Rosario'],
        })));
        expect(block).toContain('Casa Rosario');
        expect(block).toContain('What is Casa Rosario?');
        expect(block).toContain('25%');
        expect(block).toContain('Do NOT say you cannot access project names');
    });
    test('states empty source honestly instead of refusing', () => {
        const block = buildBusinessContextBlock(context(projectsResult({ totalRows: 0, publishedCount: 0 })));
        expect(block).toContain('0 published projects');
        expect(block).toContain('Do NOT fabricate');
    });
    test('names the exact missing env when project source is unconfigured', () => {
        const block = buildBusinessContextBlock(context(projectsResult({ ok: false, configured: false, httpStatus: null, missingEnv: ['SUPABASE_SERVICE_ROLE_KEY'] })));
        expect(block).toContain('NOT CONFIGURED');
        expect(block).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });
    test('forbids generic refusal in the closing instruction', () => {
        const block = buildBusinessContextBlock(context(projectsResult({})));
        expect(block).toContain('Never reply with a generic "I cannot access"');
    });
});
