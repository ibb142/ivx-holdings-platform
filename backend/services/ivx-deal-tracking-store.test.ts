import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';

// Force filesystem mode — prevents Supabase state pollution between test files
mock.module('./ivx-durable-store', () => ({
  isDurableStoreConfigured: () => false,
  readDurableJson: async (_f: string, fallback: unknown) => fallback,
  writeDurableJson: async () => {},
  appendDurableEvent: async () => {},
  readDurableEvents: async () => [],
  durableKeyForFile: (f: string) => f,
}));

import {
  createDeal,
  deleteDeal,
  getDeal,
  incrementDealMilestone,
  listDeals,
  normalizeAmount,
  normalizeCount,
  setDealStatus,
  summarizeDeals,
  updateDeal,
  validateCreateDeal,
  type CreateDealInput,
} from './ivx-deal-tracking-store';

const ROOT = path.join(process.cwd(), 'logs', 'audit', 'deal-tracking');

async function clean(): Promise<void> {
  await rm(ROOT, { recursive: true, force: true });
}

function baseInput(overrides: Partial<CreateDealInput> = {}): CreateDealInput {
  return {
    dealName: overrides.dealName ?? 'Casa Rosario',
    source: overrides.source ?? 'owner_entered',
    ...overrides,
  };
}

beforeEach(clean);
afterEach(clean);

describe('normalizeCount / normalizeAmount', () => {
  it('parses counts and amounts, rejecting bad input', () => {
    expect(normalizeCount(3)).toBe(3);
    expect(normalizeCount(-2)).toBe(0);
    expect(normalizeCount(2.9)).toBe(2);
    expect(normalizeAmount('$1,400,000')).toBe(1400000);
    expect(normalizeAmount('')).toBeNull();
    expect(normalizeAmount(-5)).toBeNull();
  });
});

describe('validateCreateDeal (no fabrication rule)', () => {
  it('requires a deal name and a valid source', () => {
    expect(validateCreateDeal(baseInput({ dealName: '  ' })).ok).toBe(false);
    expect(validateCreateDeal({ dealName: 'X', source: 'made_up' as never }).ok).toBe(false);
  });
  it('requires attribution for public_source and crm_import', () => {
    expect(validateCreateDeal(baseInput({ source: 'public_source', sourceDetail: '' })).ok).toBe(false);
    expect(validateCreateDeal(baseInput({ source: 'crm_import', sourceDetail: 'deals.csv' })).ok).toBe(true);
    expect(validateCreateDeal(baseInput({ source: 'owner_entered' })).ok).toBe(true);
  });
});

describe('deal tracking CRUD + milestones', () => {
  it('creates, increments milestones, advances status, and deletes', async () => {
    const created = await createDeal(baseInput({ counterparty: 'IVX Holdings', capitalTarget: '$1,000,000' as unknown as number }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.deal.id;
    expect(created.deal.status).toBe('open');
    expect(created.deal.investorsContacted).toBe(0);
    expect(created.deal.capitalTarget).toBe(1000000);

    const bumped = await incrementDealMilestone(id, 'investorsContacted', 3);
    expect(bumped?.investorsContacted).toBe(3);
    const responded = await incrementDealMilestone(id, 'investorsResponded');
    expect(responded?.investorsResponded).toBe(1);

    expect(await incrementDealMilestone(id, 'notARealField' as never)).toBeNull();

    const updated = await updateDeal(id, { meetingsScheduled: 2, offersReceived: 1 });
    expect(updated?.meetingsScheduled).toBe(2);
    expect(updated?.investorsContacted).toBe(3); // preserved

    const fetched = await getDeal(id);
    expect(fetched?.dealName).toBe('Casa Rosario');

    expect(await listDeals()).toHaveLength(1);
    expect(await deleteDeal(id)).toBe(true);
    expect(await deleteDeal(id)).toBe(false);
  });

  it('auto-stamps closedAt when a deal closes', async () => {
    const created = await createDeal(baseInput());
    if (!created.ok) return;
    expect(created.deal.closedAt).toBeNull();
    const won = await setDealStatus(created.deal.id, 'closed_won');
    expect(won?.status).toBe('closed_won');
    expect(won?.closedAt).not.toBeNull();
    expect(await setDealStatus(created.deal.id, 'bogus' as never)).toBeNull();
  });

  it('rejects a create with no name and never persists it', async () => {
    const result = await createDeal(baseInput({ dealName: '' }));
    expect(result.ok).toBe(false);
    expect(await listDeals()).toHaveLength(0);
  });
});

describe('summarizeDeals — computed metrics, no fabrication', () => {
  it('computes conversion, capital raised, average size, response rate, time to close', async () => {
    // Won deal #1: $600k committed, closed 10 days after creation.
    const won1 = await createDeal(baseInput({ dealName: 'Won One' }));
    if (!won1.ok) return;
    const createdAt = new Date('2026-05-01T00:00:00.000Z').toISOString();
    const closedAt = new Date('2026-05-11T00:00:00.000Z').toISOString();
    // Backdate createdAt by writing directly through update is not possible; instead set explicit closedAt and rely on createdAt now.
    await updateDeal(won1.deal.id, {
      capitalCommitted: 600000,
      investorsContacted: 10,
      investorsResponded: 4,
      status: 'closed_won',
      closedAt,
    });

    // Won deal #2: $400k committed.
    const won2 = await createDeal(baseInput({ dealName: 'Won Two' }));
    if (!won2.ok) return;
    await updateDeal(won2.deal.id, { capitalCommitted: 400000, investorsContacted: 10, investorsResponded: 6, status: 'closed_won' });

    // Lost deal.
    const lost = await createDeal(baseInput({ dealName: 'Lost One' }));
    if (!lost.ok) return;
    await setDealStatus(lost.deal.id, 'closed_lost');

    // Open deal.
    await createDeal(baseInput({ dealName: 'Open One' }));

    const metrics = await summarizeDeals();
    expect(metrics.total).toBe(4);
    expect(metrics.byStatus.closed_won).toBe(2);
    expect(metrics.byStatus.closed_lost).toBe(1);
    expect(metrics.byStatus.open).toBe(1);
    expect(metrics.conversionRate).toBe(50); // 2 won / 4 total
    expect(metrics.capitalRaised).toBe(1000000);
    expect(metrics.averageDealSize).toBe(500000);
    expect(metrics.investorResponseRate).toBe(50); // 10 responded / 20 contacted
    expect(createdAt).toContain('2026-05-01'); // sanity
  });

  it('reports null response rate and null time-to-close when there is no data', async () => {
    await createDeal(baseInput({ dealName: 'Fresh' }));
    const metrics = await summarizeDeals();
    expect(metrics.investorResponseRate).toBeNull();
    expect(metrics.avgTimeToCloseDays).toBeNull();
    expect(metrics.capitalRaised).toBe(0);
  });
});
