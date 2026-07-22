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
  createInvestorAccount,
  getAccountSummary,
  recordTransaction,
  listLedger,
  amendTransaction,
  verifyLedgerIntegrity,
  listApprovals,
  decideApproval,
  addBankItem,
  runReconciliation,
  computeIRRPercent,
  LARGE_PAYMENT_THRESHOLD_USD,
} from './ivx-treasury-system';
import {
  generateStatement,
  statementToCSV,
  statementToPDF,
  upsertPropertyCapital,
  getPropertyCapitalReport,
  calculateDistribution,
  recordCommission,
  generate1099Report,
  updateCommissionStatus,
  upsertInfluencer,
  trackInfluencerActivity,
  payInfluencer,
  getFinancialDashboard,
  getAIFinanceMonitor,
} from './ivx-treasury-finance';

const ROOT = path.join(process.cwd(), 'logs', 'audit', 'treasury');

async function clean(): Promise<void> {
  await rm(ROOT, { recursive: true, force: true });
}

beforeEach(clean);
afterEach(clean);

describe('investor accounts', () => {
  it('creates accounts of every type and computes a live summary', async () => {
    const account = await createInvestorAccount({ userId: 'user_1', displayName: 'Test LP', accountType: 'family_office' });
    expect(account.accountId.startsWith('acct_')).toBe(true);

    await recordTransaction({ userId: 'user_1', accountId: account.accountId, type: 'deposit', amount: 100_000 });
    await recordTransaction({ userId: 'user_1', accountId: account.accountId, type: 'investment', amount: 60_000, propertyId: 'prop_1' });
    await recordTransaction({ userId: 'user_1', accountId: account.accountId, type: 'distribution', amount: 5_000, propertyId: 'prop_1' });
    await recordTransaction({ userId: 'user_1', accountId: account.accountId, type: 'fee', amount: 500 });

    const summary = await getAccountSummary(account.accountId);
    expect(summary).not.toBeNull();
    expect(summary?.totalInvested).toBe(60_000);
    expect(summary?.availableCash).toBe(44_500);
    expect(summary?.realizedGainLoss).toBe(4_500);
    expect(summary?.portfolioValue).toBe(60_000);
    expect(summary?.netWorthInsideIVX).toBe(104_500);
    expect(summary?.roiPercent).toBe(7.5);
  });
});

describe('money ledger — immutable hash chain', () => {
  it('chains hashes and verifies integrity', async () => {
    const account = await createInvestorAccount({ userId: 'user_2', displayName: 'Chain', accountType: 'individual' });
    const first = await recordTransaction({ userId: 'user_2', accountId: account.accountId, type: 'deposit', amount: 1_000 });
    const second = await recordTransaction({ userId: 'user_2', accountId: account.accountId, type: 'deposit', amount: 2_000 });
    expect(first.entry.previousHash).toBe('genesis');
    expect(second.entry.previousHash).toBe(first.entry.hash);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalEntries).toBe(2);
  });

  it('tracks amendments with who/when/previous/new/reason and requires a reason', async () => {
    const account = await createInvestorAccount({ userId: 'user_3', displayName: 'Amend', accountType: 'entity' });
    const { entry } = await recordTransaction({ userId: 'user_3', accountId: account.accountId, type: 'deposit', amount: 500, memo: 'original' });

    await expect(
      amendTransaction({ transactionId: entry.transactionId, field: 'memo', newValue: 'x', editedBy: 'owner', reason: '' }),
    ).rejects.toThrow('reason');

    const amended = await amendTransaction({
      transactionId: entry.transactionId,
      field: 'memo',
      newValue: 'corrected memo',
      editedBy: 'owner',
      reason: 'typo fix',
    });
    expect(amended.edits.length).toBe(1);
    expect(amended.edits[0].previousValue).toBe('original');
    expect(amended.edits[0].newValue).toBe('corrected memo');
    expect(amended.edits[0].reason).toBe('typo fix');

    // Amending memo/status never breaks the hash chain (core fields untouched).
    const integrity = await verifyLedgerIntegrity();
    expect(integrity.valid).toBe(true);
  });
});

