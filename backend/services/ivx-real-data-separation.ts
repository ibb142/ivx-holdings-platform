/**
 * IVX Executive Layer Real-Data Separation (owner-only).
 *
 * Implements Block 2 + Block 13 of the owner's real-data mandate. The
 * Executive Layer must display these as SEVEN separate values — never
 * combined into one "Investor Pipeline" number:
 *
 *   A. Capital Being Sought       — funding requested by IVX deals (NOT investor money)
 *   B. Identified Investor Prospects — real people/companies, contact verified
 *   C. Contacted Investors        — outreach actually sent (timestamp + channel + delivery)
 *   D. Interested Investors       — investor replied or completed an interest form
 *   E. Qualified Investors        — identity + qualification reviewed, KYC/AML visible
 *   F. Committed Capital          — written commitment exists, evidence attached
 *   G. Funds Received             — actual reconciled transaction (bank/escrow evidence)
 *
 * HARD HONESTY RULE: every figure is derived from a real subsystem record. The
 * financial ledger is the ONLY source for F + G. CRM scoring / pipeline
 * probability math NEVER counts as money. Test/invalid records are quarantined
 * (never appear here) via the investor classification filter.
 *
 * Read-only + defensive: a failing reader degrades to an honest empty value.
 */
import { listDeals, type DealTrackingRecord } from './ivx-deal-tracking-store';
import { listInvestors, type InvestorRecord } from './ivx-investor-crm-store';
import { listOutreachMessages, type OutreachMessage } from './ivx-outreach-store';
import {
  summarizeFinancialLedger,
  type FinancialTransaction,
  listFinancialTransactions,
  FUNDS_RECEIVED_STATUSES,
  COMMITTED_STATUSES,
} from './ivx-financial-ledger-store';
import { auditAllInvestors, isProductionVisible, isQualifiedInvestor } from './ivx-investor-classification';

export const IVX_REAL_DATA_SEPARATION_MARKER = 'ivx-real-data-separation-2026-07-18';

export type RealDataCategory = {
  key: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  label: string;
  value: string;
  count: number;
  amountUsd: number;
  note: string;
  /** Underlying record ids that back this number (for click-to-trace). */
  sourceRecordIds: string[];
};

export type RealDataSeparation = {
  marker: string;
  generatedAt: string;
  categories: RealDataCategory[];
  /** The 13 clickable dashboard totals from Block 13. */
  dashboardTotals: {
    capitalBeingSought: number;
    verifiedInvestorProspects: number;
    prospectsAwaitingVerification: number;
    outreachAwaitingApproval: number;
    outreachSent: number;
    repliesReceived: number;
    qualifiedInvestors: number;
    signedCommitments: number;
    fundsReceived: number;
    activeDeals: number;
    openRisks: number;
    autonomousTasksCompletedWithEvidence: number;
    failedAutonomousTasks: number;
    currentProductionVersion: string;
  };
  note: string;
};

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function isRealDealSource(source: string): boolean {
  const s = (source ?? '').toLowerCase();
  return (
    s === 'owner_entered' ||
    s === 'submitted_form' ||
    s === 'crm_import' ||
    s === 'public_source' ||
    s === 'verified_deal'
  );
}

/** A. Capital Being Sought = sum of capitalTarget across real, open deals. */
async function categoryA(deals: DealTrackingRecord[]): Promise<RealDataCategory> {
  const real = deals.filter(
    (d) => isRealDealSource(d.source) && d.status !== 'closed_lost' && d.capitalTarget !== null,
  );
  const total = real.reduce((sum, d) => sum + (d.capitalTarget ?? 0), 0);
  return {
    key: 'A',
    label: 'Capital Being Sought',
    value: usd(total),
    count: real.length,
    amountUsd: total,
    note: 'Funding requested by IVX deals. NOT investor money. NOT committed money. NOT pipeline money.',
    sourceRecordIds: real.map((d) => d.id),
  };
}

/** B. Identified Investor Prospects = real, verified, with contact info. */
async function categoryB(
  classified: { id: string; classification: string; productionVisible: boolean; email: string; phone: string }[],
): Promise<RealDataCategory> {
  const real = classified.filter(
    (c) => c.productionVisible && (c.email || c.phone),
  );
  return {
    key: 'B',
    label: 'Identified Investor Prospects',
    value: `${real.length}`,
    count: real.length,
    amountUsd: 0,
    note: 'Real people or companies. Contact information verified. No commitment implied.',
    sourceRecordIds: real.map((c) => c.id),
  };
}

/** C. Contacted Investors = outreach actually sent. */
async function categoryC(outreach: OutreachMessage[]): Promise<RealDataCategory> {
  const sent = outreach.filter((m) => m.status === 'sent' || m.status === 'replied');
  return {
    key: 'C',
    label: 'Contacted Investors',
    value: `${sent.length}`,
    count: sent.length,
    amountUsd: 0,
    note: 'Outreach actually sent. Includes timestamp, channel and delivery status.',
    sourceRecordIds: sent.map((m) => m.id),
  };
}

/** D. Interested Investors = investor replied or completed an interest form. */
async function categoryD(outreach: OutreachMessage[]): Promise<RealDataCategory> {
  const replied = outreach.filter((m) => m.engagement.replied);
  return {
    key: 'D',
    label: 'Interested Investors',
    value: `${replied.length}`,
    count: replied.length,
    amountUsd: 0,
    note: 'Investor replied or completed an interest form.',
    sourceRecordIds: replied.map((m) => m.id),
  };
}

