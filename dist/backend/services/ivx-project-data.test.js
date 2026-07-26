import { describe, expect, test } from 'bun:test';
import { filterPublishedDeals, normalizeDeal } from './ivx-project-data';
const CASA_ROSARIO = {
    id: 'casa-rosario-001',
    title: 'Casa Rosario',
    property_address: 'Pembroke Pines, FL',
    expected_roi: 25,
    sale_price: 1200000,
    min_investment: 50000,
    distribution_frequency: 'Monthly',
    status: 'active',
    published: true,
    photos: ['a.jpg', 'b.jpg', 'c.jpg'],
};
const PEREZ = {
    id: 'perez-residence-001',
    project_name: 'Perez Residence',
    city: 'Miami',
    state: 'FL',
    expectedROI: 30,
    total_investment: 800000,
    status: 'published',
    published: true,
    photos: '["x.jpg"]',
};
const DRAFT = {
    id: 'draft-001',
    title: 'Unpublished Draft',
    status: 'draft',
    published: false,
};
const TRASHED = {
    id: 'trash-001',
    title: 'Old Deal',
    status: 'trashed',
    published: true,
};
describe('normalizeDeal', () => {
    test('maps Casa Rosario fields (snake_case)', () => {
        const p = normalizeDeal(CASA_ROSARIO);
        expect(p.name).toBe('Casa Rosario');
        expect(p.location).toBe('Pembroke Pines, FL');
        expect(p.roi).toBe('25%');
        expect(p.price).toBe('$1,200,000');
        expect(p.ownershipMinimum).toBe('$50,000');
        expect(p.timeline).toBe('Monthly');
        expect(p.published).toBe(true);
        expect(p.mediaCount).toBe(3);
    });
    test('maps camelCase + composed city/state location + stringified photos', () => {
        const p = normalizeDeal(PEREZ);
        expect(p.name).toBe('Perez Residence');
        expect(p.location).toBe('Miami, FL');
        expect(p.roi).toBe('30%');
        expect(p.mediaCount).toBe(1);
    });
    test('returns null details instead of fabricating when absent', () => {
        const p = normalizeDeal({ id: 'x', title: 'Bare Deal' });
        expect(p.price).toBeNull();
        expect(p.roi).toBeNull();
        expect(p.ownershipMinimum).toBeNull();
        expect(p.mediaCount).toBe(0);
    });
});
describe('filterPublishedDeals', () => {
    test('keeps published+active deals, drops drafts and trashed', () => {
        const rows = [CASA_ROSARIO, PEREZ, DRAFT, TRASHED];
        const result = filterPublishedDeals(rows);
        const names = result.map((d) => normalizeDeal(d).name);
        expect(names).toContain('Casa Rosario');
        expect(names).toContain('Perez Residence');
        expect(names).not.toContain('Unpublished Draft');
        expect(names).not.toContain('Old Deal');
    });
    test('falls back to all visible rows when none are published', () => {
        const result = filterPublishedDeals([DRAFT]);
        expect(result.length).toBe(1);
    });
});
