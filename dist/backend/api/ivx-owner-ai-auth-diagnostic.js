/**
 * Owner AI auth diagnostic — reveals the exact reason a bearer is rejected.
 *
 * GET  /api/ivx/owner-ai/auth-diagnostic        → backend env probe (no token needed)
 * POST /api/ivx/owner-ai/auth-diagnostic        → decode the bearer (NOT verify),
 *                                                  call supabase.auth.getUser(token),
 *                                                  and return granular diagnosis.
 *
 * NEVER returns secrets, anon key, service-role key, or the raw token. Returns:
 *  - JWT header.alg, payload.iss, aud, sub, role, exp, iat (claims only)
 *  - whether the token issuer matches the backend's EXPO_PUBLIC_SUPABASE_URL
 *  - whether the token is expired vs server clock
 *  - the raw Supabase auth.getUser() error message (which is what the guard sees)
 *  - a single rootCause string the owner can act on
 */
import { ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getIVXOwnerEmailAllowlist, resolveIVXSupabaseAnonKey, resolveIVXSupabaseUrl, } from '../../expo/shared/ivx/access-control';
function maskDiagnosticEmail(email) {
    if (!email)
        return null;
    const [local = '', domain = ''] = email.split('@');
    if (!local || !domain)
        return '***';
    const visibleLocal = local.length <= 2 ? `${local.slice(0, 1)}*` : `${local.slice(0, 2)}***${local.slice(-1)}`;
    return `${visibleLocal}@${domain}`;
}
function readEnv(name) {
    return (process.env[name] ?? '').trim();
}
function readBearer(request) {
    const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
    if (!header)
        return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer')
        return null;
    return (token ?? '').trim() || null;
}
function decodeBase64Url(input) {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
    return Buffer.from(padded, 'base64').toString('utf8');
}
function decodeJwtClaims(token) {
    const parts = token.split('.');
    if (parts.length !== 3) {
        return { ok: false, error: `Token is not a JWT (expected 3 dot-separated parts, got ${parts.length}).` };
    }
    try {
        const headerJson = JSON.parse(decodeBase64Url(parts[0]));
        const payloadJson = JSON.parse(decodeBase64Url(parts[1]));
        const exp = typeof payloadJson.exp === 'number' ? payloadJson.exp : null;
        const iat = typeof payloadJson.iat === 'number' ? payloadJson.iat : null;
        return {
            ok: true,
            claims: {
                alg: typeof headerJson.alg === 'string' ? headerJson.alg : null,
                iss: typeof payloadJson.iss === 'string' ? payloadJson.iss : null,
                aud: typeof payloadJson.aud === 'string' ? payloadJson.aud : null,
                sub: typeof payloadJson.sub === 'string' ? payloadJson.sub : null,
                role: typeof payloadJson.role === 'string' ? payloadJson.role : null,
                email: typeof payloadJson.email === 'string' ? payloadJson.email : null,
                exp,
                iat,
                expIso: exp ? new Date(exp * 1000).toISOString() : null,
                iatIso: iat ? new Date(iat * 1000).toISOString() : null,
            },
        };
    }
    catch (error) {
        return { ok: false, error: `JWT decode failed: ${error instanceof Error ? error.message : 'unknown'}` };
    }
}
function deriveExpectedIssuer(supabaseUrl) {
    return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}
