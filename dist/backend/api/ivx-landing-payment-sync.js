/**
 * IVX Landing Payment Sync API
 *
 * POST /api/ivx/payments/landing-intent
 *   Creates a real payment transaction from a landing-page investment intent.
 *
 * POST /api/ivx/payments/landing-confirm
 *   Owner/admin confirmation that real funds were received.
 */
import { createLandingPaymentTransaction, confirmLandingPaymentTransaction, } from '../services/ivx-landing-payment-sync';
function getString(body, key) {
    const value = body[key];
    if (typeof value === 'string')
        return value;
    return undefined;
}
function getNumber(body, key) {
    const value = body[key];
    if (typeof value === 'number')
        return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    return undefined;
}
function getBoolean(body, key) {
    const value = body[key];
    if (typeof value === 'boolean')
        return value;
    if (value === 'true' || value === '1')
        return true;
    return false;
}
function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
function corsOptionsResponse() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://ivxholding.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json',
    };
}
export async function handleLandingPaymentOptionsRequest() {
    return corsOptionsResponse();
}
export async function handleLandingPaymentCreateRequest(request) {
    if (request.method === 'OPTIONS')
        return handleLandingPaymentOptionsRequest();
    try {
        const body = (await request.json());
        const dealId = getString(body, 'dealId');
        const dealTitle = getString(body, 'dealTitle') || 'Untitled Deal';
        const investmentType = getString(body, 'investmentType') || 'jv_direct';
        const amount = getNumber(body, 'amount');
        const expectedRoi = getNumber(body, 'expectedRoi') ?? getNumber(body, 'expected_roi') ?? 0;
        const ownershipPct = getNumber(body, 'ownershipPct') ?? getNumber(body, 'ownership_pct') ?? 0;
        const paymentMethod = getString(body, 'paymentMethod') || 'bank';
        const investorEmail = getString(body, 'investorEmail');
        const investorId = getString(body, 'investorId') || null;
        const investorName = getString(body, 'investorName') || '';
        const termsAccepted = getBoolean(body, 'termsAccepted');
        const source = getString(body, 'source') || 'landing_page';
        if (!dealId)
            return jsonResponse({ ok: false, error: 'Missing dealId.' }, 400);
        if (amount === undefined || amount <= 0) {
            return jsonResponse({ ok: false, error: 'Missing or invalid amount.' }, 400);
        }
        if (!investorEmail) {
            return jsonResponse({ ok: false, error: 'Missing investorEmail.' }, 400);
        }
        const input = {
            dealId,
            dealTitle,
            investmentType,
            amount,
            expectedRoi,
            ownershipPct,
            paymentMethod,
            investorEmail,
            investorId,
            investorName,
            termsAccepted,
            source,
            ip: request.headers.get('x-forwarded-for') || request.headers.get('cf-connecting-ip') || '',
            userAgent: request.headers.get('user-agent') || '',
        };
        const result = await createLandingPaymentTransaction(input);
        return jsonResponse({
            ok: result.success,
            transactionId: result.transactionId,
            landingInvestmentId: result.landingInvestmentId,
            intentId: result.intentId,
            status: result.status,
            message: result.message,
            providerConfigured: result.providerConfigured,
            providerMode: result.providerMode,
            auditLogged: result.auditLogged,
            error: result.error,
        }, result.success ? 200 : 500);
    }
    catch (err) {
        return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Request processing failed.' }, 500);
    }
}
export async function handleLandingPaymentConfirmRequest(request) {
    if (request.method === 'OPTIONS')
        return handleLandingPaymentOptionsRequest();
    try {
        const body = (await request.json());
        const transactionId = getString(body, 'transactionId');
        const confirmedBy = getString(body, 'confirmedBy') || 'owner';
        const confirmationMethod = getString(body, 'confirmationMethod') || 'wire_receipt';
        const notes = getString(body, 'notes') || '';
        if (!transactionId) {
            return jsonResponse({ ok: false, error: 'Missing transactionId.' }, 400);
        }
        const result = await confirmLandingPaymentTransaction(transactionId, confirmedBy, confirmationMethod, notes);
        return jsonResponse({ ok: result.success, error: result.error }, result.success ? 200 : 400);
    }
    catch (err) {
        return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Confirmation failed.' }, 500);
    }
}
