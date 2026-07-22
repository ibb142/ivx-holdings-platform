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
  clampScore,
  createInvestor,
  deleteInvestor,
  getInvestor,
  listInvestors,
  normalizeDate,
  setInvestorStatus,
  summarizeInvestors,
  updateInvestor,
  validateCreateInvestor,
  type CreateInvestorInput,
} from './ivx-investor-crm-store';

const CRM_ROOT = path.join(process.cwd(), 'logs', 'audit', 'investor-crm');

async function clean(): Promise<void> {
  await rm(CRM_ROOT, { recursive: true, force: true });
}

function baseInput(overrides: Partial<CreateInvestorInput> = {}): CreateInvestorInput {
  return {
    name: overrides.name ?? 'Acme Family Office',
    source: overrides.source ?? 'owner_entered',
    ...overrides,
  };
}

beforeEach(clean);
afterEach(clean);

describe('clampScore', () => {
  it('clamps to 0–100 integers and rejects non-numbers', () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(73.6)).toBe(74);
    expect(clampScore('not-a-number')).toBe(0);
  });
});

describe('normalizeDate', () => {
  it('returns ISO for valid dates and null otherwise', () => {
    expect(normalizeDate('2026-05-31')).toContain('2026-05-31');
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate('garbage')).toBeNull();
  });
});

describe('validateCreateInvestor (no fabrication rule)', () => {
  it('requires a name', () => {
    const result = validateCreateInvestor(baseInput({ name: '   ' }));
    expect(result.ok).toBe(false);
  });

  it('requires a valid source', () => {
    const result = validateCreateInvestor({ name: 'X', source: 'made_up' as never });
    expect(result.ok).toBe(false);
  });

  it('requires attribution for public_source and crm_import', () => {
    expect(validateCreateInvestor(baseInput({ source: 'public_source', sourceDetail: '' })).ok).toBe(false);
    expect(validateCreateInvestor(baseInput({ source: 'crm_import', sourceDetail: '' })).ok).toBe(false);
    expect(validateCreateInvestor(baseInput({ source: 'public_source', sourceDetail: 'https://sec.gov/...' })).ok).toBe(true);
  });

  it('accepts owner_entered without attribution', () => {
    expect(validateCreateInvestor(baseInput({ source: 'owner_entered' })).ok).toBe(true);
  });
});

describe('CRUD lifecycle', () => {
  it('creates, reads, updates, sets status, and deletes', async () => {
    const created = await createInvestor(baseInput({
      name: 'Jane Capital',
      company: 'Capital Partners',
      email: 'jane@capital.com',
      preferredMarkets: ['South Florida', 'Miami', 'Miami'],
      preferredAssetClasses: ['Multifamily'],
      leadScore: 120,
      relationshipScore: 40,
      accreditedStatus: 'accredited',
    }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.investor.status).toBe('prospect');
    expect(created.investor.leadScore).toBe(100); // clamped
    expect(created.investor.preferredMarkets).toEqual(['South Florida', 'Miami']); // de-duped

    const id = created.investor.id;
    const fetched = await getInvestor(id);
    expect(fetched?.name).toBe('Jane Capital');

    const updated = await updateInvestor(id, { phone: '+1 305 555 0100', notes: 'Met at conference' });
    expect(updated?.phone).toBe('+1 305 555 0100');
    expect(updated?.email).toBe('jane@capital.com'); // unchanged field preserved

    const moved = await setInvestorStatus(id, 'meeting_scheduled');
    expect(moved?.status).toBe('meeting_scheduled');

    expect(await setInvestorStatus(id, 'bogus' as never)).toBeNull();

    const list = await listInvestors();
    expect(list).toHaveLength(1);

    expect(await deleteInvestor(id)).toBe(true);
    expect(await deleteInvestor(id)).toBe(false);
    expect(await listInvestors()).toHaveLength(0);
  });

  it('rejects a create with no name and never persists it', async () => {
    const result = await createInvestor(baseInput({ name: '' }));
    expect(result.ok).toBe(false);
    expect(await listInvestors()).toHaveLength(0);
  });
});

describe('summarizeInvestors', () => {
  it('rolls up totals by status/source and averages scores', async () => {
    await createInvestor(baseInput({ name: 'A', source: 'owner_entered', status: 'active', leadScore: 80, relationshipScore: 60, accreditedStatus: 'accredited' }));
    await createInvestor(baseInput({ name: 'B', source: 'crm_import', sourceDetail: 'import-2026.csv', status: 'invested', leadScore: 40, relationshipScore: 20 }));

    const summary = await summarizeInvestors();
    expect(summary.total).toBe(2);
    expect(summary.byStatus.active).toBe(1);
    expect(summary.byStatus.invested).toBe(1);
    expect(summary.bySource.owner_entered).toBe(1);
    expect(summary.bySource.crm_import).toBe(1);
    expect(summary.accredited).toBe(1);
    expect(summary.avgLeadScore).toBe(60);
    expect(summary.avgRelationshipScore).toBe(40);
  });
});