function backendEnvSnapshot() {
    const rawSupabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL');
    const rawAnonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    const supabaseUrl = resolveIVXSupabaseUrl();
    const anonKey = resolveIVXSupabaseAnonKey();
    const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
    return {
        supabaseUrlPresent: supabaseUrl.length > 0,
        supabaseUrlRawPresent: rawSupabaseUrl.length > 0,
        supabaseUrlSanitized: rawSupabaseUrl !== supabaseUrl,
        supabaseUrl: supabaseUrl || null,
        expectedTokenIssuer: supabaseUrl ? deriveExpectedIssuer(supabaseUrl) : null,
        supabaseProjectRef: supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : null,
        anonKeyPresent: anonKey.length > 0,
        anonKeyRawPresent: rawAnonKey.length > 0,
        anonKeySanitized: rawAnonKey !== anonKey,
        anonKeyLength: anonKey.length || null,
        serviceRoleKeyPresent: serviceKey.length > 0,
        serviceRoleKeyLength: serviceKey.length || null,
        serverTimeIso: new Date().toISOString(),
        serverTimeEpoch: Math.floor(Date.now() / 1000),
        nodeEnv: readEnv('NODE_ENV') || null,
        deploymentMarker: 'ivx-owner-ai-auth-diagnostic-2026-07-04-sanitized',
    };
}
export function ivxOwnerAIAuthDiagnosticOptions() {
    return ownerOnlyOptions();
}
export function handleIVXOwnerAIAuthDiagnosticGet() {
    return ownerOnlyJson({ ok: true, backend: backendEnvSnapshot(), usage: 'POST with Authorization: Bearer <token> to diagnose a specific token.' });
}
export async function handleIVXOwnerAIAuthDiagnosticPost(request) {
    const env = backendEnvSnapshot();
    const token = readBearer(request);
    if (!token) {
        return ownerOnlyJson({
            ok: false,
            backend: env,
            tokenPresent: false,
            rootCause: 'No bearer token sent in Authorization header.',
        }, 400);
    }
    const decoded = decodeJwtClaims(token);
    if (!decoded.ok) {
        return ownerOnlyJson({
            ok: false,
            backend: env,
            tokenPresent: true,
            tokenLength: token.length,
            decode: { ok: false, error: decoded.error },
            rootCause: 'Frontend sent an Authorization header that is not a valid JWT (likely the dev "dev-open-access-token" or an empty/malformed value).',
        }, 200);
    }
    const supabaseUrl = resolveIVXSupabaseUrl();
    const anonKey = resolveIVXSupabaseAnonKey();
    const expectedIssuer = supabaseUrl ? deriveExpectedIssuer(supabaseUrl) : null;
    const issuerMatches = Boolean(expectedIssuer && decoded.claims.iss && decoded.claims.iss === expectedIssuer);
    const nowEpoch = Math.floor(Date.now() / 1000);
    const isExpired = typeof decoded.claims.exp === 'number' && decoded.claims.exp <= nowEpoch;
    const secondsUntilExpiry = typeof decoded.claims.exp === 'number' ? decoded.claims.exp - nowEpoch : null;
    let supabaseLookup = { attempted: false };
    if (supabaseUrl) {
        if (anonKey) {
            try {
                const { createClient } = await import('@supabase/supabase-js');
                const client = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
                const result = await client.auth.getUser(token);
                supabaseLookup = {
                    attempted: true,
                    userFound: Boolean(result.data?.user),
                    userIdMatchesSub: Boolean(result.data?.user && result.data.user.id === decoded.claims.sub),
                    userEmail: result.data?.user?.email ?? null,
                    errorMessage: result.error?.message ?? null,
                    errorStatus: result.error?.status ?? null,
                };
            }
            catch (error) {
                supabaseLookup = { attempted: true, threw: true, errorMessage: error instanceof Error ? error.message : 'unknown' };
            }
        }
        else {
            supabaseLookup = { attempted: false, reason: 'Backend has no EXPO_PUBLIC_SUPABASE_ANON_KEY configured (even fallback failed).' };
        }
    }
    else {
        supabaseLookup = { attempted: false, reason: 'Backend has no EXPO_PUBLIC_SUPABASE_URL configured (even fallback failed).' };
    }
    // Owner allowlist evaluation (check #3). The real owner guard
    // (resolveIVXAuthenticatedRequest) accepts a valid Supabase session ONLY when
    // the authenticated email is in the owner allowlist (or the profile/metadata
    // role is privileged). A getUser-success email that is NOT allowlisted is the
    // exact branch that turns a valid session into owner_route_auth_401 — and the
    // diagnostic previously never checked it, so it could report ok while the real
    // route still rejected. We evaluate it here so the failing branch is named.
    const allowlist = getIVXOwnerEmailAllowlist();
    const allowlistConfigured = allowlist.length > 0;
    const authenticatedEmail = ((typeof supabaseLookup.userEmail === 'string' ? supabaseLookup.userEmail : null)
        ?? decoded.claims.email
        ?? null);
    const normalizedEmail = authenticatedEmail ? authenticatedEmail.trim().toLowerCase() : null;
    const supabaseAcceptedToken = supabaseLookup.attempted === true && supabaseLookup.userFound === true;
    const emailAllowlisted = Boolean(normalizedEmail && allowlistConfigured && allowlist.includes(normalizedEmail));
    const ownerAllowlist = {
        authenticatedEmailMasked: maskDiagnosticEmail(authenticatedEmail),
        allowlistConfigured,
        allowlistCount: allowlist.length || null,
        emailAllowlisted,
    };
    let rootCause = 'Token decodes and is not expired; Supabase did not reject. If the main /api/ivx/owner-ai endpoint still 401s with this same token, the failure is downstream of auth.getUser.';
    if (!issuerMatches) {
        rootCause = `Token issuer mismatch: token was issued by "${decoded.claims.iss ?? 'unknown'}" but the backend Supabase project is "${expectedIssuer ?? 'unconfigured'}". Frontend and backend are pointing at DIFFERENT Supabase projects. Fix: align EXPO_PUBLIC_SUPABASE_URL between the Expo app and the Render backend.`;
    }
    else if (isExpired) {
        rootCause = `Token expired at ${decoded.claims.expIso} (server time ${env.serverTimeIso}). Frontend's session refresh did not produce a fresh token before sending. Sign out + sign back in, or force a refresh.`;
    }
    else if (supabaseLookup.attempted && supabaseLookup.userFound === false) {
        rootCause = `Supabase auth.getUser() rejected the token: "${supabaseLookup.errorMessage ?? 'no user'}". Token's issuer matches the backend project, but the user/session is not valid for it (revoked, signed-out, or wrong JWT secret).`;
    }
    else if (supabaseAcceptedToken && !allowlistConfigured) {
        rootCause = 'Supabase accepted the session, but IVX_OWNER_REGISTRATION_EMAILS is not configured on the backend — no email can be promoted to owner, so the owner route returns 401/403. Fix: set IVX_OWNER_REGISTRATION_EMAILS on the Render backend to the owner email.';
    }
    else if (supabaseAcceptedToken && !emailAllowlisted) {
        rootCause = `Supabase accepted the session for ${maskDiagnosticEmail(authenticatedEmail) ?? 'this user'}, but that email is NOT in the owner allowlist (IVX_OWNER_REGISTRATION_EMAILS). The owner guard cannot promote it to owner, so /api/ivx/owner-ai returns 401/403 and the chat falls back. Fix: add this email to IVX_OWNER_REGISTRATION_EMAILS on the Render backend, or sign in with an allowlisted owner email.`;
    }
    return ownerOnlyJson({
        ok: !isExpired && issuerMatches && supabaseAcceptedToken && emailAllowlisted,
        backend: env,
        tokenPresent: true,
        tokenLength: token.length,
        claims: decoded.claims,
        checks: {
            issuerMatchesBackendProject: issuerMatches,
            expectedIssuer,
            tokenExpired: isExpired,
            secondsUntilExpiry,
            supabaseSessionValid: supabaseAcceptedToken,
            ownerEmailAllowlisted: emailAllowlisted,
        },
        supabaseLookup,
        ownerAllowlist,
        rootCause,
    });
}
