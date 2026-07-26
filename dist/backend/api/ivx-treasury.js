/**
 * IVX Enterprise Capital & Treasury — API handlers.
 *
 * Member-facing (Bearer userId, same trust model as /api/members/*):
 *   POST /api/treasury/accounts                    → create investor account
 *   GET  /api/treasury/accounts?userId=            → list own accounts
 *   GET  /api/treasury/account?accountId=          → live account summary
 *   GET  /api/treasury/statement?accountId=&period=&format=json|csv|excel|pdf
 *
 * Owner/admin-only:
 *   POST /api/ivx/treasury/ledger                  → record transaction (auto approval chain ≥ $50K)
 *   GET  /api/ivx/treasury/ledger?accountId=&type=&status=
 *   POST /api/ivx/treasury/ledger/amend            → tracked correction (who/when/prev/new/reason)
 *   GET  /api/ivx/treasury/audit                   → hash-chain integrity + verification
 *   GET  /api/ivx/treasury/approvals?status=
 *   POST /api/ivx/treasury/approvals/decide        → CEO → Finance → Owner chain decision
 *   POST /api/ivx/treasury/property-capital        → upsert property config
 *   GET  /api/ivx/treasury/property-capital?propertyId=
 *   POST /api/ivx/treasury/distributions/calculate → split calculator + payment schedule
 *   POST /api/ivx/treasury/distributions/execute   → write payout ledger entries
 *   GET  /api/ivx/treasury/distributions?propertyId=
 *   POST /api/ivx/treasury/commissions             → record realtor commission
 *   GET  /api/ivx/treasury/commissions?taxYear=    → list + 1099 report
 *   POST /api/ivx/treasury/commissions/status      → update payment status
 *   POST /api/ivx/treasury/influencers             → upsert influencer
 *   POST /api/ivx/treasury/influencers/track       → track leads/deals/revenue
 *   POST /api/ivx/treasury/influencers/pay         → pay commission due
 *   GET  /api/ivx/treasury/influencers
 *   POST /api/ivx/treasury/reconciliation/bank-item→ add bank item
 *   POST /api/ivx/treasury/reconciliation/run      → auto-match, detect unmatched
 *   GET  /api/ivx/treasury/dashboard               → live financial dashboard
 *   GET  /api/ivx/treasury/reports?type=           → profit/cash_flow/balance_sheet/…
 *   GET  /api/ivx/treasury/ai-finance              → AI finance monitor + executive summary
 */
