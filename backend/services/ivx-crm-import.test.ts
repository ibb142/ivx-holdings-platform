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
  mapCsvToInvestorInputs,
  mapManualRowsToInvestorInputs,
  parseCsv,
  parseCsvToInvestorInputs,
} from './ivx-crm-import';
import { importInvestors, listInvestors, summarizeInvestors } from './ivx-investor-crm-store';

const CRM_ROOT = path.join(process.cwd(), 'logs', 'audit', 'investor-crm');

async function clean(): Promise<void> {
  await rm(CRM_ROOT, { recursive: true, force: true });
}

beforeEach(clean);
afterEach(clean);

describe('parseCsv', () => {
  it('parses quoted fields, embedded commas, escaped quotes, and CRLF', () => {
    const csv = 'name,company,notes\r\n"Doe, Jane","Acme, Inc.","Said ""yes"""\r\nBob,Beta,Plain\r\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(['name', 'company', 'notes']);
    expect(rows[1]).toEqual(['Doe, Jane', 'Acme, Inc.', 'Said "yes"']);
    expect(rows[2]).toEqual(['Bob', 'Beta', 'Plain']);
  });

  it('drops fully-empty trailing rows', () => {
    expect(parseCsv('name\nA\n\n')).toEqual([['name'], ['A']]);
  });
});

describe('mapCsvToInvestorInputs', () => {
  it('maps aliased headers and applies the default party type', () => {
    const csv = 'Full Name,Organization,Email,Mobile,City\nJane Capital,Capital Partners,jane@x.com,305-555-0100,Miami';
    const parsed = mapCsvToInvestorInputs(parseCsv(csv), { partyType: 'buyer', sourceDetail: 'buyers.csv' });
    expect(parsed.inputs).toHaveLength(1);
    const input = parsed.inputs[0]!;
    expect(input.name).toBe('Jane Capital');
    expect(input.company).toBe('Capital Partners');
    expect(input.email).toBe('jane@x.com');
    expect(input.phone).toBe('305-555-0100');
    expect(input.location).toBe('Miami');
    expect(input.partyType).toBe('buyer');
    expect(input.source).toBe('crm_import');
    expect(input.sourceDetail).toBe('buyers.csv');
  });

  it('honors a per-row partyType column and skips rows with no name', () => {
    const csv = 'name,role\nAcme Fund,investor\n,broker\nBeta Lending,lender';
    const parsed = mapCsvToInvestorInputs(parseCsv(csv), { sourceDetail: 'mixed.csv' });
    expect(parsed.inputs.map((i) => i.partyType)).toEqual(['investor', 'lender']);
    expect(parsed.skippedRows).toHaveLength(1);
    expect(parsed.skippedRows[0]!.reason).toContain('never fabricates');
  });

  it('never fabricates a contact: a header-only file yields zero inputs', () => {
    const parsed = parseCsvToInvestorInputs('name,email\n', { sourceDetail: 'empty.csv' });
    expect(parsed.inputs).toHaveLength(0);
    expect(parsed.totalRows).toBe(0);
  });
});

describe('mapManualRowsToInvestorInputs', () => {
  it('maps structured rows and reports nameless rows as skipped', () => {
    const parsed = mapManualRowsToInvestorInputs(
      [{ name: 'Carlos Builder', company: 'One Stop', partyType: 'developer' }, { company: 'NoName LLC' }],
      { sourceDetail: 'manual 2026-06-03' },
    );
    expect(parsed.inputs).toHaveLength(1);
    expect(parsed.inputs[0]!.partyType).toBe('developer');
    expect(parsed.skippedRows).toHaveLength(1);
  });
});

describe('importInvestors (durable bulk write)', () => {
  it('persists valid rows, reports counts, and rolls up by party type', async () => {
    const csv = [
      'name,company,partyType',
      'Jane Capital,Capital Partners,investor',
      'Bob Buyer,,buyer',
      'Carlos Builder,One Stop,developer',
    ].join('\n');
    const parsed = parseCsvToInvestorInputs(csv, { sourceDetail: 'seed.csv' });
    const result = await importInvestors(parsed.inputs);

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(await listInvestors()).toHaveLength(3);

    const summary = await summarizeInvestors();
    expect(summary.total).toBe(3);
    expect(summary.byPartyType.investor).toBe(1);
    expect(summary.byPartyType.buyer).toBe(1);
    expect(summary.byPartyType.developer).toBe(1);
    expect(summary.bySource.crm_import).toBe(3);
  });

  it('skips invalid inputs without persisting them', async () => {
    const result = await importInvestors([
      { name: 'Valid Co', source: 'crm_import', sourceDetail: 'a.csv' },
      { name: '', source: 'crm_import', sourceDetail: 'a.csv' },
      { name: 'No Attribution', source: 'crm_import', sourceDetail: '' },
    ]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(2);
    expect(await listInvestors()).toHaveLength(1);
  });

  it('detects duplicates within a batch and against existing records', async () => {
    const first = await importInvestors([
      { name: 'Jane Capital', source: 'crm_import', sourceDetail: 'a.csv', email: 'jane@x.com', partyType: 'investor' },
      { name: 'Jane Capital', source: 'crm_import', sourceDetail: 'a.csv', email: 'jane@x.com', partyType: 'investor' },
    ]);
    expect(first.imported).toBe(1);
    expect(first.duplicates).toBe(1);
    expect(first.duplicateRows).toHaveLength(1);
    expect(await listInvestors()).toHaveLength(1);

    // Re-importing the same person against the existing CRM is a duplicate, not a new record.
    const second = await importInvestors([
      { name: 'Jane Capital', source: 'crm_import', sourceDetail: 'b.csv', email: 'jane@x.com', partyType: 'investor' },
      { name: 'Bob Buyer', source: 'crm_import', sourceDetail: 'b.csv', partyType: 'buyer' },
    ]);
    expect(second.imported).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(await listInvestors()).toHaveLength(2);
  });
});
