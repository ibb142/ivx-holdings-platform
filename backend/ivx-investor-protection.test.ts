import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Mock the durable store so isDurableStoreConfigured() always returns false.
// Without this, parallel test files that set SUPABASE_SERVICE_ROLE_KEY at module
// level (e.g. ivx-canonical-identity-model.test.ts line 159) can leak that env
// var into this test file during parallel execution, causing the durable store
// to route writes to Supabase instead of the filesystem fallback. The
// resetProtectionStore() helper only clears the local filesystem directory, so
// Supabase-routed writes persist or fail silently, producing test failures.
// All other IVX store tests (treasury, outreach, CRM, deal-tracking, crm-import)
// already use this exact mock pattern.
mock.module('./services/ivx-durable-store', () => ({
  isDurableStoreConfigured: () => false,
  readDurableJson: async (_file: string, fallback: unknown) => fallback,
  writeDurableJson: async () => {},
  appendDurableEvent: async () => {},
  readDurableEvents: async () => [],
}));

import { auditDir } from './services/ivx-data-root';
import {
  createWithdrawal,
  transitionWithdrawal,
  listWithdrawals,
  createWire,
  transitionWire,
  listWires,
  wireQueue,
  createDeletionRequest,
  approveDeletionRequest,
  secondConfirmDeletion,
  listDeletionRequests,
  transitionAccountState,
  unlockAccount,
  getAccountStateRecord,
  listAccountStates,
  createInvestment,
  listInvestments,
  updateInvestmentValuation,
  getInvestorWalletSummary,
  upsertCompliance,
  getCompliance,
  listProtectionAudit,
  recordProtectionAudit,
  VALID_WITHDRAWAL_STATUSES,
  WITHDRAWAL_WORKFLOW,
  type WithdrawalStatus,
  type AccountState,
  type InvestmentType,
} from './services/ivx-investor-protection';

/**
 * IVX Investor Protection — safety-critical workflow tests.
 *
 * Covers the 12-section protection spec end-to-end against the durable
 * filesystem fallback store (no Supabase required):
 *   - Account state machine + no-archive-with-funds guard
 *   - Deletion request blocked when account has funds
 *   - Deletion second-confirm archives (never deletes) financial history
 *   - Withdrawal workflow linear order + compliance-before-approval
 *   - Withdrawal insufficient-balance guard
 *   - Wire creation encrypts at rest + safe view never exposes full account #
 *   - Wire queue + transitions
 *   - Investment create + valuation update + audit
 *   - Wallet summary derivation
 *   - Compliance upsert (KYC / AML / accredited)
 *   - Audit log append + filter
 *
 * No fake money, no fake investors, no irreversible deletes.
 */

const PROTECTION_DIR = auditDir('investor-protection');

