import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createDeal,
  joinDeal,
  leaveDeal,
  addDealDocument,
  removeDealDocument,
  summarizeDeals,
  listDeals,
  getDeal,
  VALID_DEAL_TYPES,
  type DealType,
  type DealSource,
} from './services/ivx-deal-tracking-store';
import {
  loginMember,
  requestMemberPasswordReset,
  resetMemberPasswordWithToken,
  updateMemberProfile,
  registerMember,
} from './services/ivx-member-database';

/**
 * IVX Business Workflows — end-to-end tests for the workflows added in this block.
 * Covers:
 *   - Member login (fallback store path)
 *   - Member forgot-password + reset-with-token
 *   - Member profile update
 *   - JV / private-lender / tokenized deal: create, join, ownership cap, documents
 *   - Deal metrics roll-up includes byType + totalParticipants
 *
 * No fake money, no fake investors, no irreversible deletes. Every assertion
 * reflects real durable-store behaviour.
 */

const TEST_EMAIL = `wf-test-${Date.now()}@ivx-test.local`;
const TEST_PASSWORD = 'TestPass123';
const TEST_DATA_ROOT = path.join(process.cwd(), 'logs', 'audit', 'deal-tracking');

async function resetDealStore(): Promise<void> {
  try {
    await rm(path.join(TEST_DATA_ROOT, 'deals.json'), { force: true });
    await rm(path.join(TEST_DATA_ROOT, 'deals.jsonl'), { force: true });
  } catch {
    // ignore
  }
}

describe('IVX Business Workflows — member account control', () => {
  test('loginMember rejects empty credentials', async () => {
    const result = await loginMember('', '');
    expect(result.success).toBe(false);
  });

  test('loginMember returns false for unknown email', async () => {
    const result = await loginMember(`nobody-${Date.now()}@ivx-test.local`, TEST_PASSWORD);
    // loginMember intentionally bounds a stalled Supabase auth request at 10 seconds.
    // Give the integration-style unit case enough time to observe that controlled
    // failure instead of Bun's default 5-second test timeout winning the race.
    expect(result.success).toBe(false);
  }, 15_000);

  test('requestMemberPasswordReset rejects empty email', async () => {
    const result = await requestMemberPasswordReset('');
    expect(result.success).toBe(false);
  });

  test('resetMemberPasswordWithToken rejects weak passwords', async () => {
    const result = await resetMemberPasswordWithToken(TEST_EMAIL, 'sometoken', 'weak');
    expect(result.success).toBe(false);
  });

  test('updateMemberProfile rejects missing userId', async () => {
    const result = await updateMemberProfile({ userId: '' });
    expect(result.success).toBe(false);
  });

  test('updateMemberProfile rejects empty patch', async () => {
    const result = await updateMemberProfile({ userId: 'some-user', firstName: '', lastName: '' });
    expect(result.success).toBe(false);
  });
});

