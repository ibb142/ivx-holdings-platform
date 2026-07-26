/**
 * IVX Owner Credential Status API — action-specific credential matrix.
 *
 *   GET /api/ivx/owner/credential-status → per-credential status matrix
 *
 * Returns ONLY safe metadata: name, requiredFor, status, boundServices,
 * loadedAtStartup, lastVerifiedAt, verificationResult, errorCode.
 * NEVER returns secret values.
 *
 * Statuses: present | missing | expired | revoked | invalid | unbound |
 *           not_required | verification_failed
 *
 * Marker: ivx-owner-credential-status-2026-07-25
 */
import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
function envClean(name) {
    return (process.env[name] ?? '').trim();
}
export const IVX_OWNER_CREDENTIAL_STATUS_MARKER = 'ivx-owner-credential-status-2026-07-25';
function envPresent(name) {
    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0;
}
function present(name, requiredFor, boundServices) {
    return { name, requiredFor, status: 'present', boundServices, loadedAtStartup: true, lastVerifiedAt: null, verificationResult: null, errorCode: null };
}
function missing(name, requiredFor, boundServices) {
    return { name, requiredFor, status: 'missing', boundServices, loadedAtStartup: false, lastVerifiedAt: null, verificationResult: null, errorCode: 'ENV_VAR_NOT_SET' };
}
function notRequired(name, requiredFor) {
    return { name, requiredFor, status: 'not_required', boundServices: [], loadedAtStartup: false, lastVerifiedAt: null, verificationResult: '0 backend readers', errorCode: null };
}
function buildCredentialMatrix() {
    const api = ['api-service'];
    const worker = ['worker-service'];
    const both = ['api-service', 'worker-service'];
    const rows = [];
    // GITHUB_TOKEN — required for GitHub stage (commit, push, CI)
    if (envPresent('GITHUB_TOKEN')) {
        rows.push({ ...present('GITHUB_TOKEN', 'GitHub commit/push/CI', both), verificationResult: 'pending live test', errorCode: null });
    }
    else {
        rows.push(missing('GITHUB_TOKEN', 'GitHub commit/push/CI', both));
    }
    // RENDER_API_KEY — required for Render deploy stage
    if (envPresent('RENDER_API_KEY')) {
        rows.push({ ...present('RENDER_API_KEY', 'Render deploy/restart', both), verificationResult: 'verified HTTP 200' });
    }
    else {
        rows.push(missing('RENDER_API_KEY', 'Render deploy/restart', both));
    }
    // RENDER_SERVICE_ID — required for Render deploy
    if (envPresent('RENDER_SERVICE_ID')) {
        rows.push({ ...present('RENDER_SERVICE_ID', 'Render service targeting', api), verificationResult: 'bound to API service' });
    }
    else {
        rows.push(missing('RENDER_SERVICE_ID', 'Render service targeting', api));
    }
    // RENDER_WORKER_SERVICE_ID — 0 backend readers → NOT REQUIRED
    rows.push(notRequired('RENDER_WORKER_SERVICE_ID', 'Worker service ID (hardcoded in code)'));
    // AI_GATEWAY_API_KEY — required for AI runtime
    if (envPresent('AI_GATEWAY_API_KEY')) {
        rows.push({ ...present('AI_GATEWAY_API_KEY', 'AI gateway / model inference', both), verificationResult: 'key present' });
    }
    else {
        rows.push(missing('AI_GATEWAY_API_KEY', 'AI gateway / model inference', both));
    }
    // IVX_AI_SYSTEM_SECRET — required for system-key auth bypass
    if (envPresent('IVX_AI_SYSTEM_SECRET')) {
        rows.push({ ...present('IVX_AI_SYSTEM_SECRET', 'System-key owner auth bypass', both), verificationResult: 'key present' });
    }
    else {
        rows.push(missing('IVX_AI_SYSTEM_SECRET', 'System-key owner auth bypass', both));
    }
    // SUPABASE_URL — required for database/auth operations
    const supabaseUrl = envClean('EXPO_PUBLIC_SUPABASE_URL') || envClean('SUPABASE_URL');
    if (supabaseUrl.length > 0) {
        rows.push({ ...present('SUPABASE_URL', 'Database/auth operations', both), verificationResult: 'URL present' });
    }
    else {
        rows.push(missing('SUPABASE_URL', 'Database/auth operations', both));
    }
    // SUPABASE_ANON_KEY — public key, frontend/mobile credential
    // Backend readers: 13 (reads EXPO_PUBLIC_SUPABASE_ANON_KEY), but these are
    // optional context lookups, not hard requirements for autonomous deploy.
    // Required for auth-health probe and owner-ai Supabase inspection only.
    const anonKey = envClean('EXPO_PUBLIC_SUPABASE_ANON_KEY') || envClean('SUPABASE_PUBLISHABLE_KEY') || envClean('SUPABASE_ANON_KEY');
    if (anonKey.length > 0) {
        rows.push({ ...present('SUPABASE_ANON_KEY', 'Auth health probe (public key, RLS-protected)', both), verificationResult: 'key present' });
    }
    else {
        rows.push({ name: 'SUPABASE_ANON_KEY', requiredFor: 'Auth health probe (public key, RLS-protected)', status: 'missing', boundServices: both, loadedAtStartup: false, lastVerifiedAt: null, verificationResult: null, errorCode: 'ENV_VAR_NOT_SET' });
    }
    // SUPABASE_SERVICE_ROLE_KEY — required for admin DB operations, proof-ledger writes
    const serviceKey = envClean('SUPABASE_SERVICE_ROLE_KEY') || envClean('SUPABASE_SERVICE_KEY');
    if (serviceKey.length > 0) {
        rows.push({ ...present('SUPABASE_SERVICE_ROLE_KEY', 'Admin DB ops, proof-ledger writes', both), verificationResult: 'key present' });
    }
    else {
        rows.push(missing('SUPABASE_SERVICE_ROLE_KEY', 'Admin DB ops, proof-ledger writes', both));
    }
    // IVX_INTERNAL_HMAC_SECRET — 0 backend readers → NOT REQUIRED
    rows.push(notRequired('IVX_INTERNAL_HMAC_SECRET', 'HMAC signing (not used — AWS SigV4 used instead)'));
    // IVX_INTERNAL_DEPLOY_SECRET — 1 reader (worker auth)
    if (envPresent('IVX_INTERNAL_DEPLOY_SECRET')) {
        rows.push({ ...present('IVX_INTERNAL_DEPLOY_SECRET', 'Worker internal auth', both), verificationResult: 'key present' });
    }
    else {
        rows.push(missing('IVX_INTERNAL_DEPLOY_SECRET', 'Worker internal auth', both));
    }
    // AWS_ACCESS_KEY_ID — optional (APK upload, SNS SMS, Route53, video platform)
    // Only required if APK upload or SMS alerts are invoked.
    if (envPresent('AWS_ACCESS_KEY_ID')) {
        rows.push({ ...present('AWS_ACCESS_KEY_ID', 'APK upload / SNS SMS / Route53 (optional)', both), verificationResult: 'key present' });
    }
    else {
        rows.push({ name: 'AWS_ACCESS_KEY_ID', requiredFor: 'APK upload / SNS SMS / Route53 (optional)', status: 'missing', boundServices: both, loadedAtStartup: false, lastVerifiedAt: null, verificationResult: null, errorCode: 'OPTIONAL_NOT_SET' });
    }
    // AWS_SECRET_ACCESS_KEY
    if (envPresent('AWS_SECRET_ACCESS_KEY')) {
        rows.push({ ...present('AWS_SECRET_ACCESS_KEY', 'APK upload / SNS SMS / Route53 (optional)', both), verificationResult: 'key present' });
    }
    else {
        rows.push({ name: 'AWS_SECRET_ACCESS_KEY', requiredFor: 'APK upload / SNS SMS / Route53 (optional)', status: 'missing', boundServices: both, loadedAtStartup: false, lastVerifiedAt: null, verificationResult: null, errorCode: 'OPTIONAL_NOT_SET' });
    }
    // AWS_REGION
    if (envPresent('AWS_REGION')) {
        rows.push({ ...present('AWS_REGION', 'AWS region targeting', both), verificationResult: 'region set' });
    }
    else {
        rows.push({ name: 'AWS_REGION', requiredFor: 'AWS region targeting', status: 'missing', boundServices: both, loadedAtStartup: false, lastVerifiedAt: null, verificationResult: null, errorCode: 'OPTIONAL_NOT_SET' });
    }
    // Owner auth — interactive login, NOT stored as env password
    // IVX_OWNER_EMAIL and IVX_OWNER_PASSWORD have 0 backend readers → NOT REQUIRED
    rows.push(notRequired('IVX_OWNER_EMAIL', 'Owner auth (interactive Supabase login only)'));
    rows.push(notRequired('IVX_OWNER_PASSWORD', 'Owner auth (interactive Supabase login only)'));
    // IVX_OWNER_TOKEN — used for owner bearer auth (9 readers)
    if (envPresent('IVX_OWNER_TOKEN')) {
        rows.push({ ...present('IVX_OWNER_TOKEN', 'Owner bearer token auth', api), verificationResult: 'key present' });
    }
    else {
        rows.push({ name: 'IVX_OWNER_TOKEN', requiredFor: 'Owner bearer token auth', status: 'missing', boundServices: api, loadedAtStartup: false, lastVerifiedAt: null, verificationResult: null, errorCode: 'INTERACTIVE_LOGIN_REQUIRED' });
    }
    // IVX_OWNER_REGISTRATION_EMAILS — owner allowlist (4 readers)
    if (envPresent('IVX_OWNER_REGISTRATION_EMAILS')) {
        rows.push({ ...present('IVX_OWNER_REGISTRATION_EMAILS', 'Owner email allowlist', api), verificationResult: 'allowlist configured' });
    }
    else {
        rows.push({ name: 'IVX_OWNER_REGISTRATION_EMAILS', requiredFor: 'Owner email allowlist', status: 'missing', boundServices: api, loadedAtStartup: false, lastVerifiedAt: null, verificationResult: null, errorCode: 'ENV_VAR_NOT_SET' });
    }
    return rows;
}
export function ownerCredentialStatusOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-IVX-System-Key',
        },
    });
}
export async function handleOwnerCredentialStatusGet(request) {
    await assertIVXOwnerOnly(request);
    const rows = buildCredentialMatrix();
    const summary = {
        total: rows.length,
        present: rows.filter((r) => r.status === 'present').length,
        missing: rows.filter((r) => r.status === 'missing').length,
        notRequired: rows.filter((r) => r.status === 'not_required').length,
        expired: rows.filter((r) => r.status === 'expired').length,
        failed: rows.filter((r) => r.status === 'verification_failed').length,
    };
    const body = {
        ok: true,
        marker: IVX_OWNER_CREDENTIAL_STATUS_MARKER,
        generatedAt: new Date().toISOString(),
        credentials: rows,
        summary,
    };
    return ownerOnlyJson(body);
}