import { createInvestorAccount, listInvestorAccounts, getAccountSummary, recordTransaction, listLedger, amendTransaction, verifyLedgerIntegrity, listApprovals, decideApproval, addBankItem, runReconciliation, listBankItems, IVX_TREASURY_MARKER, VALID_ACCOUNT_TYPES, VALID_TRANSACTION_TYPES, VALID_BANK_ITEM_KINDS, } from '../services/ivx-treasury-system';
import { generateStatement, statementToCSV, statementToPDF, upsertPropertyCapital, listPropertyCapitalConfigs, getPropertyCapitalReport, calculateDistribution, listDistributions, executeDistribution, recordCommission, listCommissions, updateCommissionStatus, generate1099Report, upsertInfluencer, trackInfluencerActivity, payInfluencer, listInfluencers, getFinancialDashboard, generateReport, getAIFinanceMonitor, VALID_STATEMENT_PERIODS, VALID_REPORT_TYPES, } from '../services/ivx-treasury-finance';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
export function treasuryOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
    });
}
export function treasuryAdminOptions() {
    return ownerOnlyOptions();
}
async function parseBody(request) {
    try {
        return (await request.json());
    }
    catch {
        return {};
    }
}
function asString(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function getAuthUserId(request) {
    const authHeader = request.headers.get('Authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
}
async function requireOwner(request) {
    try {
        await assertIVXOwnerOnly(request);
        return null;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
        const status = /required|missing|unauthorized|invalid/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
function errorMessage(err) {
    return err instanceof Error ? err.message : 'Unexpected treasury error.';
}
// ---------------------------------------------------------------------------
// Accounts (member-facing)
// ---------------------------------------------------------------------------
export async function handleTreasuryAccountCreate(request) {
    const body = await parseBody(request);
    const userId = asString(body.userId) || getAuthUserId(request) || '';
    const displayName = asString(body.displayName);
    const accountType = asString(body.accountType);
    if (!userId || !displayName) {
        return jsonResponse({ success: false, message: 'userId and displayName are required.', marker: IVX_TREASURY_MARKER }, 400);
    }
    if (!VALID_ACCOUNT_TYPES.has(accountType)) {
        return jsonResponse({ success: false, message: `accountType must be one of: ${Array.from(VALID_ACCOUNT_TYPES).join(', ')}.` }, 400);
    }
    try {
        const account = await createInvestorAccount({ userId, displayName, accountType, currency: asString(body.currency) || undefined });
        return jsonResponse({ success: true, account, marker: IVX_TREASURY_MARKER }, 201);
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 500);
    }
}
export async function handleTreasuryAccountsList(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || getAuthUserId(request) || '';
    if (!userId)
        return jsonResponse({ success: false, message: 'userId is required.' }, 400);
    const accounts = await listInvestorAccounts(userId);
    return jsonResponse({ success: true, accounts, marker: IVX_TREASURY_MARKER });
}
export async function handleTreasuryAccountSummary(request) {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId') || '';
    if (!accountId)
        return jsonResponse({ success: false, message: 'accountId is required.' }, 400);
    const summary = await getAccountSummary(accountId);
    if (!summary)
        return jsonResponse({ success: false, message: 'Account not found.' }, 404);
    return jsonResponse({ success: true, summary, marker: IVX_TREASURY_MARKER });
}
// ---------------------------------------------------------------------------
// Statements (member-facing)
// ---------------------------------------------------------------------------
export async function handleTreasuryStatement(request) {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId') || '';
    const period = (url.searchParams.get('period') || 'monthly');
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    if (!accountId)
        return jsonResponse({ success: false, message: 'accountId is required.' }, 400);
    if (!VALID_STATEMENT_PERIODS.has(period)) {
        return jsonResponse({ success: false, message: `period must be one of: ${Array.from(VALID_STATEMENT_PERIODS).join(', ')}.` }, 400);
    }
    try {
        const statement = await generateStatement(accountId, period);
        if (format === 'csv' || format === 'excel') {
            return new Response(statementToCSV(statement), {
                status: 200,
                headers: {
                    'Content-Type': format === 'excel' ? 'application/vnd.ms-excel' : 'text/csv',
                    'Content-Disposition': `attachment; filename="ivx-statement-${statement.statementId}.${format === 'excel' ? 'xls' : 'csv'}"`,
                    'Access-Control-Allow-Origin': 'https://ivxholding.com',
                },
            });
        }
        if (format === 'pdf') {
            const pdf = statementToPDF(statement);
            return new Response(pdf.buffer, {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="ivx-statement-${statement.statementId}.pdf"`,
                    'Access-Control-Allow-Origin': 'https://ivxholding.com',
                },
            });
        }
        return jsonResponse({ success: true, statement, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 404);
    }
}
// ---------------------------------------------------------------------------
// Ledger (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryLedgerRecord(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    const type = asString(body.type);
    if (!VALID_TRANSACTION_TYPES.has(type)) {
        return jsonResponse({ success: false, message: `type must be one of: ${Array.from(VALID_TRANSACTION_TYPES).join(', ')}.` }, 400);
    }
    try {
        const result = await recordTransaction({
            userId: asString(body.userId),
            accountId: asString(body.accountId),
            type,
            amount: asNumber(body.amount) ?? NaN,
            currency: asString(body.currency) || undefined,
            asset: asString(body.asset) || undefined,
            memo: asString(body.memo) || undefined,
            propertyId: asString(body.propertyId) || null,
            createdBy: asString(body.createdBy) || undefined,
            status: (asString(body.status) || undefined),
        });
        return jsonResponse({ success: true, transaction: result.entry, approval: result.approval, marker: IVX_TREASURY_MARKER }, 201);
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryLedgerList(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const entries = await listLedger({
        accountId: url.searchParams.get('accountId') || undefined,
        userId: url.searchParams.get('ledgerUserId') || undefined,
        type: (url.searchParams.get('type') || undefined),
        status: (url.searchParams.get('status') || undefined),
        propertyId: url.searchParams.get('propertyId') || undefined,
        limit: Number(url.searchParams.get('limit')) || undefined,
    });
    return jsonResponse({ success: true, entries, count: entries.length, marker: IVX_TREASURY_MARKER });
}
export async function handleTreasuryLedgerAmend(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    const field = asString(body.field);
    if (field !== 'status' && field !== 'memo') {
        return jsonResponse({ success: false, message: "field must be 'status' or 'memo' — the ledger itself is immutable." }, 400);
    }
    try {
        const entry = await amendTransaction({
            transactionId: asString(body.transactionId),
            field,
            newValue: asString(body.newValue),
            editedBy: asString(body.editedBy) || 'owner',
            reason: asString(body.reason),
        });
        return jsonResponse({ success: true, transaction: entry, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryAudit(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const integrity = await verifyLedgerIntegrity();
    return jsonResponse({ success: true, integrity, immutable: true, hashAlgorithm: 'sha256-chain', marker: IVX_TREASURY_MARKER });
}
// ---------------------------------------------------------------------------
// Approvals (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryApprovalsList(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const approvals = await listApprovals(status ?? undefined);
    return jsonResponse({ success: true, approvals, count: approvals.length, marker: IVX_TREASURY_MARKER });
}
export async function handleTreasuryApprovalDecide(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    const role = asString(body.role);
    const decision = asString(body.decision);
    if (!['ceo', 'finance', 'owner'].includes(role) || (decision !== 'approved' && decision !== 'rejected')) {
        return jsonResponse({ success: false, message: "role must be ceo|finance|owner and decision must be approved|rejected." }, 400);
    }
    try {
        const approval = await decideApproval({
            approvalId: asString(body.approvalId),
            role,
            decision,
            decidedBy: asString(body.decidedBy) || role,
            note: asString(body.note) || undefined,
        });
        return jsonResponse({ success: true, approval, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
// ---------------------------------------------------------------------------
// Property capital (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryPropertyCapitalUpsert(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    const propertyId = asString(body.propertyId);
    if (!propertyId)
        return jsonResponse({ success: false, message: 'propertyId is required.' }, 400);
    try {
        const config = await upsertPropertyCapital({
            propertyId,
            propertyName: asString(body.propertyName) || undefined,
            capitalTarget: asNumber(body.capitalTarget),
            preferredReturnPercent: asNumber(body.preferredReturnPercent),
        });
        return jsonResponse({ success: true, config, marker: IVX_TREASURY_MARKER }, 201);
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryPropertyCapitalGet(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const propertyId = url.searchParams.get('propertyId');
    if (propertyId) {
        const report = await getPropertyCapitalReport(propertyId);
        if (!report)
            return jsonResponse({ success: false, message: 'Property capital config not found.' }, 404);
        return jsonResponse({ success: true, report, marker: IVX_TREASURY_MARKER });
    }
    const configs = await listPropertyCapitalConfigs();
    return jsonResponse({ success: true, configs, count: configs.length, marker: IVX_TREASURY_MARKER });
}
// ---------------------------------------------------------------------------
// Distributions (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryDistributionCalculate(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    try {
        const plan = await calculateDistribution({
            propertyId: asString(body.propertyId),
            totalAmount: asNumber(body.totalAmount) ?? NaN,
            split: (body.split && typeof body.split === 'object' ? body.split : undefined),
            installments: asNumber(body.installments),
        });
        return jsonResponse({ success: true, plan, marker: IVX_TREASURY_MARKER }, 201);
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryDistributionExecute(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    try {
        const plan = await executeDistribution(asString(body.distributionId), asString(body.executedBy) || 'owner');
        return jsonResponse({ success: true, plan, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryDistributionsList(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const plans = await listDistributions(url.searchParams.get('propertyId') || undefined);
    return jsonResponse({ success: true, plans, count: plans.length, marker: IVX_TREASURY_MARKER });
}
// ---------------------------------------------------------------------------
// Realtor commissions (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryCommissionRecord(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    try {
        const record = await recordCommission({
            propertyId: asString(body.propertyId),
            salePrice: asNumber(body.salePrice) ?? NaN,
            commissionPercent: asNumber(body.commissionPercent),
            brokerSplitPercent: asNumber(body.brokerSplitPercent),
            agentSplitPercent: asNumber(body.agentSplitPercent),
            referralSplitPercent: asNumber(body.referralSplitPercent),
            brokerId: asString(body.brokerId) || undefined,
            agentId: asString(body.agentId) || undefined,
            referralId: asString(body.referralId) || undefined,
        });
        return jsonResponse({ success: true, commission: record, marker: IVX_TREASURY_MARKER }, 201);
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryCommissionsList(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const taxYear = Number(url.searchParams.get('taxYear')) || null;
    const commissions = await listCommissions();
    const report1099 = taxYear ? await generate1099Report(taxYear) : null;
    return jsonResponse({ success: true, commissions, count: commissions.length, report1099, marker: IVX_TREASURY_MARKER });
}
export async function handleTreasuryCommissionStatus(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    const status = asString(body.paymentStatus);
    if (!['unpaid', 'scheduled', 'paid'].includes(status)) {
        return jsonResponse({ success: false, message: 'paymentStatus must be unpaid|scheduled|paid.' }, 400);
    }
    try {
        const record = await updateCommissionStatus(asString(body.commissionId), status);
        return jsonResponse({ success: true, commission: record, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
// ---------------------------------------------------------------------------
// Influencer payments (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryInfluencerUpsert(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    const name = asString(body.name);
    if (!name)
        return jsonResponse({ success: false, message: 'name is required.' }, 400);
    try {
        const record = await upsertInfluencer({
            influencerId: asString(body.influencerId) || undefined,
            name,
            referralLink: asString(body.referralLink) || undefined,
            campaign: asString(body.campaign) || undefined,
            leadSource: asString(body.leadSource) || undefined,
            commissionPercent: asNumber(body.commissionPercent),
        });
        return jsonResponse({ success: true, influencer: record, marker: IVX_TREASURY_MARKER }, 201);
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryInfluencerTrack(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    try {
        const record = await trackInfluencerActivity({
            influencerId: asString(body.influencerId),
            qualifiedLeads: asNumber(body.qualifiedLeads),
            closedDeals: asNumber(body.closedDeals),
            revenueGenerated: asNumber(body.revenueGenerated),
        });
        return jsonResponse({ success: true, influencer: record, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryInfluencerPay(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    try {
        const record = await payInfluencer(asString(body.influencerId));
        return jsonResponse({ success: true, influencer: record, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryInfluencersList(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const influencers = await listInfluencers();
    return jsonResponse({ success: true, influencers, count: influencers.length, marker: IVX_TREASURY_MARKER });
}
// ---------------------------------------------------------------------------
// Bank reconciliation (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryBankItemAdd(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const body = await parseBody(request);
    const kind = asString(body.kind);
    if (!VALID_BANK_ITEM_KINDS.has(kind)) {
        return jsonResponse({ success: false, message: `kind must be one of: ${Array.from(VALID_BANK_ITEM_KINDS).join(', ')}.` }, 400);
    }
    try {
        const item = await addBankItem({
            kind,
            amount: asNumber(body.amount) ?? NaN,
            currency: asString(body.currency) || undefined,
            reference: asString(body.reference) || undefined,
            bankDate: asString(body.bankDate) || undefined,
        });
        return jsonResponse({ success: true, bankItem: item, marker: IVX_TREASURY_MARKER }, 201);
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryReconciliationRun(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const result = await runReconciliation();
    return jsonResponse({ success: true, reconciliation: result, marker: IVX_TREASURY_MARKER });
}
export async function handleTreasuryBankItemsList(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const items = await listBankItems();
    return jsonResponse({ success: true, bankItems: items, count: items.length, marker: IVX_TREASURY_MARKER });
}
// ---------------------------------------------------------------------------
// Dashboard, reports, AI finance (owner/admin)
// ---------------------------------------------------------------------------
export async function handleTreasuryDashboard(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const dashboard = await getFinancialDashboard();
    return jsonResponse({ success: true, dashboard, marker: IVX_TREASURY_MARKER });
}
export async function handleTreasuryReports(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const type = (url.searchParams.get('type') || 'executive');
    if (!VALID_REPORT_TYPES.has(type)) {
        return jsonResponse({ success: false, message: `type must be one of: ${Array.from(VALID_REPORT_TYPES).join(', ')}.` }, 400);
    }
    try {
        const report = await generateReport(type);
        return jsonResponse({ success: true, report, marker: IVX_TREASURY_MARKER });
    }
    catch (err) {
        return jsonResponse({ success: false, message: errorMessage(err) }, 400);
    }
}
export async function handleTreasuryAIFinance(request) {
    const guard = await requireOwner(request);
    if (guard)
        return guard;
    const monitor = await getAIFinanceMonitor();
    return jsonResponse({ success: true, aiFinance: monitor, marker: IVX_TREASURY_MARKER });
}