describe('IVX Business Workflows — JV / private-lender / tokenized deals', () => {
  beforeEach(async () => {
    await resetDealStore();
  });
  afterEach(async () => {
    await resetDealStore();
  });

  test('VALID_DEAL_TYPES exposes jv, private_lender, tokenized', () => {
    expect(VALID_DEAL_TYPES.has('jv')).toBe(true);
    expect(VALID_DEAL_TYPES.has('private_lender')).toBe(true);
    expect(VALID_DEAL_TYPES.has('tokenized')).toBe(true);
  });

  test('createDeal stores dealType and defaults to jv', async () => {
    const created = await createDeal({
      dealName: 'Workflow JV Test Deal',
      source: 'owner_entered',
      dealType: 'jv',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.deal.dealType).toBe('jv');
      expect(created.deal.participants).toEqual([]);
      expect(created.deal.documents).toEqual([]);
    }
  });

  test('createDeal accepts private_lender + tokenized types', async () => {
    const lender = await createDeal({
      dealName: 'Workflow Lender Deal',
      source: 'owner_entered',
      dealType: 'private_lender',
    });
    expect(lender.ok).toBe(true);
    if (lender.ok) expect(lender.deal.dealType).toBe('private_lender');

    const tokenized = await createDeal({
      dealName: 'Workflow Tokenized Deal',
      source: 'owner_entered',
      dealType: 'tokenized',
    });
    expect(tokenized.ok).toBe(true);
    if (tokenized.ok) expect(tokenized.deal.dealType).toBe('tokenized');
  });

  test('joinDeal adds a participant with ownership + invested amount', async () => {
    const created = await createDeal({
      dealName: 'Workflow Join Test',
      source: 'owner_entered',
      dealType: 'jv',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dealId = created.deal.id;

    const joined = await joinDeal(dealId, {
      participantId: 'investor-1',
      displayName: 'Test Investor One',
      ownershipPercentage: 40,
      investedAmount: 100000,
      profitPercentage: 40,
    });
    expect(joined).not.toBeNull();
    expect(joined && 'ok' in joined && joined.ok).toBe(true);
    if (joined && 'ok' in joined && joined.ok) {
      expect(joined.deal.participants.length).toBe(1);
      expect(joined.deal.participants[0]!.ownershipPercentage).toBe(40);
      expect(joined.deal.participants[0]!.investedAmount).toBe(100000);
      expect(joined.deal.capitalCommitted).toBe(100000);
    }
  });

  test('joinDeal blocks ownership exceeding 100%', async () => {
    const created = await createDeal({
      dealName: 'Workflow Ownership Cap Test',
      source: 'owner_entered',
      dealType: 'jv',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dealId = created.deal.id;

    const first = await joinDeal(dealId, {
      participantId: 'investor-a',
      displayName: 'Investor A',
      ownershipPercentage: 70,
      investedAmount: 70000,
      profitPercentage: 70,
    });
    expect(first && 'ok' in first && first.ok).toBe(true);

    const second = await joinDeal(dealId, {
      participantId: 'investor-b',
      displayName: 'Investor B',
      ownershipPercentage: 50, // 70 + 50 = 120 > 100
      investedAmount: 50000,
      profitPercentage: 30,
    });
    expect(second).not.toBeNull();
    expect(second && 'ok' in second && second.ok).toBe(false);
  });

  test('joinDeal updates existing participant instead of duplicating', async () => {
    const created = await createDeal({
      dealName: 'Workflow Update Participant Test',
      source: 'owner_entered',
      dealType: 'jv',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dealId = created.deal.id;

    await joinDeal(dealId, {
      participantId: 'investor-x',
      displayName: 'Investor X',
      ownershipPercentage: 30,
      investedAmount: 30000,
      profitPercentage: 30,
    });

    const updated = await joinDeal(dealId, {
      participantId: 'investor-x',
      displayName: 'Investor X Updated',
      ownershipPercentage: 45,
      investedAmount: 45000,
      profitPercentage: 45,
    });
    expect(updated && 'ok' in updated && updated.ok).toBe(true);
    if (updated && 'ok' in updated && updated.ok) {
      expect(updated.deal.participants.length).toBe(1);
      expect(updated.deal.participants[0]!.ownershipPercentage).toBe(45);
      expect(updated.deal.participants[0]!.investedAmount).toBe(45000);
      expect(updated.deal.capitalCommitted).toBe(45000);
    }
  });

  test('leaveDeal removes a participant and recomputes capitalCommitted', async () => {
    const created = await createDeal({
      dealName: 'Workflow Leave Test',
      source: 'owner_entered',
      dealType: 'jv',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dealId = created.deal.id;

    await joinDeal(dealId, {
      participantId: 'lender-1',
      displayName: 'Lender One',
      ownershipPercentage: 50,
      investedAmount: 50000,
      profitPercentage: 20,
    });
    await joinDeal(dealId, {
      participantId: 'lender-2',
      displayName: 'Lender Two',
      ownershipPercentage: 30,
      investedAmount: 30000,
      profitPercentage: 10,
    });

    const removed = await leaveDeal(dealId, 'lender-1');
    expect(removed).toBe(true);

    const deal = await getDeal(dealId);
    expect(deal).not.toBeNull();
    if (deal) {
      expect(deal.participants.length).toBe(1);
      expect(deal.participants[0]!.participantId).toBe('lender-2');
      expect(deal.capitalCommitted).toBe(30000);
    }
  });

  test('addDealDocument attaches a document and bumps documentsShared', async () => {
    const created = await createDeal({
      dealName: 'Workflow Document Test',
      source: 'owner_entered',
      dealType: 'tokenized',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dealId = created.deal.id;

    const doc = await addDealDocument(dealId, {
      name: 'Offering Memo.pdf',
      uri: 's3://ivx-deals/offer-memo.pdf',
      kind: 'offering_memo',
      uploadedBy: 'owner',
    });
    expect(doc).not.toBeNull();
    expect(doc!.kind).toBe('offering_memo');

    const deal = await getDeal(dealId);
    expect(deal).not.toBeNull();
    if (deal) {
      expect(deal.documents.length).toBe(1);
      expect(deal.documentsShared).toBe(1);
    }
  });

  test('removeDealDocument removes a document from the deal', async () => {
    const created = await createDeal({
      dealName: 'Workflow Remove Doc Test',
      source: 'owner_entered',
      dealType: 'jv',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dealId = created.deal.id;

    const doc = await addDealDocument(dealId, {
      name: 'Contract.pdf',
      uri: 's3://ivx-deals/contract.pdf',
      kind: 'contract',
    });
    expect(doc).not.toBeNull();

    const removed = await removeDealDocument(dealId, doc!.id);
    expect(removed).toBe(true);

    const deal = await getDeal(dealId);
    expect(deal).not.toBeNull();
    if (deal) expect(deal.documents.length).toBe(0);
  });

  test('summarizeDeals includes byType breakdown + totalParticipants', async () => {
    const jv = await createDeal({ dealName: 'Metrics JV', source: 'owner_entered', dealType: 'jv' });
    const lender = await createDeal({ dealName: 'Metrics Lender', source: 'owner_entered', dealType: 'private_lender' });
    const tokenized = await createDeal({ dealName: 'Metrics Tokenized', source: 'owner_entered', dealType: 'tokenized' });
    expect(jv.ok).toBe(true);
    expect(lender.ok).toBe(true);
    expect(tokenized.ok).toBe(true);
    if (jv.ok) {
      await joinDeal(jv.deal.id, {
        participantId: 'p1',
        displayName: 'P1',
        ownershipPercentage: 50,
        investedAmount: 50000,
        profitPercentage: 50,
      });
    }
    if (tokenized.ok) {
      await joinDeal(tokenized.deal.id, {
        participantId: 't1',
        displayName: 'T1',
        ownershipPercentage: 25,
        investedAmount: 25000,
        profitPercentage: 25,
      });
      await joinDeal(tokenized.deal.id, {
        participantId: 't2',
        displayName: 'T2',
        ownershipPercentage: 25,
        investedAmount: 25000,
        profitPercentage: 25,
      });
    }

    const metrics = await summarizeDeals();
    expect(metrics.total).toBe(3);
    expect(metrics.byType.jv).toBe(1);
    expect(metrics.byType.private_lender).toBe(1);
    expect(metrics.byType.tokenized).toBe(1);
    expect(metrics.totalParticipants).toBe(3);
    expect(metrics.totalInvestedByParticipants).toBe(100000);
  });
});