describe('approval workflow — CEO → Finance → Owner', () => {
  it('routes large withdrawals through the ordered chain', async () => {
    const account = await createInvestorAccount({ userId: 'user_4', displayName: 'Big', accountType: 'fund' });
    const { entry, approval } = await recordTransaction({
      userId: 'user_4',
      accountId: account.accountId,
      type: 'withdrawal',
      amount: LARGE_PAYMENT_THRESHOLD_USD,
    });
    expect(entry.status).toBe('pending_approval');
    expect(approval).not.toBeNull();
    const approvalId = approval?.approvalId as string;

    // Out-of-order decision must fail (finance before CEO).
    await expect(
      decideApproval({ approvalId, role: 'finance', decision: 'approved', decidedBy: 'cfo' }),
    ).rejects.toThrow('order');

    await decideApproval({ approvalId, role: 'ceo', decision: 'approved', decidedBy: 'ceo@ivx' });
    await decideApproval({ approvalId, role: 'finance', decision: 'approved', decidedBy: 'cfo@ivx' });
    const done = await decideApproval({ approvalId, role: 'owner', decision: 'approved', decidedBy: 'owner@ivx' });
    expect(done.status).toBe('approved');
    expect(done.auditLog.length).toBeGreaterThanOrEqual(4);

    const [updated] = await listLedger({ accountId: account.accountId, type: 'withdrawal' });
    expect(updated.status).toBe('completed');
    const pending = await listApprovals('pending');
    expect(pending.length).toBe(0);
  });

  it('small payments complete without approval', async () => {
    const account = await createInvestorAccount({ userId: 'user_5', displayName: 'Small', accountType: 'individual' });
    const { entry, approval } = await recordTransaction({ userId: 'user_5', accountId: account.accountId, type: 'withdrawal', amount: 100 });
    expect(entry.status).toBe('completed');
    expect(approval).toBeNull();
  });
});

describe('statements', () => {
  it('generates monthly statements with balances, tax summary, CSV and PDF exports', async () => {
    const account = await createInvestorAccount({ userId: 'user_6', displayName: 'Stmt', accountType: 'individual' });
    await recordTransaction({ userId: 'user_6', accountId: account.accountId, type: 'deposit', amount: 10_000 });
    await recordTransaction({ userId: 'user_6', accountId: account.accountId, type: 'investment', amount: 4_000 });
    await recordTransaction({ userId: 'user_6', accountId: account.accountId, type: 'distribution', amount: 300 });
    await recordTransaction({ userId: 'user_6', accountId: account.accountId, type: 'fee', amount: 50 });

    const statement = await generateStatement(account.accountId, 'monthly');
    expect(statement.deposits).toBe(10_000);
    expect(statement.investments).toBe(4_000);
    expect(statement.distributions).toBe(300);
    expect(statement.fees).toBe(50);
    expect(statement.endingBalance).toBe(6_250);
    expect(statement.taxSummary.totalTaxable).toBe(300);

    const csv = statementToCSV(statement);
    expect(csv).toContain('IVX INVESTOR STATEMENT');
    expect(csv).toContain('Ending Balance,6250');

    const pdf = statementToPDF(statement);
    const header = new TextDecoder().decode(pdf.slice(0, 8));
    expect(header.startsWith('%PDF-1.4')).toBe(true);
  });
});

describe('property capital + distributions', () => {
  it('tracks capital raised, ownership % and calculates a valid split', async () => {
    const a1 = await createInvestorAccount({ userId: 'inv_a', displayName: 'A', accountType: 'individual' });
    const a2 = await createInvestorAccount({ userId: 'inv_b', displayName: 'B', accountType: 'entity' });
    await upsertPropertyCapital({ propertyId: 'prop_x', propertyName: 'Tower X', capitalTarget: 1_000_000 });
    await recordTransaction({ userId: 'inv_a', accountId: a1.accountId, type: 'investment', amount: 300_000, propertyId: 'prop_x' });
    await recordTransaction({ userId: 'inv_b', accountId: a2.accountId, type: 'investment', amount: 100_000, propertyId: 'prop_x' });

    const report = await getPropertyCapitalReport('prop_x');
    expect(report?.capitalRaised).toBe(400_000);
    expect(report?.capitalRemaining).toBe(600_000);
    expect(report?.investors.find((i) => i.userId === 'inv_a')?.ownershipPercent).toBe(75);

    const plan = await calculateDistribution({ propertyId: 'prop_x', totalAmount: 100_000, installments: 2 });
    const total = plan.allocations.reduce((s, a) => s + a.amount, 0);
    expect(Math.abs(total - 100_000)).toBeLessThan(1);
    expect(plan.approvalRequired).toBe(true);
    expect(plan.paymentSchedule.length).toBe(2);
    const investorPool = plan.allocations.find((a) => a.party === 'investorPercent')?.amount ?? 0;
    const payoutA = plan.investorPayouts.find((p) => p.userId === 'inv_a');
    expect(payoutA?.amount).toBe(Math.round(investorPool * 0.75 * 100) / 100);
  });

  it('rejects splits that do not total 100%', async () => {
    await expect(
      calculateDistribution({ propertyId: 'prop_y', totalAmount: 10_000, split: { investorPercent: 90 } }),
    ).rejects.toThrow('100%');
  });
});

