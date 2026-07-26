/**
 * IVX Enterprise Capital & Treasury — finance layer.
 *
 * 3. INVESTOR STATEMENTS — daily / weekly / monthly / quarterly / yearly with
 *    opening balance, deposits, withdrawals, investments, distributions, fees,
 *    ending balance, ROI, IRR, tax summary. Export: PDF / Excel / CSV.
 * 4. PROPERTY CAPITAL — per-property capital raised/remaining, investor list
 *    with ownership %, preferred return, waterfall, cash flow, expenses, net
 *    profit, distribution history.
 * 5. AUTOMATIC DISTRIBUTIONS — split calculator (investor/JV/developer/broker/
 *    realtor/referral/influencer/platform/management/construction/reserve),
 *    payment schedules and approval workflows.
 * 6. REALTOR COMMISSIONS — automatic commission engine with broker/agent/
 *    referral splits, payment status and 1099 reports.
 * 7. INFLUENCER PAYMENTS — referral link, campaign, lead source, qualified
 *    leads, closed deals, revenue, commission %, payment status, lifetime earnings.
 * 8. FINANCIAL DASHBOARD — live cash on hand, capital raised/deployed, P&L,
 *    outstanding payments, pending distributions, balances, commissions.
 * 12. REPORTS — statements, profit, cash flow, balance sheet, income
 *    statement, commissions, tax, executive dashboard.
 * 13. AI FINANCE — cash-flow monitoring, upcoming distributions, overdue
 *    payments, profit anomalies, fraud detection, capital forecasts and
 *    automatic executive summaries.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
import { computeIRRPercent, getInvestorAccount, listInvestorAccounts, getAccountSummary, listLedger, listApprovals, recordTransaction, IVX_TREASURY_MARKER, } from './ivx-treasury-system';
const STORE_DIR = () => path.join(auditDir(), 'treasury');
const PROPERTIES_FILE = () => path.join(STORE_DIR(), 'property-capital.json');
const DISTRIBUTIONS_FILE = () => path.join(STORE_DIR(), 'distributions.json');
const COMMISSIONS_FILE = () => path.join(STORE_DIR(), 'commissions.json');
const INFLUENCERS_FILE = () => path.join(STORE_DIR(), 'influencers.json');
const FINANCE_EVENTS_FILE = () => path.join(STORE_DIR(), 'finance-events.jsonl');
// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
async function readStore(file, fallback) {
    if (isDurableStoreConfigured())
        return readDurableJson(file, fallback);
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeStore(file, value) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(file, value);
        return;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendFinanceEvent(event) {
    const enriched = { ...event, at: nowIso(), marker: IVX_TREASURY_MARKER };
    if (isDurableStoreConfigured()) {
        await appendDurableEvent(FINANCE_EVENTS_FILE(), enriched);
        return;
    }
    await mkdir(STORE_DIR(), { recursive: true });
    await appendFile(FINANCE_EVENTS_FILE(), `${JSON.stringify(enriched)}\n`, 'utf8');
}
function nowIso() {
    return new Date().toISOString();
}
function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function round2(value) {
    return Math.round(value * 100) / 100;
}
export const VALID_STATEMENT_PERIODS = new Set([
    'daily', 'weekly', 'monthly', 'quarterly', 'yearly',
]);
function periodStartDate(period, end) {
    const start = new Date(end);
    switch (period) {
        case 'daily':
            start.setUTCDate(start.getUTCDate() - 1);
            break;
        case 'weekly':
            start.setUTCDate(start.getUTCDate() - 7);
            break;
        case 'monthly':
            start.setUTCMonth(start.getUTCMonth() - 1);
            break;
        case 'quarterly':
            start.setUTCMonth(start.getUTCMonth() - 3);
            break;
        case 'yearly':
            start.setUTCFullYear(start.getUTCFullYear() - 1);
            break;
    }
    return start;
}
function signedCashEffect(entry) {
    if (entry.status !== 'completed')
        return 0;
    switch (entry.type) {
        case 'deposit':
        case 'distribution':
        case 'dividend':
        case 'interest':
        case 'profit':
        case 'commission':
        case 'refund':
            return entry.amount;
        case 'withdrawal':
        case 'investment':
        case 'loss':
        case 'fee':
            return -entry.amount;
        case 'transfer':
        case 'adjustment':
            return entry.amount;
        default:
            return 0;
    }
}
/** Generates a statement for one account across the requested period. */
export async function generateStatement(accountId, period) {
    const account = await getInvestorAccount(accountId);
    if (!account)
        throw new Error(`Account not found: ${accountId}`);
    const allEntries = (await listLedger({ accountId, limit: 1000 })).slice().reverse(); // chronological
    const end = new Date();
    const start = periodStartDate(period, end);
    let openingBalance = 0;
    const inPeriod = [];
    for (const entry of allEntries) {
        const at = new Date(entry.timestamp);
        if (at < start)
            openingBalance += signedCashEffect(entry);
        else if (at <= end)
            inPeriod.push(entry);
    }
    const sumType = (types) => round2(inPeriod.filter((e) => types.includes(e.type) && e.status === 'completed').reduce((s, e) => s + e.amount, 0));
    const deposits = sumType(['deposit']);
    const withdrawals = sumType(['withdrawal']);
    const investments = sumType(['investment']);
    const distributions = sumType(['distribution']);
    const fees = sumType(['fee']);
    const endingBalance = round2(openingBalance + inPeriod.reduce((s, e) => s + signedCashEffect(e), 0));
    const summary = await getAccountSummary(accountId);
    const taxableDistributions = distributions;
    const taxableInterest = sumType(['interest']);
    const taxableDividends = sumType(['dividend']);
    const realizedGains = sumType(['profit']);
    const cashflows = inPeriod
        .filter((e) => e.status === 'completed' && (e.type === 'investment' || e.type === 'distribution' || e.type === 'dividend'))
        .map((e) => ({ amount: e.type === 'investment' ? -e.amount : e.amount, date: new Date(e.timestamp) }));
    const statement = {
        statementId: makeId('stmt'),
        accountId,
        userId: account.userId,
        period,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        openingBalance: round2(openingBalance),
        deposits,
        withdrawals,
        investments,
        distributions,
        fees,
        endingBalance,
        roiPercent: summary?.roiPercent ?? null,
        irrPercent: summary?.irrPercent ?? computeIRRPercent(cashflows),
        taxSummary: {
            taxableDistributions,
            taxableInterest,
            taxableDividends,
            realizedGains,
            totalTaxable: round2(taxableDistributions + taxableInterest + taxableDividends + realizedGains),
        },
        lineItems: inPeriod.map((e) => ({
            transactionId: e.transactionId,
            date: e.date,
            type: e.type,
            amount: e.amount,
            status: e.status,
            memo: e.memo,
        })),
        generatedAt: nowIso(),
    };
    await appendFinanceEvent({ action: 'statement_generated', statementId: statement.statementId, accountId, period });
    return statement;
}
/** CSV export (also served as the Excel-compatible format). */
export function statementToCSV(statement) {
    const lines = [];
    lines.push('IVX INVESTOR STATEMENT');
    lines.push(`Statement ID,${statement.statementId}`);
    lines.push(`Account,${statement.accountId}`);
    lines.push(`Period,${statement.period},${statement.periodStart},${statement.periodEnd}`);
    lines.push('');
    lines.push('Summary,Amount');
    lines.push(`Opening Balance,${statement.openingBalance}`);
    lines.push(`Deposits,${statement.deposits}`);
    lines.push(`Withdrawals,${statement.withdrawals}`);
    lines.push(`Investments,${statement.investments}`);
    lines.push(`Distributions,${statement.distributions}`);
    lines.push(`Fees,${statement.fees}`);
    lines.push(`Ending Balance,${statement.endingBalance}`);
    lines.push(`ROI %,${statement.roiPercent ?? 'n/a'}`);
    lines.push(`IRR %,${statement.irrPercent ?? 'n/a'}`);
    lines.push(`Total Taxable,${statement.taxSummary.totalTaxable}`);
    lines.push('');
    lines.push('Transaction ID,Date,Type,Amount,Status,Memo');
    for (const item of statement.lineItems) {
        lines.push(`${item.transactionId},${item.date},${item.type},${item.amount},${item.status},"${item.memo.replace(/"/g, "'")}"`);
    }
    return lines.join('\n');
}
function escapePdfText(value) {
    return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
/** Minimal valid single-page PDF (Helvetica text) — no external dependencies. */
export function statementToPDF(statement) {
    const rows = [
        'IVX INVESTOR STATEMENT',
        `Statement: ${statement.statementId}`,
        `Account: ${statement.accountId}  Period: ${statement.period}`,
        `From ${statement.periodStart.slice(0, 10)} to ${statement.periodEnd.slice(0, 10)}`,
        '',
        `Opening Balance: ${statement.openingBalance}`,
        `Deposits: ${statement.deposits}`,
        `Withdrawals: ${statement.withdrawals}`,
        `Investments: ${statement.investments}`,
        `Distributions: ${statement.distributions}`,
        `Fees: ${statement.fees}`,
        `Ending Balance: ${statement.endingBalance}`,
        `ROI: ${statement.roiPercent ?? 'n/a'} %  IRR: ${statement.irrPercent ?? 'n/a'} %`,
        `Total Taxable: ${statement.taxSummary.totalTaxable}`,
        '',
        'Transactions:',
        ...statement.lineItems.slice(0, 30).map((i) => `${i.date}  ${i.type.padEnd(12)}  ${String(i.amount).padStart(12)}  ${i.status}`),
    ];
    let text = 'BT /F1 10 Tf 40 780 Td 14 TL\n';
    for (const row of rows) {
        text += `(${escapePdfText(row)}) Tj T*\n`;
    }
    text += 'ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let body = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((obj, index) => {
        offsets.push(body.length);
        body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return new TextEncoder().encode(body);
}
const DEFAULT_WATERFALL = [
    { tier: 1, label: 'Preferred return', thresholdPercent: 8, investorShare: 100, sponsorShare: 0 },
    { tier: 2, label: 'Catch-up', thresholdPercent: 12, investorShare: 70, sponsorShare: 30 },
    { tier: 3, label: 'Carried interest', thresholdPercent: 100, investorShare: 60, sponsorShare: 40 },
];
export async function upsertPropertyCapital(input) {
    const configs = await readStore(PROPERTIES_FILE(), []);
    const now = nowIso();
    let config = configs.find((c) => c.propertyId === input.propertyId);
    if (!config) {
        config = {
            propertyId: input.propertyId,
            propertyName: input.propertyName ?? input.propertyId,
            capitalTarget: input.capitalTarget ?? 0,
            preferredReturnPercent: input.preferredReturnPercent ?? 8,
            waterfall: input.waterfall ?? DEFAULT_WATERFALL,
            createdAt: now,
            updatedAt: now,
        };
        configs.push(config);
    }
    else {
        if (input.propertyName)
            config.propertyName = input.propertyName;
        if (typeof input.capitalTarget === 'number')
            config.capitalTarget = input.capitalTarget;
        if (typeof input.preferredReturnPercent === 'number')
            config.preferredReturnPercent = input.preferredReturnPercent;
        if (input.waterfall)
            config.waterfall = input.waterfall;
        config.updatedAt = now;
    }
    await writeStore(PROPERTIES_FILE(), configs);
    await appendFinanceEvent({ action: 'property_capital_upserted', propertyId: input.propertyId });
    return config;
}
export async function listPropertyCapitalConfigs() {
    return readStore(PROPERTIES_FILE(), []);
}
/** Full per-property capital report derived from the immutable ledger. */
export async function getPropertyCapitalReport(propertyId) {
    const configs = await readStore(PROPERTIES_FILE(), []);
    const config = configs.find((c) => c.propertyId === propertyId);
    if (!config)
        return null;
    const entries = await listLedger({ propertyId, limit: 1000 });
    const completed = entries.filter((e) => e.status === 'completed');
    const investments = completed.filter((e) => e.type === 'investment');
    const capitalRaised = round2(investments.reduce((s, e) => s + e.amount, 0));
    const byInvestor = new Map();
    for (const entry of investments) {
        const key = `${entry.userId}|${entry.accountId}`;
        const existing = byInvestor.get(key) ?? { userId: entry.userId, accountId: entry.accountId, invested: 0 };
        existing.invested += entry.amount;
        byInvestor.set(key, existing);
    }
    const income = round2(completed.filter((e) => ['distribution', 'dividend', 'interest', 'profit'].includes(e.type)).reduce((s, e) => s + e.amount, 0));
    const expenses = round2(completed.filter((e) => ['fee', 'loss'].includes(e.type)).reduce((s, e) => s + e.amount, 0));
    return {
        propertyId: config.propertyId,
        propertyName: config.propertyName,
        capitalTarget: config.capitalTarget,
        capitalRaised,
        capitalRemaining: round2(Math.max(0, config.capitalTarget - capitalRaised)),
        preferredReturnPercent: config.preferredReturnPercent,
        waterfall: config.waterfall,
        investors: Array.from(byInvestor.values()).map((inv) => ({
            ...inv,
            invested: round2(inv.invested),
            ownershipPercent: capitalRaised > 0 ? round2((inv.invested / capitalRaised) * 100) : 0,
        })),
        cashFlow: income,
        expenses,
        netProfit: round2(income - expenses),
        distributionHistory: completed
            .filter((e) => e.type === 'distribution')
            .map((e) => ({ transactionId: e.transactionId, date: e.date, amount: e.amount, userId: e.userId, status: e.status })),
        generatedAt: nowIso(),
    };
}
export const DEFAULT_DISTRIBUTION_SPLIT = {
    investorPercent: 62,
    jvPercent: 8,
    developerPercent: 8,
    brokerPercent: 3,
    realtorPercent: 3,
    referralPercent: 2,
    influencerPercent: 2,
    platformPercent: 5,
    managementPercent: 3,
    constructionPercent: 2,
    reservePercent: 2,
};
export async function calculateDistribution(input) {
    if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) {
        throw new Error('Distribution totalAmount must be a positive number.');
    }
    const split = { ...DEFAULT_DISTRIBUTION_SPLIT, ...(input.split ?? {}) };
    const totalPercent = Object.values(split).reduce((s, v) => s + v, 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
        throw new Error(`Distribution split must total 100% (got ${round2(totalPercent)}%).`);
    }
    const allocations = Object.keys(split).map((party) => ({
        party,
        percent: split[party],
        amount: round2((input.totalAmount * split[party]) / 100),
    }));
    const propertyReport = await getPropertyCapitalReport(input.propertyId);
    const investorPool = allocations.find((a) => a.party === 'investorPercent')?.amount ?? 0;
    const investorPayouts = (propertyReport?.investors ?? []).map((inv) => ({
        userId: inv.userId,
        accountId: inv.accountId,
        ownershipPercent: inv.ownershipPercent,
        amount: round2((investorPool * inv.ownershipPercent) / 100),
    }));
    const installments = Math.max(1, Math.min(12, input.installments ?? 1));
    const paymentSchedule = Array.from({ length: installments }, (_, index) => {
        const due = new Date();
        due.setUTCMonth(due.getUTCMonth() + index);
        return {
            installment: index + 1,
            dueDate: due.toISOString().slice(0, 10),
            amount: round2(input.totalAmount / installments),
            status: 'scheduled',
        };
    });
    const plan = {
        distributionId: makeId('dist'),
        propertyId: input.propertyId,
        totalAmount: round2(input.totalAmount),
        split,
        allocations,
        investorPayouts,
        paymentSchedule,
        approvalRequired: input.totalAmount >= 50_000,
        status: 'draft',
        createdAt: nowIso(),
    };
    const plans = await readStore(DISTRIBUTIONS_FILE(), []);
    plans.push(plan);
    await writeStore(DISTRIBUTIONS_FILE(), plans);
    await appendFinanceEvent({ action: 'distribution_calculated', distributionId: plan.distributionId, propertyId: input.propertyId, totalAmount: plan.totalAmount });
    return plan;
}
export async function listDistributions(propertyId) {
    const plans = await readStore(DISTRIBUTIONS_FILE(), []);
    return propertyId ? plans.filter((p) => p.propertyId === propertyId) : plans;
}
/** Executes a distribution plan — writes ledger entries for each investor payout. */
export async function executeDistribution(distributionId, executedBy) {
    const plans = await readStore(DISTRIBUTIONS_FILE(), []);
    const plan = plans.find((p) => p.distributionId === distributionId);
    if (!plan)
        throw new Error(`Distribution not found: ${distributionId}`);
    if (plan.status === 'executed')
        throw new Error('Distribution already executed.');
    for (const payout of plan.investorPayouts) {
        if (payout.amount <= 0)
            continue;
        await recordTransaction({
            userId: payout.userId,
            accountId: payout.accountId,
            type: 'distribution',
            amount: payout.amount,
            propertyId: plan.propertyId,
            memo: `Distribution ${plan.distributionId} (${payout.ownershipPercent}% ownership)`,
            createdBy: executedBy,
        });
    }
    plan.status = 'executed';
    await writeStore(DISTRIBUTIONS_FILE(), plans);
    await appendFinanceEvent({ action: 'distribution_executed', distributionId, executedBy, payouts: plan.investorPayouts.length });
    return plan;
}
export async function recordCommission(input) {
    if (!Number.isFinite(input.salePrice) || input.salePrice <= 0) {
        throw new Error('salePrice must be a positive number.');
    }
    const commissionPercent = input.commissionPercent ?? 6;
    const brokerSplit = input.brokerSplitPercent ?? 50;
    const agentSplit = input.agentSplitPercent ?? 45;
    const referralSplit = input.referralSplitPercent ?? 5;
    if (Math.abs(brokerSplit + agentSplit + referralSplit - 100) > 0.01) {
        throw new Error('Broker + agent + referral splits must total 100%.');
    }
    const total = round2((input.salePrice * commissionPercent) / 100);
    const now = nowIso();
    const record = {
        commissionId: makeId('comm'),
        propertyId: input.propertyId,
        salePrice: round2(input.salePrice),
        commissionPercent,
        totalCommission: total,
        brokerSplitPercent: brokerSplit,
        agentSplitPercent: agentSplit,
        referralSplitPercent: referralSplit,
        brokerAmount: round2((total * brokerSplit) / 100),
        agentAmount: round2((total * agentSplit) / 100),
        referralAmount: round2((total * referralSplit) / 100),
        brokerId: input.brokerId ?? '',
        agentId: input.agentId ?? '',
        referralId: input.referralId ?? '',
        paymentStatus: 'unpaid',
        taxYear: new Date().getUTCFullYear(),
        createdAt: now,
        updatedAt: now,
    };
    const records = await readStore(COMMISSIONS_FILE(), []);
    records.push(record);
    await writeStore(COMMISSIONS_FILE(), records);
    await appendFinanceEvent({ action: 'commission_recorded', commissionId: record.commissionId, propertyId: input.propertyId, totalCommission: total });
    return record;
}
export async function listCommissions() {
    return readStore(COMMISSIONS_FILE(), []);
}
export async function updateCommissionStatus(commissionId, paymentStatus) {
    const records = await readStore(COMMISSIONS_FILE(), []);
    const record = records.find((r) => r.commissionId === commissionId);
    if (!record)
        throw new Error(`Commission not found: ${commissionId}`);
    record.paymentStatus = paymentStatus;
    record.updatedAt = nowIso();
    await writeStore(COMMISSIONS_FILE(), records);
    await appendFinanceEvent({ action: 'commission_status_updated', commissionId, paymentStatus });
    return record;
}
/** 1099 report — per payee totals for a tax year. */
export async function generate1099Report(taxYear) {
    const records = (await listCommissions()).filter((r) => r.taxYear === taxYear && r.paymentStatus === 'paid');
    const byPayee = new Map();
    const add = (payeeId, role, amount) => {
        if (!payeeId || amount <= 0)
            return;
        const key = `${role}|${payeeId}`;
        const existing = byPayee.get(key) ?? { payeeId, role, totalPaid: 0, commissionCount: 0 };
        existing.totalPaid = round2(existing.totalPaid + amount);
        existing.commissionCount += 1;
        byPayee.set(key, existing);
    };
    for (const record of records) {
        add(record.brokerId, 'broker', record.brokerAmount);
        add(record.agentId, 'agent', record.agentAmount);
        add(record.referralId, 'referral', record.referralAmount);
    }
    return { taxYear, payees: Array.from(byPayee.values()) };
}
export async function upsertInfluencer(input) {
    const records = await readStore(INFLUENCERS_FILE(), []);
    const now = nowIso();
    let record = input.influencerId ? records.find((r) => r.influencerId === input.influencerId) : undefined;
    if (!record) {
        record = {
            influencerId: input.influencerId ?? makeId('infl'),
            name: input.name,
            referralLink: input.referralLink ?? '',
            campaign: input.campaign ?? '',
            leadSource: input.leadSource ?? '',
            qualifiedLeads: 0,
            closedDeals: 0,
            revenueGenerated: 0,
            commissionPercent: input.commissionPercent ?? 2,
            commissionDue: 0,
            paymentStatus: 'unpaid',
            lifetimeEarnings: 0,
            createdAt: now,
            updatedAt: now,
        };
        records.push(record);
    }
    else {
        record.name = input.name || record.name;
        if (input.referralLink !== undefined)
            record.referralLink = input.referralLink;
        if (input.campaign !== undefined)
            record.campaign = input.campaign;
        if (input.leadSource !== undefined)
            record.leadSource = input.leadSource;
        if (typeof input.commissionPercent === 'number')
            record.commissionPercent = input.commissionPercent;
        record.updatedAt = now;
    }
    await writeStore(INFLUENCERS_FILE(), records);
    await appendFinanceEvent({ action: 'influencer_upserted', influencerId: record.influencerId });
    return record;
}
export async function trackInfluencerActivity(input) {
    const records = await readStore(INFLUENCERS_FILE(), []);
    const record = records.find((r) => r.influencerId === input.influencerId);
    if (!record)
        throw new Error(`Influencer not found: ${input.influencerId}`);
    record.qualifiedLeads += Math.max(0, input.qualifiedLeads ?? 0);
    record.closedDeals += Math.max(0, input.closedDeals ?? 0);
    const newRevenue = Math.max(0, input.revenueGenerated ?? 0);
    record.revenueGenerated = round2(record.revenueGenerated + newRevenue);
    record.commissionDue = round2(record.commissionDue + (newRevenue * record.commissionPercent) / 100);
    record.updatedAt = nowIso();
    await writeStore(INFLUENCERS_FILE(), records);
    await appendFinanceEvent({ action: 'influencer_activity_tracked', influencerId: input.influencerId, newRevenue });
    return record;
}
export async function payInfluencer(influencerId) {
    const records = await readStore(INFLUENCERS_FILE(), []);
    const record = records.find((r) => r.influencerId === influencerId);
    if (!record)
        throw new Error(`Influencer not found: ${influencerId}`);
    record.lifetimeEarnings = round2(record.lifetimeEarnings + record.commissionDue);
    record.commissionDue = 0;
    record.paymentStatus = 'paid';
    record.updatedAt = nowIso();
    await writeStore(INFLUENCERS_FILE(), records);
    await appendFinanceEvent({ action: 'influencer_paid', influencerId });
    return record;
}
export async function listInfluencers() {
    return readStore(INFLUENCERS_FILE(), []);
}
export async function getFinancialDashboard() {
    const [accounts, entries, plans, commissions, influencers, approvals] = await Promise.all([
        listInvestorAccounts(),
        listLedger({ limit: 1000 }),
        listDistributions(),
        listCommissions(),
        listInfluencers(),
        listApprovals('pending'),
    ]);
    const { verifyLedgerIntegrity } = await import('./ivx-treasury-system');
    const integrity = await verifyLedgerIntegrity();
    const completed = entries.filter((e) => e.status === 'completed');
    const sum = (types) => round2(completed.filter((e) => types.includes(e.type)).reduce((s, e) => s + e.amount, 0));
    const deposits = sum(['deposit']);
    const withdrawals = sum(['withdrawal']);
    const capitalDeployed = sum(['investment']);
    const income = sum(['distribution', 'dividend', 'interest', 'profit']);
    const profit = sum(['profit', 'distribution', 'dividend', 'interest']);
    const loss = sum(['loss']);
    const balances = [];
    for (const account of accounts.slice(0, 50)) {
        const summary = await getAccountSummary(account.accountId);
        if (summary) {
            balances.push({
                accountId: account.accountId,
                displayName: account.displayName,
                netWorth: summary.netWorthInsideIVX,
                availableCash: summary.availableCash,
            });
        }
    }
    const pendingDistributions = plans
        .filter((p) => p.status !== 'executed')
        .reduce((s, p) => s + p.totalAmount, 0);
    const unpaidCommissions = commissions
        .filter((c) => c.paymentStatus !== 'paid')
        .reduce((s, c) => s + c.totalCommission, 0);
    const influencerDue = influencers.reduce((s, i) => s + i.commissionDue, 0);
    const outstanding = entries
        .filter((e) => e.status === 'pending' || e.status === 'pending_approval')
        .reduce((s, e) => s + e.amount, 0);
    return {
        generatedAt: nowIso(),
        cashOnHand: round2(deposits + income - withdrawals - capitalDeployed - sum(['fee', 'loss'])),
        capitalRaised: deposits,
        capitalDeployed,
        profit: round2(profit),
        loss: round2(loss),
        outstandingPayments: round2(outstanding),
        pendingDistributions: round2(pendingDistributions),
        pendingApprovals: approvals.length,
        investorBalances: balances,
        realtorCommissionsUnpaid: round2(unpaidCommissions),
        influencerCommissionsDue: round2(influencerDue),
        ledgerIntegrity: { valid: integrity.valid, totalEntries: integrity.totalEntries },
    };
}
export const VALID_REPORT_TYPES = new Set([
    'profit', 'cash_flow', 'balance_sheet', 'income_statement', 'commissions', 'tax', 'executive',
]);
export async function generateReport(type) {
    const entries = await listLedger({ limit: 1000 });
    const completed = entries.filter((e) => e.status === 'completed');
    const sum = (types) => round2(completed.filter((e) => types.includes(e.type)).reduce((s, e) => s + e.amount, 0));
    const generatedAt = nowIso();
    switch (type) {
        case 'profit':
            return {
                type, generatedAt,
                grossIncome: sum(['profit', 'distribution', 'dividend', 'interest', 'commission']),
                expenses: sum(['fee', 'loss']),
                netProfit: round2(sum(['profit', 'distribution', 'dividend', 'interest', 'commission']) - sum(['fee', 'loss'])),
            };
        case 'cash_flow': {
            const inflow = sum(['deposit', 'distribution', 'dividend', 'interest', 'profit', 'refund']);
            const outflow = sum(['withdrawal', 'investment', 'fee', 'loss', 'commission']);
            return { type, generatedAt, inflow, outflow, netCashFlow: round2(inflow - outflow) };
        }
        case 'balance_sheet': {
            const dashboard = await getFinancialDashboard();
            return {
                type, generatedAt,
                assets: { cash: dashboard.cashOnHand, deployedCapital: dashboard.capitalDeployed, total: round2(dashboard.cashOnHand + dashboard.capitalDeployed) },
                liabilities: { outstandingPayments: dashboard.outstandingPayments, pendingDistributions: dashboard.pendingDistributions, unpaidCommissions: dashboard.realtorCommissionsUnpaid + dashboard.influencerCommissionsDue },
                equity: round2(dashboard.cashOnHand + dashboard.capitalDeployed - dashboard.outstandingPayments - dashboard.pendingDistributions),
            };
        }
        case 'income_statement':
            return {
                type, generatedAt,
                revenue: { distributions: sum(['distribution']), dividends: sum(['dividend']), interest: sum(['interest']), profits: sum(['profit']) },
                expenses: { fees: sum(['fee']), losses: sum(['loss']), commissions: sum(['commission']) },
                netIncome: round2(sum(['distribution', 'dividend', 'interest', 'profit']) - sum(['fee', 'loss', 'commission'])),
            };
        case 'commissions': {
            const commissions = await listCommissions();
            const influencers = await listInfluencers();
            return {
                type, generatedAt,
                realtor: { total: round2(commissions.reduce((s, c) => s + c.totalCommission, 0)), paid: round2(commissions.filter((c) => c.paymentStatus === 'paid').reduce((s, c) => s + c.totalCommission, 0)), count: commissions.length },
                influencer: { lifetime: round2(influencers.reduce((s, i) => s + i.lifetimeEarnings, 0)), due: round2(influencers.reduce((s, i) => s + i.commissionDue, 0)), count: influencers.length },
            };
        }
        case 'tax': {
            const year = new Date().getUTCFullYear();
            const report1099 = await generate1099Report(year);
            return {
                type, generatedAt, taxYear: year,
                taxableDistributions: sum(['distribution']),
                taxableInterest: sum(['interest']),
                taxableDividends: sum(['dividend']),
                realizedGains: sum(['profit']),
                form1099Payees: report1099.payees,
            };
        }
        case 'executive': {
            const dashboard = await getFinancialDashboard();
            const aiFinance = await getAIFinanceMonitor();
            return { type, generatedAt, dashboard, aiFinance };
        }
        default:
            throw new Error(`Unknown report type: ${String(type)}`);
    }
}
export async function getAIFinanceMonitor() {
    const entries = await listLedger({ limit: 1000 });
    const now = Date.now();
    const dayMs = 86_400_000;
    const completed = entries.filter((e) => e.status === 'completed');
    const last30 = completed.filter((e) => now - new Date(e.timestamp).getTime() <= 30 * dayMs);
    const inflow = round2(last30.filter((e) => ['deposit', 'distribution', 'dividend', 'interest', 'profit', 'refund'].includes(e.type)).reduce((s, e) => s + e.amount, 0));
    const outflow = round2(last30.filter((e) => ['withdrawal', 'investment', 'fee', 'loss', 'commission'].includes(e.type)).reduce((s, e) => s + e.amount, 0));
    const net = round2(inflow - outflow);
    const plans = await listDistributions();
    const upcoming = plans
        .filter((p) => p.status !== 'executed')
        .map((p) => {
        const nextInstallment = p.paymentSchedule.find((s) => s.status === 'scheduled');
        return {
            distributionId: p.distributionId,
            propertyId: p.propertyId,
            nextDueDate: nextInstallment?.dueDate ?? '',
            amount: nextInstallment?.amount ?? p.totalAmount,
        };
    })
        .filter((p) => p.nextDueDate !== '');
    const overdue = entries
        .filter((e) => (e.status === 'pending' || e.status === 'pending_approval') && now - new Date(e.timestamp).getTime() > 7 * dayMs)
        .map((e) => ({
        transactionId: e.transactionId,
        type: e.type,
        amount: e.amount,
        daysPending: Math.floor((now - new Date(e.timestamp).getTime()) / dayMs),
    }));
    // Profit anomalies — z-score on completed amounts.
    const amounts = completed.map((e) => e.amount);
    const mean = amounts.length > 0 ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0;
    const variance = amounts.length > 1 ? amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / (amounts.length - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const anomalies = stdDev > 0
        ? completed
            .map((e) => ({ entry: e, zScore: (e.amount - mean) / stdDev }))
            .filter((a) => Math.abs(a.zScore) >= 3)
            .slice(0, 10)
            .map((a) => ({
            transactionId: a.entry.transactionId,
            type: a.entry.type,
            amount: a.entry.amount,
            zScore: round2(a.zScore),
            note: `Amount deviates ${round2(Math.abs(a.zScore))}σ from the ledger mean.`,
        }))
        : [];
    // Fraud heuristics.
    const fraudSignals = [];
    const withdrawals24h = entries.filter((e) => e.type === 'withdrawal' && now - new Date(e.timestamp).getTime() <= dayMs);
    if (withdrawals24h.length >= 5) {
        fraudSignals.push({ signal: 'withdrawal_velocity', severity: 'high', detail: `${withdrawals24h.length} withdrawals in the last 24h.` });
    }
    const byUserAmount = new Map();
    for (const e of entries) {
        const key = `${e.userId}|${e.type}|${e.amount}`;
        byUserAmount.set(key, (byUserAmount.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byUserAmount) {
        if (count >= 4) {
            const [userId, type, amount] = key.split('|');
            fraudSignals.push({ signal: 'duplicate_amount_pattern', severity: 'medium', detail: `User ${userId} has ${count} ${type} transactions of exactly ${amount}.` });
        }
    }
    const largePending = entries.filter((e) => e.status === 'pending_approval' && e.amount >= 250_000);
    if (largePending.length > 0) {
        fraudSignals.push({ signal: 'large_payment_awaiting_approval', severity: 'low', detail: `${largePending.length} payment(s) ≥ $250K awaiting the approval chain.` });
    }
    // Capital forecast — 30d linear projection from the last 30d run rate.
    const forecast = {
        horizonDays: 30,
        projectedInflow: inflow,
        projectedOutflow: outflow,
        projectedNet: net,
    };
    const summaryParts = [
        `Net 30-day cash flow is ${net >= 0 ? 'positive' : 'negative'} at ${net} USD (inflow ${inflow}, outflow ${outflow}).`,
        upcoming.length > 0 ? `${upcoming.length} distribution installment(s) upcoming.` : 'No pending distributions.',
        overdue.length > 0 ? `${overdue.length} payment(s) overdue beyond 7 days — review required.` : 'No overdue payments.',
        anomalies.length > 0 ? `${anomalies.length} profit anomaly(ies) flagged (≥3σ).` : 'No profit anomalies detected.',
        fraudSignals.length > 0 ? `${fraudSignals.length} fraud signal(s) raised.` : 'No fraud signals.',
    ];
    return {
        generatedAt: nowIso(),
        cashFlow: { last30dInflow: inflow, last30dOutflow: outflow, net, trend: net > 0 ? 'positive' : net < 0 ? 'negative' : 'flat' },
        upcomingDistributions: upcoming,
        overduePayments: overdue,
        profitAnomalies: anomalies,
        fraudSignals,
        capitalForecast: forecast,
        executiveSummary: summaryParts.join(' '),
    };
}
