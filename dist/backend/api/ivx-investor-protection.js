/**
 * IVX Enterprise Investor Protection System — API handlers.
 *
 * Owner-only routes (require assertIVXOwnerOnly):
 *   GET    /api/ivx/protection/dashboard           → owner controls dashboard (section 8 + 12)
 *   GET    /api/ivx/protection/audit-log           → audit log (section 9)
 *   GET    /api/ivx/protection/account-states      → list account states (section 2)
 *   POST   /api/ivx/protection/account-states/transition → transition state (section 2)
 *   POST   /api/ivx/protection/account/unlock      → unlock a verified investor (section 1 + 2)
 *   GET    /api/ivx/protection/deletion-requests   → list deletion requests (section 2)
 *   POST   /api/ivx/protection/deletion-requests   → create deletion request
 *   POST   /api/ivx/protection/deletion-requests/approve   → owner approval
 *   POST   /api/ivx/protection/deletion-requests/confirm  → second confirmation
 *   GET    /api/ivx/protection/recovery            → list recovery requests (section 1)
 *   POST   /api/ivx/protection/recovery/start      → start recovery (email/sms/2fa/admin)
 *   POST   /api/ivx/protection/recovery/verify     → verify code
 *   POST   /api/ivx/protection/recovery/complete   → admin-assisted complete
 *   GET    /api/ivx/protection/sessions            → list sessions (section 1)
 *   POST   /api/ivx/protection/sessions/register   → register session
 *   POST   /api/ivx/protection/sessions/revoke     → revoke session
 *   GET    /api/ivx/protection/investments         → list investments (section 4)
 *   POST   /api/ivx/protection/investments         → create investment
 *   POST   /api/ivx/protection/investments/valuation → update valuation + profit
 *   GET    /api/ivx/protection/withdrawals         → list withdrawals (section 6)
 *   POST   /api/ivx/protection/withdrawals         → create withdrawal request
 *   POST   /api/ivx/protection/withdrawals/transition → advance withdrawal workflow
 *   GET    /api/ivx/protection/wires               → list wires (safe view) (section 7)
 *   POST   /api/ivx/protection/wires               → create wire (encrypted)
 *   POST   /api/ivx/protection/wires/transition    → transition wire status
 *   GET    /api/ivx/protection/wire-queue          → wires pending initiation
 *   GET    /api/ivx/protection/compliance          → list compliance records (section 11)
 *   GET    /api/ivx/protection/compliance?userId=  → single compliance record
 *   POST   /api/ivx/protection/compliance          → upsert compliance
 *   GET    /api/ivx/protection/wallet?userId=      → investor wallet summary (section 3)
 *   GET    /api/ivx/protection/reports?type=       → owner reports (section 12)
 *   POST   /api/ivx/protection/reports             → generate owner report
 *   GET    /api/ivx/protection/ledger-integrity    → verify hash-chain ledger (section 5 + 10)
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { IVX_INVESTOR_PROTECTION_MARKER, VALID_ACCOUNT_STATES, VALID_INVESTMENT_TYPES, VALID_RECOVERY_CHANNELS, VALID_WITHDRAWAL_STATUSES, approveDeletionRequest, createDeletionRequest, createInvestment, startRecoveryRequest, createWire, createWithdrawal, generateOwnerReport, getAccountStateRecord, getCompliance, getInvestorWalletSummary, getOwnerDashboardSummary, listAccountStates, listCompliance, listDeletionRequests, listInvestments, listProtectionAudit, listRecoveryRequests, listSessions, listWires, listWithdrawals, registerSession, revokeSession, secondConfirmDeletion, transitionAccountState, transitionWithdrawal, unlockAccount, upsertCompliance, updateInvestmentValuation, verifyRecoveryCode, adminAssistedRecoveryComplete, wireQueue, transitionWire, } from '../services/ivx-investor-protection';
import { verifyLedgerIntegrity } from '../services/ivx-treasury-system';
export function OPTIONS() {
    return ownerOnlyOptions();
}
function badRequest(message, status = 400) {
    return ownerOnlyJson({ ok: false, marker: IVX_INVESTOR_PROTECTION_MARKER, error: message }, status);
}
/** Auth-guard failures must return 401, not 500, so callers can distinguish
 *  missing/invalid owner session from a real server error. */