describe('commissions + influencers', () => {
  it('splits realtor commissions and produces 1099 totals for paid records', async () => {
    const record = await recordCommission({ propertyId: 'prop_z', salePrice: 500_000, brokerId: 'broker_1', agentId: 'agent_1', referralId: 'ref_1' });
    expect(record.totalCommission).toBe(30_000);
    expect(record.brokerAmount).toBe(15_000);
    expect(record.agentAmount).toBe(13_500);
    expect(record.referralAmount).toBe(1_500);

    await updateCommissionStatus(record.commissionId, 'paid');
    const report = await generate1099Report(new Date().getUTCFullYear());
    expect(report.payees.find((p) => p.payeeId === 'broker_1')?.totalPaid).toBe(15_000);
  });

  it('tracks influencer revenue, commission due and lifetime earnings', async () => {
    const influencer = await upsertInfluencer({ name: 'Creator One', referralLink: 'https://ivx.app/r/creator1', commissionPercent: 5 });
    await trackInfluencerActivity({ influencerId: influencer.influencerId, qualifiedLeads: 10, closedDeals: 2, revenueGenerated: 40_000 });
    const paid = await payInfluencer(influencer.influencerId);
    expect(paid.lifetimeEarnings).toBe(2_000);
    expect(paid.commissionDue).toBe(0);
    expect(paid.paymentStatus).toBe('paid');
  });
});

describe('bank reconciliation', () => {
  it('matches bank items to platform transactions and flags unmatched', async () => {
    const account = await createInvestorAccount({ userId: 'user_7', displayName: 'Recon', accountType: 'individual' });
    await recordTransaction({ userId: 'user_7', accountId: account.accountId, type: 'deposit', amount: 25_000 });
    await addBankItem({ kind: 'incoming_wire', amount: 25_000, reference: 'WIRE-001' });
    await addBankItem({ kind: 'ach', amount: 999, reference: 'ACH-ORPHAN' });

    const result = await runReconciliation();
    expect(result.matched).toBe(1);
    expect(result.unmatchedBankItems.length).toBe(1);
    expect(result.unmatchedBankItems[0].reference).toBe('ACH-ORPHAN');
  });
});

describe('dashboard + AI finance', () => {
  it('aggregates the live financial dashboard and executive summary', async () => {
    const account = await createInvestorAccount({ userId: 'user_8', displayName: 'Dash', accountType: 'institutional' });
    await recordTransaction({ userId: 'user_8', accountId: account.accountId, type: 'deposit', amount: 50_000 });
    await recordTransaction({ userId: 'user_8', accountId: account.accountId, type: 'investment', amount: 20_000, propertyId: 'prop_d' });

    const dashboard = await getFinancialDashboard();
    expect(dashboard.capitalRaised).toBe(50_000);
    expect(dashboard.capitalDeployed).toBe(20_000);
    expect(dashboard.cashOnHand).toBe(30_000);
    expect(dashboard.ledgerIntegrity.valid).toBe(true);

    const monitor = await getAIFinanceMonitor();
    expect(monitor.cashFlow.last30dInflow).toBe(50_000);
    expect(monitor.executiveSummary.length).toBeGreaterThan(20);
  });
});

describe('IRR', () => {
  it('computes an annualized IRR for a simple invest-return series', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2026-01-01T00:00:00Z');
    const irr = computeIRRPercent([
      { amount: -100_000, date: start },
      { amount: 110_000, date: end },
    ]);
    expect(irr).not.toBeNull();
    expect(Math.abs((irr ?? 0) - 10)).toBeLessThan(0.6);
  });

  it('returns null when no sign change exists', () => {
    expect(computeIRRPercent([{ amount: 100, date: new Date() }, { amount: 200, date: new Date() }])).toBeNull();
  });
});