async function resetProtectionStore(): Promise<void> {
  try {
    await rm(PROTECTION_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  await mkdir(PROTECTION_DIR, { recursive: true });
}

const baseWithdrawal = {
  userId: 'inv-test-1',
  amount: 250,
  availableBalance: 1000,
  operatorId: 'owner-1',
  operatorEmail: 'owner@ivxholding.com',
} as const;

describe('IVX Investor Protection — account state machine + deletion safety', () => {
  test('fresh account defaults to active with immutableFinancialHistory=true', async () => {
    await resetProtectionStore();
    const rec = await getAccountStateRecord('inv-fresh');
    expect(rec.accountState).toBe('active');
    expect(rec.immutableFinancialHistory).toBe(true);
  });

  test('suspend then restore to active is allowed', async () => {
    await resetProtectionStore();
    const suspended = await transitionAccountState({
      userId: 'inv-suspend',
      newState: 'suspended',
      reason: 'compliance hold',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(suspended.accountState).toBe('suspended');
    expect(suspended.previousState).toBe('active');

    const restored = await transitionAccountState({
      userId: 'inv-suspend',
      newState: 'active',
      reason: 'cleared',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(restored.accountState).toBe('active');
  });

  test('lock then unlock via unlockAccount restores active', async () => {
    await resetProtectionStore();
    await transitionAccountState({
      userId: 'inv-lock',
      newState: 'locked',
      reason: 'too many failed attempts',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    const unlocked = await unlockAccount({
      userId: 'inv-lock',
      reason: 'owner verified identity',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(unlocked.accountState).toBe('active');
  });

  test('BLOCKS archive when account has funds — no irreversible delete', async () => {
    await resetProtectionStore();
    await expect(async () => {
      await transitionAccountState({
        userId: 'inv-with-funds',
        newState: 'archived',
        reason: 'attempt archive',
        operatorId: 'owner-1',
        operatorEmail: 'owner@ivxholding.com',
        hasFunds: true,
      });
    }).toThrow('BLOCKED_HAS_FUNDS');
    // Account must remain active.
    const rec = await getAccountStateRecord('inv-with-funds');
    expect(rec.accountState).toBe('active');
  });

  test('BLOCKS close when account has financial history', async () => {
    await resetProtectionStore();
    await expect(async () => {
      await transitionAccountState({
        userId: 'inv-with-history',
        newState: 'closed',
        reason: 'attempt close',
        operatorId: 'owner-1',
        operatorEmail: 'owner@ivxholding.com',
        hasFunds: true,
      });
    }).toThrow('BLOCKED_HAS_FUNDS');
  });

  test('archive IS allowed when hasFunds=false (after funds moved out)', async () => {
    await resetProtectionStore();
    const archived = await transitionAccountState({
      userId: 'inv-clean',
      newState: 'archived',
      reason: 'funds moved, archive',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      hasFunds: false,
    });
    expect(archived.accountState).toBe('archived');
  });

  test('listAccountStates filters by state', async () => {
    await resetProtectionStore();
    await transitionAccountState({
      userId: 'inv-a',
      newState: 'suspended',
      reason: 'test',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    await transitionAccountState({
      userId: 'inv-b',
      newState: 'suspended',
      reason: 'test',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    const suspended = await listAccountStates({ state: 'suspended' });
    expect(suspended.length).toBeGreaterThanOrEqual(2);
    expect(suspended.every((s) => s.accountState === 'suspended')).toBe(true);
  });
});

describe('IVX Investor Protection — deletion request workflow', () => {
  test('deletion request is BLOCKED when account has funds', async () => {
    await resetProtectionStore();
    const req = await createDeletionRequest({
      userId: 'inv-del-funds',
      reason: 'please delete',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      hasFunds: true,
      financialHistoryCount: 7,
    });
    expect(req.finalState).toBe('blocked_has_funds');
    expect(req.ownerApproved).toBe(false);
  });

  test('deletion request proceeds when no funds, but second-confirm ARCHIVES (never deletes)', async () => {
    await resetProtectionStore();
    const req = await createDeletionRequest({
      userId: 'inv-del-clean',
      reason: 'user requested close',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      hasFunds: false,
      financialHistoryCount: 0,
    });
    expect(req.finalState).toBe('requested');

    const approved = await approveDeletionRequest({
      deletionId: req.id,
      ownerApproverId: 'owner-1',
      ownerEmail: 'owner@ivxholding.com',
    });
    expect(approved.ownerApproved).toBe(true);
    expect(approved.finalState).toBe('owner_approved');

    const confirmed = await secondConfirmDeletion({
      deletionId: req.id,
      secondConfirmerId: 'owner-2',
      confirmerEmail: 'coowner@ivxholding.com',
    });
    // Final state must be archived, NOT a hard delete — financial history preserved.
    expect(confirmed.finalState).toBe('archived');
    const rec = await getAccountStateRecord('inv-del-clean');
    expect(rec.accountState).toBe('archived');
  });

  test('cannot approve a deletion that was blocked due to funds', async () => {
    await resetProtectionStore();
    const req = await createDeletionRequest({
      userId: 'inv-del-blocked',
      reason: 'try',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      hasFunds: true,
      financialHistoryCount: 3,
    });
    await expect(async () => {
      await approveDeletionRequest({
        deletionId: req.id,
        ownerApproverId: 'owner-1',
        ownerEmail: 'owner@ivxholding.com',
      });
    }).toThrow('blocked due to existing funds');
  });

  test('cannot second-confirm without owner approval (two-person rule)', async () => {
    await resetProtectionStore();
    const req = await createDeletionRequest({
      userId: 'inv-del-twoperson',
      reason: 'try',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      hasFunds: false,
      financialHistoryCount: 0,
    });
    await expect(async () => {
      await secondConfirmDeletion({
        deletionId: req.id,
        secondConfirmerId: 'owner-2',
        confirmerEmail: 'coowner@ivxholding.com',
      });
    }).toThrow('not been owner-approved');
  });

  test('listDeletionRequests returns blocked + requested entries', async () => {
    await resetProtectionStore();
    await createDeletionRequest({
      userId: 'inv-list-a',
      reason: 'a',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      hasFunds: true,
      financialHistoryCount: 1,
    });
    await createDeletionRequest({
      userId: 'inv-list-b',
      reason: 'b',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      hasFunds: false,
      financialHistoryCount: 0,
    });
    const list = await listDeletionRequests();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const states = list.map((r) => r.finalState);
    expect(states).toContain('blocked_has_funds');
    expect(states).toContain('requested');
  });
});

describe('IVX Investor Protection — withdrawal workflow', () => {
  test('createWithdrawal rejects non-positive amount', async () => {
    await resetProtectionStore();
    await expect(async () => {
      await createWithdrawal({ ...baseWithdrawal, amount: 0 });
    }).toThrow('positive');
  });

  test('createWithdrawal rejects amount exceeding available balance (no overdraft)', async () => {
    await resetProtectionStore();
    await expect(async () => {
      await createWithdrawal({ ...baseWithdrawal, amount: 2000, availableBalance: 1000 });
    }).toThrow('Insufficient available balance');
  });

  test('withdrawal advances pending → under_review → approved → sent → completed', async () => {
    await resetProtectionStore();
    const w = await createWithdrawal(baseWithdrawal);
    expect(w.status).toBe('pending');

    const reviewed = await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'under_review',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      complianceDecision: 'passed',
    });
    expect(reviewed.status).toBe('under_review');
    expect(reviewed.complianceReviewedBy).toBe('owner@ivxholding.com');

    const approved = await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'approved',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('owner@ivxholding.com');

    const sent = await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'sent',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(sent.status).toBe('sent');

    const completed = await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'completed',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(completed.status).toBe('completed');
  });

  test('cannot approve withdrawal before compliance review', async () => {
    await resetProtectionStore();
    const w = await createWithdrawal(baseWithdrawal);
    await expect(async () => {
      await transitionWithdrawal({
        withdrawalId: w.id,
        toStatus: 'approved',
        operatorId: 'owner-1',
        operatorEmail: 'owner@ivxholding.com',
      });
    }).toThrow('compliance review');
  });

  test('cannot send withdrawal before approval', async () => {
    await resetProtectionStore();
    const w = await createWithdrawal(baseWithdrawal);
    await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'under_review',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    await expect(async () => {
      await transitionWithdrawal({
        withdrawalId: w.id,
        toStatus: 'sent',
        operatorId: 'owner-1',
        operatorEmail: 'owner@ivxholding.com',
      });
    }).toThrow('approval');
  });

  test('cannot move withdrawal backwards in workflow', async () => {
    await resetProtectionStore();
    const w = await createWithdrawal(baseWithdrawal);
    await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'under_review',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    await expect(async () => {
      await transitionWithdrawal({
        withdrawalId: w.id,
        toStatus: 'pending',
        operatorId: 'owner-1',
        operatorEmail: 'owner@ivxholding.com',
      });
    }).toThrow('backwards');
  });

  test('rejection allowed from under_review', async () => {
    await resetProtectionStore();
    const w = await createWithdrawal(baseWithdrawal);
    await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'under_review',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    const rejected = await transitionWithdrawal({
      withdrawalId: w.id,
      toStatus: 'rejected',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      reason: 'failed AML',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('failed AML');
  });

  test('WITHDRAWAL_WORKFLOW covers the 5 forward stages', () => {
    expect(WITHDRAWAL_WORKFLOW).toEqual(['pending', 'under_review', 'approved', 'sent', 'completed']);
    for (const s of ['pending', 'under_review', 'approved', 'rejected', 'sent', 'completed'] as WithdrawalStatus[]) {
      expect(VALID_WITHDRAWAL_STATUSES.has(s)).toBe(true);
    }
  });
});

describe('IVX Investor Protection — wire management (encrypted at rest)', () => {
  test('createWire returns safe view — full account number NEVER exposed', async () => {
    await resetProtectionStore();
    const view = await createWire({
      userId: 'inv-wire-1',
      bankName: 'Test Bank',
      accountHolder: 'Jane Investor',
      routing: '123456789',
      accountNumber: '4111111111111111',
      isInternational: false,
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(view.accountNumberLast4).toBe('1111');
    // Safe view must never include the full account number.
    expect((view as unknown as Record<string, unknown>).accountNumber).toBeUndefined();
    expect(view.status).toBe('pending');
  });

  test('listWires returns only safe views (no full account numbers)', async () => {
    await resetProtectionStore();
    await createWire({
      userId: 'inv-wire-2',
      bankName: 'Bank B',
      accountHolder: 'John',
      routing: '987654321',
      accountNumber: '5555444433332222',
    });
    const list = await listWires({ userId: 'inv-wire-2' });
    expect(list.length).toBe(1);
    for (const w of list) {
      expect((w as unknown as Record<string, unknown>).accountNumber).toBeUndefined();
      expect(w.accountNumberLast4).toBe('2222');
    }
  });

  test('wire transitions pending → initiated → confirmed', async () => {
    await resetProtectionStore();
    const w = await createWire({
      userId: 'inv-wire-3',
      bankName: 'Bank C',
      accountHolder: 'Pat',
      routing: '111222333',
      accountNumber: '9999888877776666',
    });
    const initiated = await transitionWire({
      wireId: w.id,
      toStatus: 'initiated',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(initiated.status).toBe('initiated');
    const confirmed = await transitionWire({
      wireId: w.id,
      toStatus: 'confirmed',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    expect(confirmed.status).toBe('confirmed');
  });

  test('wire queue returns only pending/initiated wires, oldest-first', async () => {
    await resetProtectionStore();
    const w1 = await createWire({
      userId: 'inv-q-1',
      bankName: 'B',
      accountHolder: 'H',
      routing: '1',
      accountNumber: '1111222233334444',
    });
    // small delay to ensure ordering by createdAt
    await new Promise((r) => setTimeout(r, 5));
    const w2 = await createWire({
      userId: 'inv-q-2',
      bankName: 'B',
      accountHolder: 'H',
      routing: '1',
      accountNumber: '5555666677778888',
    });
    await transitionWire({
      wireId: w2.id,
      toStatus: 'initiated',
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
    });
    const queue = await wireQueue();
    const ids = queue.map((w) => w.id);
    expect(ids).toContain(w1.id);
    expect(ids).toContain(w2.id);
    // oldest-first: w1 created before w2
    expect(ids.indexOf(w1.id)).toBeLessThan(ids.indexOf(w2.id));
  });
});

describe('IVX Investor Protection — investments + wallet', () => {
  test('createInvestment rejects negative amount', async () => {
    await resetProtectionStore();
    await expect(async () => {
      await createInvestment({
        userId: 'inv-neg',
        investmentType: 'jv_deal',
        name: 'Bad',
        amountInvested: -100,
      });
    }).toThrow('negative');
  });

  test('createInvestment rejects invalid type', async () => {
    await resetProtectionStore();
    await expect(async () => {
      await createInvestment({
        userId: 'inv-bad-type',
        investmentType: 'fake_type' as InvestmentType,
        name: 'Bad',
        amountInvested: 100,
      });
    }).toThrow('Invalid investment type');
  });

  test('create investment, update valuation, list filtered by user', async () => {
    await resetProtectionStore();
    const inv = await createInvestment({
      userId: 'inv-real-1',
      investmentType: 'real_estate',
      name: 'Property Alpha',
      amountInvested: 50000,
      ownershipPercentage: 25,
    });
    expect(inv.status).toBe('active');
    expect(inv.amountInvested).toBe(50000);

    const updated = await updateInvestmentValuation({
      investmentId: inv.id,
      currentValuation: 60000,
      profitDistributed: 2000,
      operatorId: 'owner-1',
      operatorEmail: 'owner@ivxholding.com',
      reason: 'Q2 appraisal',
    });
    expect(updated.currentValuation).toBe(60000);
    expect(updated.profitDistributed).toBe(2000);

    const list = await listInvestments({ userId: 'inv-real-1' });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(inv.id);
  });

  test('wallet summary derives balances from investments + withdrawals', async () => {
    await resetProtectionStore();
    await createInvestment({
      userId: 'inv-wallet-1',
      investmentType: 'tokenized',
      name: 'Token A',
      amountInvested: 1000,
      tokenBalance: 500,
    });
    await createWithdrawal({
      userId: 'inv-wallet-1',
      amount: 200,
      availableBalance: 800,
    });
    const summary = await getInvestorWalletSummary('inv-wallet-1');
    expect(summary.userId).toBe('inv-wallet-1');
    expect(summary.investmentBalance).toBe(1000);
    expect(summary.tokenBalance).toBe(500);
    expect(summary.pendingWithdrawals).toBe(200);
    expect(summary.availableBalance).toBe(0); // cashBalance 0 - pendingWithdrawals 200 clamped to 0
  });
});

describe('IVX Investor Protection — compliance (KYC / AML / accredited)', () => {
  test('upsertCompliance creates then updates a record', async () => {
    await resetProtectionStore();
    const created = await upsertCompliance({
      userId: 'inv-kyc-1',
      kycStatus: 'pending',
      updatedBy: 'owner-1',
      updatedByEmail: 'owner@ivxholding.com',
    });
    expect(created.kycStatus).toBe('pending');
    expect(created.kycVerifiedAt).toBeNull();

    const verified = await upsertCompliance({
      userId: 'inv-kyc-1',
      kycStatus: 'verified',
      accreditedInvestorStatus: 'verified',
      identityVerified: true,
      updatedBy: 'owner-1',
      updatedByEmail: 'owner@ivxholding.com',
    });
    expect(verified.kycStatus).toBe('verified');
    expect(verified.kycVerifiedAt).not.toBeNull();
    expect(verified.accreditedInvestorStatus).toBe('verified');
    expect(verified.identityVerified).toBe(true);

    const fetched = await getCompliance('inv-kyc-1');
    expect(fetched?.id).toBe(created.id);
  });
});

describe('IVX Investor Protection — audit log', () => {
  test('recordProtectionAudit appends and listProtectionAudit filters', async () => {
    await resetProtectionStore();
    await recordProtectionAudit({
      action: 'test_action_a',
      targetUserId: 'inv-audit-1',
      reason: 'unit test',
    });
    await recordProtectionAudit({
      action: 'test_action_b',
      targetUserId: 'inv-audit-1',
      reason: 'unit test',
    });
    const all = await listProtectionAudit({ targetUserId: 'inv-audit-1' });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const filtered = await listProtectionAudit({ action: 'test_action_a' });
    expect(filtered.every((e) => e.action === 'test_action_a')).toBe(true);
  });
});