function errorStatus(error, fallback = 500) {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (msg.includes('auth') || msg.includes('owner') || msg.includes('bearer') || msg.includes('token') || msg.includes('unauthorized') || msg.includes('forbidden')) {
        return 401;
    }
    return fallback;
}
/** Build the error response with the correct status code (401 for auth, 500 otherwise). */
function errorResponse(error, fallbackMessage, fallbackStatus = 500) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    return badRequest(message, errorStatus(error, fallbackStatus));
}
function ok(payload) {
    return ownerOnlyJson({ ok: true, marker: IVX_INVESTOR_PROTECTION_MARKER, ...payload });
}
async function readJsonBody(request) {
    try {
        const text = await request.text();
        return text ? JSON.parse(text) : {};
    }
    catch {
        throw new Error('Invalid JSON body.');
    }
}
function getString(body, key, fallback = '') {
    const v = body[key];
    return typeof v === 'string' ? v.trim() : fallback;
}
function getNumber(body, key, fallback = 0) {
    const v = body[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v ? Number(v) : fallback);
}
function getBool(body, key, fallback = false) {
    const v = body[key];
    return typeof v === 'boolean' ? v : fallback;
}
async function requireOwner(request) {
    const ctx = await assertIVXOwnerOnly(request);
    return {
        operatorId: ctx.userId ?? 'owner',
        operatorEmail: ctx.email ?? 'owner@ivxholding.com',
        ip: '',
        device: '',
    };
}
// ---------------------------------------------------------------------------
// Dashboard, audit log, ledger integrity
// ---------------------------------------------------------------------------
export async function handleProtectionDashboardRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const memberCounts = {
            total: Number(url.searchParams.get('totalMembers') ?? '0') || 0,
            investors: Number(url.searchParams.get('investors') ?? '0') || 0,
            buyers: Number(url.searchParams.get('buyers') ?? '0') || 0,
            jvDeals: Number(url.searchParams.get('jvDeals') ?? '0') || 0,
            privateLenders: Number(url.searchParams.get('privateLenders') ?? '0') || 0,
        };
        const summary = await getOwnerDashboardSummary({ memberCounts });
        return ok({ summary });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Dashboard failed.';
        return badRequest(message, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
    }
}
export async function handleProtectionAuditLogRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const targetUserId = url.searchParams.get('userId') ?? undefined;
        const action = url.searchParams.get('action') ?? undefined;
        const limit = Number(url.searchParams.get('limit') ?? '500') || 500;
        const entries = await listProtectionAudit({ targetUserId, action, limit });
        return ok({ entries, count: entries.length });
    }
    catch (error) {
        return errorResponse(error, 'Audit log failed.');
    }
}
export async function handleProtectionLedgerIntegrityRequest(request) {
    try {
        await requireOwner(request);
        let treasury = null;
        try {
            treasury = await verifyLedgerIntegrity();
        }
        catch {
            treasury = null;
        }
        return ok({
            treasuryLedgerIntegrity: treasury,
            immutable: true,
            deletable: false,
            message: 'Ledger is append-only and hash-chained. No entry can be deleted.',
        });
    }
    catch (error) {
        return errorResponse(error, 'Ledger integrity check failed.');
    }
}
// ---------------------------------------------------------------------------
// Account state + deletion protection
// ---------------------------------------------------------------------------
export async function handleProtectionAccountStatesListRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const stateParam = url.searchParams.get('state');
        const states = await listAccountStates(stateParam && VALID_ACCOUNT_STATES.has(stateParam) ? { state: stateParam } : undefined);
        return ok({ states, count: states.length });
    }
    catch (error) {
        return errorResponse(error, 'List account states failed.');
    }
}
export async function handleProtectionAccountStateGetRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId') ?? '';
        if (!userId)
            return badRequest('Missing userId.', 400);
        const record = await getAccountStateRecord(userId);
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Get account state failed.');
    }
}
export async function handleProtectionAccountStateTransitionRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        const newState = getString(body, 'newState');
        const reason = getString(body, 'reason');
        const hasFunds = getBool(body, 'hasFunds');
        if (!userId)
            return badRequest('Missing userId.', 400);
        if (!VALID_ACCOUNT_STATES.has(newState))
            return badRequest(`Invalid newState: ${newState}`, 400);
        if (!reason)
            return badRequest('Missing reason.', 400);
        const record = await transitionAccountState({
            userId, newState, reason,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            hasFunds,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'State transition failed.';
        return badRequest(message, message.startsWith('BLOCKED_HAS_FUNDS') ? 423 : 500);
    }
}
export async function handleProtectionUnlockAccountRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        const reason = getString(body, 'reason', 'Admin unlock — verified investor access restored.');
        if (!userId)
            return badRequest('Missing userId.', 400);
        const record = await unlockAccount({
            userId, reason,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Unlock failed.');
    }
}
export async function handleProtectionDeletionListRequest(request) {
    try {
        await requireOwner(request);
        const requests = await listDeletionRequests();
        return ok({ requests, count: requests.length });
    }
    catch (error) {
        return errorResponse(error, 'List deletion requests failed.');
    }
}
export async function handleProtectionDeletionCreateRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        const reason = getString(body, 'reason');
        if (!userId)
            return badRequest('Missing userId.', 400);
        if (!reason)
            return badRequest('Missing reason.', 400);
        const record = await createDeletionRequest({
            userId,
            targetAccountId: getString(body, 'targetAccountId') || undefined,
            reason,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            hasFunds: getBool(body, 'hasFunds'),
            financialHistoryCount: getNumber(body, 'financialHistoryCount', 0),
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Deletion request failed.');
    }
}
export async function handleProtectionDeletionApproveRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const deletionId = getString(body, 'deletionId');
        if (!deletionId)
            return badRequest('Missing deletionId.', 400);
        const record = await approveDeletionRequest({
            deletionId,
            ownerApproverId: operator.operatorId,
            ownerEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Approve deletion failed.');
    }
}
export async function handleProtectionDeletionConfirmRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const deletionId = getString(body, 'deletionId');
        if (!deletionId)
            return badRequest('Missing deletionId.', 400);
        const record = await secondConfirmDeletion({
            deletionId,
            secondConfirmerId: operator.operatorId,
            confirmerEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Second confirm failed.');
    }
}
// ---------------------------------------------------------------------------
// Recovery + sessions
// ---------------------------------------------------------------------------
export async function handleProtectionRecoveryListRequest(request) {
    try {
        await requireOwner(request);
        const requests = await listRecoveryRequests();
        return ok({ requests, count: requests.length });
    }
    catch (error) {
        return errorResponse(error, 'List recovery failed.');
    }
}
export async function handleProtectionRecoveryStartRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const channel = getString(body, 'channel');
        if (!VALID_RECOVERY_CHANNELS.has(channel))
            return badRequest(`Invalid channel: ${channel}`, 400);
        const { request: record, code } = await startRecoveryRequest({
            userId: getString(body, 'userId') || undefined,
            email: getString(body, 'email') || undefined,
            phone: getString(body, 'phone') || undefined,
            channel,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        // The code is returned once to the operator for delivery via the chosen channel.
        return ok({ record, verificationCode: code });
    }
    catch (error) {
        return errorResponse(error, 'Recovery start failed.');
    }
}
export async function handleProtectionRecoveryVerifyRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const recoveryId = getString(body, 'recoveryId');
        const code = getString(body, 'code');
        if (!recoveryId || !code)
            return badRequest('Missing recoveryId or code.', 400);
        const record = await verifyRecoveryCode({
            recoveryId, code,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Verify failed.');
    }
}
export async function handleProtectionRecoveryCompleteRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const recoveryId = getString(body, 'recoveryId');
        if (!recoveryId)
            return badRequest('Missing recoveryId.', 400);
        const record = await adminAssistedRecoveryComplete({
            recoveryId,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Recovery complete failed.');
    }
}
export async function handleProtectionSessionsListRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId') ?? undefined;
        const onlyActive = url.searchParams.get('active') === '1';
        const sessions = await listSessions(userId, onlyActive);
        return ok({ sessions, count: sessions.length });
    }
    catch (error) {
        return errorResponse(error, 'List sessions failed.');
    }
}
export async function handleProtectionSessionRegisterRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        if (!userId)
            return badRequest('Missing userId.', 400);
        const session = await registerSession({
            userId,
            device: getString(body, 'device') || operator.device,
            ip: getString(body, 'ip') || operator.ip,
            userAgent: getString(body, 'userAgent'),
            location: getString(body, 'location'),
            token: getString(body, 'token') || undefined,
        });
        return ok({ session });
    }
    catch (error) {
        return errorResponse(error, 'Register session failed.');
    }
}
export async function handleProtectionSessionRevokeRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const sessionId = getString(body, 'sessionId');
        const reason = getString(body, 'reason', 'Revoked by owner.');
        if (!sessionId)
            return badRequest('Missing sessionId.', 400);
        const session = await revokeSession({
            sessionId, revokedBy: operator.operatorId, reason,
        });
        return ok({ session });
    }
    catch (error) {
        return errorResponse(error, 'Revoke session failed.');
    }
}
// ---------------------------------------------------------------------------
// Investments
// ---------------------------------------------------------------------------
export async function handleProtectionInvestmentsListRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId') ?? undefined;
        const investmentType = url.searchParams.get('type') ?? undefined;
        const status = url.searchParams.get('status') ?? undefined;
        const investments = await listInvestments({
            userId,
            investmentType: investmentType && VALID_INVESTMENT_TYPES.has(investmentType) ? investmentType : undefined,
            status: status,
        });
        return ok({ investments, count: investments.length });
    }
    catch (error) {
        return errorResponse(error, 'List investments failed.');
    }
}
export async function handleProtectionInvestmentCreateRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        const investmentType = getString(body, 'investmentType');
        const name = getString(body, 'name');
        const amountInvested = getNumber(body, 'amountInvested', 0);
        if (!userId)
            return badRequest('Missing userId.', 400);
        if (!VALID_INVESTMENT_TYPES.has(investmentType))
            return badRequest(`Invalid investmentType: ${investmentType}`, 400);
        if (!name)
            return badRequest('Missing name.', 400);
        if (amountInvested < 0)
            return badRequest('amountInvested cannot be negative.', 400);
        const investment = await createInvestment({
            userId,
            accountId: getString(body, 'accountId') || undefined,
            investmentType,
            propertyId: getString(body, 'propertyId') || undefined,
            dealId: getString(body, 'dealId') || undefined,
            name,
            amountInvested,
            ownershipPercentage: getNumber(body, 'ownershipPercentage', 0),
            currentValuation: getNumber(body, 'currentValuation', 0),
            tokenBalance: getNumber(body, 'tokenBalance', 0),
            documents: Array.isArray(body.documents) ? body.documents : undefined,
            signatures: Array.isArray(body.signatures) ? body.signatures : undefined,
            metadata: body.metadata,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ investment });
    }
    catch (error) {
        return errorResponse(error, 'Create investment failed.');
    }
}
export async function handleProtectionInvestmentValuationRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const investmentId = getString(body, 'investmentId');
        const currentValuation = getNumber(body, 'currentValuation', 0);
        const reason = getString(body, 'reason');
        if (!investmentId)
            return badRequest('Missing investmentId.', 400);
        if (!reason)
            return badRequest('Missing reason.', 400);
        const investment = await updateInvestmentValuation({
            investmentId,
            currentValuation,
            profitDistributed: typeof body.profitDistributed === 'number' ? getNumber(body, 'profitDistributed', 0) : undefined,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            reason,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ investment });
    }
    catch (error) {
        return errorResponse(error, 'Valuation update failed.');
    }
}
// ---------------------------------------------------------------------------
// Withdrawals + wires
// ---------------------------------------------------------------------------
export async function handleProtectionWithdrawalsListRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId') ?? undefined;
        const status = url.searchParams.get('status') ?? undefined;
        const withdrawals = await listWithdrawals({
            userId,
            status: status && VALID_WITHDRAWAL_STATUSES.has(status) ? status : undefined,
        });
        return ok({ withdrawals, count: withdrawals.length });
    }
    catch (error) {
        return errorResponse(error, 'List withdrawals failed.');
    }
}
export async function handleProtectionWithdrawalCreateRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        const amount = getNumber(body, 'amount', 0);
        const availableBalance = getNumber(body, 'availableBalance', 0);
        if (!userId)
            return badRequest('Missing userId.', 400);
        if (amount <= 0)
            return badRequest('amount must be positive.', 400);
        const withdrawal = await createWithdrawal({
            userId,
            accountId: getString(body, 'accountId') || undefined,
            amount,
            currency: getString(body, 'currency', 'USD'),
            availableBalance,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ withdrawal });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Create withdrawal failed.';
        return badRequest(message, message.toLowerCase().includes('insufficient') ? 422 : 500);
    }
}
export async function handleProtectionWithdrawalTransitionRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const withdrawalId = getString(body, 'withdrawalId');
        const toStatus = getString(body, 'toStatus');
        const reason = getString(body, 'reason');
        if (!withdrawalId)
            return badRequest('Missing withdrawalId.', 400);
        if (!VALID_WITHDRAWAL_STATUSES.has(toStatus))
            return badRequest(`Invalid toStatus: ${toStatus}`, 400);
        const withdrawal = await transitionWithdrawal({
            withdrawalId,
            toStatus,
            reason,
            complianceDecision: getString(body, 'complianceDecision') || undefined,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ withdrawal });
    }
    catch (error) {
        return errorResponse(error, 'Withdrawal transition failed.');
    }
}
export async function handleProtectionWiresListRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId') ?? undefined;
        const status = url.searchParams.get('status') ?? undefined;
        const wires = await listWires({
            userId,
            status: status,
        });
        return ok({ wires, count: wires.length });
    }
    catch (error) {
        return errorResponse(error, 'List wires failed.');
    }
}
export async function handleProtectionWireCreateRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        const bankName = getString(body, 'bankName');
        const accountHolder = getString(body, 'accountHolder');
        const routing = getString(body, 'routing');
        const accountNumber = getString(body, 'accountNumber');
        if (!userId)
            return badRequest('Missing userId.', 400);
        if (!bankName || !accountHolder || !routing || !accountNumber) {
            return badRequest('Missing required wire fields (bankName, accountHolder, routing, accountNumber).', 400);
        }
        const wire = await createWire({
            userId,
            withdrawalId: getString(body, 'withdrawalId') || undefined,
            bankName,
            accountHolder,
            routing,
            accountNumber,
            swift: getString(body, 'swift') || undefined,
            iban: getString(body, 'iban') || undefined,
            isInternational: getBool(body, 'isInternational', Boolean(getString(body, 'iban'))),
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ wire });
    }
    catch (error) {
        return errorResponse(error, 'Create wire failed.');
    }
}
export async function handleProtectionWireTransitionRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const wireId = getString(body, 'wireId');
        const toStatus = getString(body, 'toStatus');
        const reason = getString(body, 'reason');
        if (!wireId)
            return badRequest('Missing wireId.', 400);
        if (!['pending', 'initiated', 'confirmed', 'failed', 'reversed'].includes(toStatus)) {
            return badRequest(`Invalid toStatus: ${toStatus}`, 400);
        }
        const wire = await transitionWire({
            wireId,
            toStatus,
            reason,
            operatorId: operator.operatorId,
            operatorEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ wire });
    }
    catch (error) {
        return errorResponse(error, 'Wire transition failed.');
    }
}
export async function handleProtectionWireQueueRequest(request) {
    try {
        await requireOwner(request);
        const queue = await wireQueue();
        return ok({ queue, count: queue.length });
    }
    catch (error) {
        return errorResponse(error, 'Wire queue failed.');
    }
}
// ---------------------------------------------------------------------------
// Compliance + wallet + reports
// ---------------------------------------------------------------------------
export async function handleProtectionComplianceListRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId');
        if (userId) {
            const record = await getCompliance(userId);
            return ok({ record });
        }
        const records = await listCompliance();
        return ok({ records, count: records.length });
    }
    catch (error) {
        return errorResponse(error, 'List compliance failed.');
    }
}
export async function handleProtectionComplianceUpsertRequest(request) {
    try {
        const operator = await requireOwner(request);
        const body = await readJsonBody(request);
        const userId = getString(body, 'userId');
        if (!userId)
            return badRequest('Missing userId.', 400);
        const record = await upsertCompliance({
            userId,
            kycStatus: (getString(body, 'kycStatus') || undefined),
            amlStatus: (getString(body, 'amlStatus') || undefined),
            amlReviewedBy: getString(body, 'amlReviewedBy') || undefined,
            accreditedInvestorStatus: (getString(body, 'accreditedInvestorStatus') || undefined),
            identityVerified: typeof body.identityVerified === 'boolean' ? getBool(body, 'identityVerified') : undefined,
            documents: Array.isArray(body.documents) ? body.documents : undefined,
            riskFlags: Array.isArray(body.riskFlags) ? body.riskFlags : undefined,
            notes: getString(body, 'notes') || undefined,
            updatedBy: operator.operatorId,
            updatedByEmail: operator.operatorEmail,
            ip: operator.ip,
            device: operator.device,
        });
        return ok({ record });
    }
    catch (error) {
        return errorResponse(error, 'Compliance upsert failed.');
    }
}
export async function handleProtectionWalletRequest(request) {
    try {
        await requireOwner(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId') ?? '';
        if (!userId)
            return badRequest('Missing userId.', 400);
        const summary = await getInvestorWalletSummary(userId, null);
        return ok({ wallet: summary });
    }
    catch (error) {
        return errorResponse(error, 'Wallet summary failed.');
    }
}
export async function handleProtectionReportsRequest(request) {
    try {
        const operator = await requireOwner(request);
        const url = new URL(request.url);
        const reportType = url.searchParams.get('type') ?? 'owner_summary';
        const report = await generateOwnerReport(reportType, operator.operatorId);
        return ok({ report });
    }
    catch (error) {
        return errorResponse(error, 'Report failed.');
    }
}
