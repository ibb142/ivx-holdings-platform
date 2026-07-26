import { describe, expect, test } from 'bun:test';
import { buildProjectDashboardPayload, handleProjectDashboardRequest, validateProjectDashboardQuery, } from './ivx-project-dashboard';
describe('validateProjectDashboardQuery', () => {
    test('defaults to window=all, view=full when no params', () => {
        const result = validateProjectDashboardQuery('https://api.ivxholding.com/api/ivx/project-dashboard');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.query.window).toBe('all');
            expect(result.query.view).toBe('full');
        }
    });
    test('accepts valid window + view', () => {
        const result = validateProjectDashboardQuery('https://api.ivxholding.com/api/ivx/project-dashboard?window=30d&view=summary');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.query.window).toBe('30d');
            expect(result.query.view).toBe('summary');
        }
    });
    test('rejects an unknown window with a 400', () => {
        const result = validateProjectDashboardQuery('https://api.ivxholding.com/api/ivx/project-dashboard?window=year');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(400);
            expect(result.field).toBe('window');
        }
    });
    test('rejects an unknown view with a 400', () => {
        const result = validateProjectDashboardQuery('https://api.ivxholding.com/api/ivx/project-dashboard?view=raw');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(400);
            expect(result.field).toBe('view');
        }
    });
});
describe('buildProjectDashboardPayload', () => {
    test('includes featureAreas only for the full view', () => {
        const full = buildProjectDashboardPayload({ window: 'all', view: 'full' });
        const summary = buildProjectDashboardPayload({ window: 'all', view: 'summary' });
        expect(Array.isArray(full.featureAreas)).toBe(true);
        expect(summary.featureAreas).toBeUndefined();
    });
    test('metrics are internally consistent', () => {
        const payload = buildProjectDashboardPayload({ window: 'all', view: 'full' });
        const { metrics } = payload;
        expect(metrics.totalFeatureAreas).toBe(metrics.liveFeatureAreas + metrics.inProgressFeatureAreas + metrics.plannedFeatureAreas);
        expect(metrics.completionPercent).toBeGreaterThanOrEqual(0);
        expect(metrics.completionPercent).toBeLessThanOrEqual(100);
        expect(payload.secretValuesReturned).toBe(false);
    });
});
describe('handleProjectDashboardRequest', () => {
    test('returns 200 + JSON for a valid GET', async () => {
        const response = handleProjectDashboardRequest(new Request('https://api.ivxholding.com/api/ivx/project-dashboard'));
        expect(response.status).toBe(200);
        const body = (await response.json());
        expect(body.ok).toBe(true);
        expect(body.feature).toBe('ai-project-dashboard');
    });
    test('returns 400 for an invalid query', async () => {
        const response = handleProjectDashboardRequest(new Request('https://api.ivxholding.com/api/ivx/project-dashboard?window=bogus'));
        expect(response.status).toBe(400);
    });
    test('returns 405 for non-GET methods', () => {
        const response = handleProjectDashboardRequest(new Request('https://api.ivxholding.com/api/ivx/project-dashboard', { method: 'POST' }));
        expect(response.status).toBe(405);
    });
});
