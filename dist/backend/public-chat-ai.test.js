import { describe, expect, test } from 'bun:test';
import { asksAboutProjects, buildProjectGrounding } from './services/ivx-project-intent';
function baseResult(overrides) {
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
describe('asksAboutProjects', () => {
    test('detects direct project questions', () => {
        expect(asksAboutProjects('What projects do I have?')).toBe(true);
        expect(asksAboutProjects('List all my deals')).toBe(true);
        expect(asksAboutProjects('Tell me about Casa Rosario')).toBe(true);
        expect(asksAboutProjects('what is on my landing page')).toBe(true);
        expect(asksAboutProjects('show me the properties in my portfolio')).toBe(true);
    });
    test('ignores unrelated questions', () => {
        expect(asksAboutProjects('How do I reset my password?')).toBe(false);
        expect(asksAboutProjects('Is the API healthy?')).toBe(false);
    });
});
describe('buildProjectGrounding', () => {
    test('lists real projects and forbids refusal', () => {
        const grounding = buildProjectGrounding(baseResult({
            totalRows: 2,
            publishedCount: 2,
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
                {
                    id: 'perez-001',
                    name: 'Perez Residence',
                    location: 'Miami, FL',
                    price: '$800,000',
                    roi: '30%',
                    timeline: null,
                    ownershipMinimum: null,
                    status: 'published',
                    published: true,
                    mediaCount: 1,
                },
            ],
            projectNames: ['Casa Rosario', 'Perez Residence'],
        }));
        expect(grounding).toContain('Casa Rosario');
        expect(grounding).toContain('Perez Residence');
        expect(grounding).toContain('25%');
        expect(grounding).toContain('Do NOT say you cannot access project names');
    });
    test('states empty source honestly instead of refusing', () => {
        const grounding = buildProjectGrounding(baseResult({ totalRows: 0, publishedCount: 0 }));
        expect(grounding).toContain('0 published projects');
        expect(grounding).toContain('Do NOT claim you cannot access projects');
    });
    test('names the exact missing env when unconfigured', () => {
        const grounding = buildProjectGrounding(baseResult({ ok: false, configured: false, httpStatus: null, missingEnv: ['SUPABASE_SERVICE_ROLE_KEY'] }));
        expect(grounding).toContain('NOT CONFIGURED');
        expect(grounding).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });
});