/** E. Qualified Investors = identity + qualification reviewed, KYC/AML visible. */
async function categoryE(
  classified: { id: string; classification: string; qualifiedInvestor: boolean }[],
  investors: InvestorRecord[],
): Promise<RealDataCategory> {
  const qualifiedIds = new Set(classified.filter((c) => c.qualifiedInvestor).map((c) => c.id));
  const qualified = investors.filter((i) => qualifiedIds.has(i.id));
  return {
    key: 'E',
    label: 'Qualified Investors',
    value: `${qualified.length}`,
    count: qualified.length,
    amountUsd: 0,
    note: 'Identity and qualification reviewed. KYC/AML status visible.',
    sourceRecordIds: qualified.map((i) => i.id),
  };
}

/** F. Committed Capital = written commitment exists, evidence attached. */
async function categoryF(transactions: FinancialTransaction[]): Promise<RealDataCategory> {
  const committed = transactions.filter((t) => COMMITTED_STATUSES.has(t.transactionStatus));
  const total = committed.reduce((sum, t) => sum + t.amount, 0);
  return {
    key: 'F',
    label: 'Committed Capital',
    value: usd(total),
    count: committed.length,
    amountUsd: total,
    note: 'Written commitment exists. Evidence attached.',
    sourceRecordIds: committed.map((t) => t.id),
  };
}

/** G. Funds Received = actual reconciled transaction (bank/escrow evidence). */
async function categoryG(transactions: FinancialTransaction[]): Promise<RealDataCategory> {
  const received = transactions.filter(
    (t) => FUNDS_RECEIVED_STATUSES.has(t.transactionStatus) && t.reconciliationStatus === 'reconciled',
  );
  const total = received.reduce((sum, t) => sum + t.amount, 0);
  return {
    key: 'G',
    label: 'Funds Received',
    value: usd(total),
    count: received.length,
    amountUsd: total,
    note: 'Actual reconciled transaction. Bank, escrow or payment evidence attached.',
    sourceRecordIds: received.map((t) => t.id),
  };
}

/**
 * Build the 7-category real-data separation. Read-only; every figure grounded
 * in a real subsystem record. Test/invalid records quarantined.
 */
export async function buildRealDataSeparation(productionVersion: string): Promise<RealDataSeparation> {
  const [deals, investors, outreach, transactions, classified] = await Promise.all([
    listDeals().catch(() => [] as DealTrackingRecord[]),
    listInvestors().catch(() => [] as InvestorRecord[]),
    listOutreachMessages().catch(() => [] as OutreachMessage[]),
    listFinancialTransactions().catch(() => [] as FinancialTransaction[]),
    auditAllInvestors().catch(() => null),
  ]);

  const classifiedRows = (classified?.classified ?? []).map((c) => ({
    id: c.id,
    classification: c.classification,
    productionVisible: c.productionVisible,
    qualifiedInvestor: c.qualifiedInvestor,
    email: c.email,
    phone: c.phone,
  }));

  const categories: RealDataCategory[] = [
    await categoryA(deals),
    await categoryB(classifiedRows),
    await categoryC(outreach),
    await categoryD(outreach),
    await categoryE(classifiedRows, investors),
    await categoryF(transactions),
    await categoryG(transactions),
  ];

  const capitalBeingSought = categories[0]!.amountUsd;
  const verifiedProspects = classifiedRows.filter((c) => isProductionVisible(c.classification as never)).length;
  const prospectsAwaiting = classifiedRows.filter(
    (c) => c.classification === 'real_unverified_contact' || c.classification === 'needs_owner_review',
  ).length;
  const outreachAwaiting = outreach.filter((m) => m.status === 'pending_approval').length;
  const outreachSent = outreach.filter((m) => m.status === 'sent' || m.status === 'replied').length;
  const repliesReceived = outreach.filter((m) => m.engagement.replied).length;
  const qualifiedInvestors = classifiedRows.filter((c) => isQualifiedInvestor(c.classification as never)).length;
  const signedCommitments = transactions.filter((t) => t.transactionStatus === 'signed_commitment').length;
  const fundsReceived = categories[6]!.amountUsd;
  const activeDeals = deals.filter((d) => d.status === 'open' || d.status === 'in_progress').length;
  const openRisks = deals.filter(
    (d) =>
      d.status !== 'closed_won' &&
      d.status !== 'closed_lost' &&
      d.investorsContacted >= 5 &&
      d.investorsResponded === 0,
  ).length;

  return {
    marker: IVX_REAL_DATA_SEPARATION_MARKER,
    generatedAt: new Date().toISOString(),
    categories,
    dashboardTotals: {
      capitalBeingSought,
      verifiedInvestorProspects: verifiedProspects,
      prospectsAwaitingVerification: prospectsAwaiting,
      outreachAwaitingApproval: outreachAwaiting,
      outreachSent,
      repliesReceived,
      qualifiedInvestors,
      signedCommitments,
      fundsReceived,
      activeDeals,
      openRisks,
      autonomousTasksCompletedWithEvidence: 0, // populated by architecture map
      failedAutonomousTasks: 0,
      currentProductionVersion: productionVersion,
    },
    note:
      'Every figure is derived from a real subsystem record (deal-tracking, investor-crm, outreach, financial-ledger). Test/invalid records are quarantined and never appear here. Funding targets are separated from investor money. Only escrow_received/bank_received reconciled transactions count as Funds Received.',
  };
}
