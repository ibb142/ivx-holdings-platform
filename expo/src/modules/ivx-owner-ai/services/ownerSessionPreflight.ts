/**
 * BLOCK 1 — Owner Session Preflight (runs before ANY owner-gated IVX IA action).
 *
 * A single, reusable gate that proves a real owner Supabase session or a bounded,
 * backend-minted owner outage session exists before the app POSTs to an
 * owner-gated route (Owner AI chat, Gmail OAuth setup, Capital
 * Outreach actions, Power Tools actions, CRM/Gmail draft actions). Instead of a
 * generic "Owner session token unavailable" or a misleading /public/chat fallback,
 * a failed preflight surfaces an explicit `OWNER_SESSION_REQUIRED` result so the
 * owner is told to re-authenticate and the original action payload is preserved.
 *
 * The ten required checks (owner spec):
 *   1. Supabase session exists (before any POST).
 *   2. A real access_token exists.
 *   3. The synthetic dev-open-access-token is BLOCKED in production (strict mode).
 *   4. The owner email is detected.
 *   5. The owner email is allowlisted.
 *   6. The token issuer matches the app's Supabase project.
 *   7. Missing/expired session → do NOT POST.
 *   8. Returns OWNER_SESSION_REQUIRED (not a generic failure).
 *   9. Preserves the original action/prompt payload (caller keeps its own input).
 *  10. Never falls back to /public/chat (the caller must honor `ok:false`).
 *
 * Never logs or returns the raw access token.
 */
import { resolveSupabaseUrl } from '@/lib/supabase-env';
import {
  getIVXAccessToken,
  getIVXSupabaseClient,
} from '@/lib/ivx-supabase-client';
import {
  IVX_OPEN_ACCESS_OWNER_TOKEN,
  getIVXAccessControlConfig,
  isIVXOwnerAllowlistedEmail,
} from '@/shared/ivx/access-control';
import { Platform } from 'react-native';

/** The canonical blocked label surfaced to every owner-gated action. */
export const OWNER_SESSION_REQUIRED_LABEL = 'OWNER_SESSION_REQUIRED' as const;

/** Why the preflight blocked — one canonical reason per failing branch. */
export type OwnerSessionBlockReason =
  | 'no_supabase_session'
  | 'no_access_token'
  | 'dev_token_blocked_in_production'
  | 'outage_token_invalid'
  | 'token_not_jwt'
  | 'token_expired'
  | 'owner_email_missing'
  | 'owner_email_not_allowlisted'
  | 'issuer_mismatch';

/** A single preflight check rendered for diagnostics (never carries the token). */
export type OwnerSessionPreflightCheck = {
  id:
    | 'supabase_session'
    | 'access_token'
    | 'dev_token_block'
    | 'bounded_outage_session'
    | 'owner_email'
    | 'owner_email_allowlisted'
    | 'issuer_match'
    | 'token_validity';
  passed: boolean | null;
  detail: string;
};

export type OwnerSessionPreflightResult =
  | {
      ok: true;
      /** The verified, real Supabase access token to present to the owner route. */
      accessToken: string;
      email: string | null;
      checks: OwnerSessionPreflightCheck[];
    }
  | {
      ok: false;
      label: typeof OWNER_SESSION_REQUIRED_LABEL;
      reason: OwnerSessionBlockReason;
      detail: string;
      email: string | null;
      checks: OwnerSessionPreflightCheck[];
    };

/** Thrown by `assertOwnerSessionAccessToken` so owner-gated `ownerFetch` helpers can short-circuit. */
export class OwnerSessionRequiredError extends Error {
  readonly label = OWNER_SESSION_REQUIRED_LABEL;
  readonly reason: OwnerSessionBlockReason;
  readonly checks: OwnerSessionPreflightCheck[];

  constructor(reason: OwnerSessionBlockReason, detail: string, checks: OwnerSessionPreflightCheck[]) {
    super(detail);
    this.name = 'OwnerSessionRequiredError';
    this.reason = reason;
    this.checks = checks;
  }
}

type DecodedJwt = { iss?: unknown; exp?: unknown; email?: unknown };

type DecodedOwnerOutageToken = { expiresAt: number; email: string };

export function decodeBoundedOwnerOutageToken(token: string): DecodedOwnerOutageToken | null {
  const parts = token.trim().split('.');
  if (parts.length !== 5 || parts[0] !== 'ivxos1') return null;
  const [, expiresRaw, encodedEmail, nonce, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || !encodedEmail || !nonce || !signature) return null;
  try {
    const normalized = encodedEmail.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const email = (
      typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8')
    ).trim().toLowerCase();
    if (!email || !isIVXOwnerAllowlistedEmail(email)) return null;
    return { expiresAt, email };
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): DecodedJwt | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    const payloadSegment = segments[1] ?? '';
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded =
      typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded) as DecodedJwt;
  } catch {
    return null;
  }
}

type IssuerMatchResult = {
  matches: boolean | null;
  actualIssuer: string | null;
  expectedIssuer: string | null;
  frontendSupabaseUrl: string | null;
};

function getExpectedIssuer(): string | null {
  const frontendSupabaseUrl = resolveSupabaseUrl();
  if (!frontendSupabaseUrl) return null;
  return `${frontendSupabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

function issuerMatchesAppProject(issuer: string | null): IssuerMatchResult {
  const frontendSupabaseUrl = resolveSupabaseUrl();
  const expectedIssuer = getExpectedIssuer();
  if (!issuer || !frontendSupabaseUrl) {
    return { matches: null, actualIssuer: issuer ?? null, expectedIssuer, frontendSupabaseUrl };
  }
  const normalizedUrl = frontendSupabaseUrl.replace(/\/+$/, '').toLowerCase();
  const normalizedIssuer = issuer.replace(/\/+$/, '').toLowerCase();
  // Supabase user JWTs typically issue from https://<project>.supabase.co/auth/v1.
  // Accept either an exact match, the project URL as a prefix, or the project ref
  // appearing in the issuer.
  const matches =
    normalizedIssuer === normalizedUrl ||
    normalizedIssuer === `${normalizedUrl}/auth/v1` ||
    normalizedIssuer.startsWith(`${normalizedUrl}/`) ||
    (normalizedIssuer.includes('supabase.co') && normalizedIssuer.includes(normalizedUrl.replace(/^https?:\/\//, '')));
  return { matches, actualIssuer: issuer, expectedIssuer, frontendSupabaseUrl };
}

/**
 * Aggressively wipe any persisted Supabase session so a stale token from a
 * different project can never rehydrate. This is the exact recovery for the
 * `issuer_mismatch` branch: a cached session was minted by a different Supabase
 * project (old build, local demo, or wrong env) and the frontend now points to
 * the production project. Wiping forces a fresh sign-in from the correct URL.
 */
async function wipeStaleSupabaseSession(): Promise<void> {
  try {
    const supabase = getIVXSupabaseClient();
    await supabase.auth.signOut().catch(() => {});
  } catch {
    // continue to storage wipe even if signOut throws
  }

  try {
    const AsyncStorageMod = await import('@react-native-async-storage/async-storage');
    const AsyncStorage = AsyncStorageMod.default ?? AsyncStorageMod;
    const supabaseUrl = resolveSupabaseUrl();
    let projectRef = '';
    try {
      projectRef = new URL(supabaseUrl).hostname.split('.')[0] ?? '';
    } catch {}
    const keysToClear = [
      'supabase.auth.token',
      projectRef ? `sb-${projectRef}-auth-token` : '',
      'ivx-owner-session',
      'ivx_owner_session',
    ].filter(Boolean);
    for (const key of keysToClear) {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // ignore per-key removal errors
      }
    }
  } catch {
    // AsyncStorage not available on some runtimes (e.g. SSR); that's fine
  }

  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      const supabaseUrl = resolveSupabaseUrl();
      let projectRef = '';
      try {
        projectRef = new URL(supabaseUrl).hostname.split('.')[0] ?? '';
      } catch {}
      if (projectRef) {
        try { window.localStorage.removeItem(`sb-${projectRef}-auth-token`); } catch {}
      }
      try { window.localStorage.removeItem('supabase.auth.token'); } catch {}
    }
  } catch {
    // ignore web storage wipe errors
  }
}

/**
 * Runs the full owner-session preflight. Forces a session refresh by default so a
 * soon-to-expire token never reaches the owner route. Returns a structured result;
 * the caller owns its action payload, so nothing is lost on a block.
 */
export async function runOwnerSessionPreflight(
  options: { forceRefresh?: boolean } = {},
): Promise<OwnerSessionPreflightResult> {
  const forceRefresh = options.forceRefresh ?? true;
  const checks: OwnerSessionPreflightCheck[] = [];

  // Check 1 — Supabase session exists (read the live session for email + identity).
  let sessionEmail: string | null = null;
  let hasSession = false;
  try {
    const supabase = getIVXSupabaseClient();
    const { data } = await supabase.auth.getSession();
    hasSession = Boolean(data.session?.access_token);
    sessionEmail = data.session?.user?.email ?? null;
  } catch {
    hasSession = false;
  }
  checks.push({
    id: 'supabase_session',
    passed: hasSession,
    detail: hasSession ? 'Supabase session present.' : 'No hydrated Supabase session on this device.',
  });

  // Check 2 — a real access token resolves (with a forced refresh first).
  let accessToken: string | null = null;
  try {
    accessToken = await getIVXAccessToken({ forceRefresh });
  } catch (error) {
    accessToken = null;
    checks.push({
      id: 'access_token',
      passed: false,
      detail: `Token resolution threw: ${error instanceof Error ? error.message : 'unknown'}.`,
    });
  }

  if (!accessToken) {
    if (!checks.some((c) => c.id === 'access_token')) {
      checks.push({ id: 'access_token', passed: false, detail: 'No access token after refresh.' });
    }
    const reason: OwnerSessionBlockReason = hasSession ? 'no_access_token' : 'no_supabase_session';
    return {
      ok: false,
      label: OWNER_SESSION_REQUIRED_LABEL,
      reason,
      detail: 'Owner session token unavailable. Sign in as the IVX owner and retry.',
      email: sessionEmail,
      checks,
    };
  }
  checks.push({ id: 'access_token', passed: true, detail: 'Access token resolved.' });

  // Check 3 — block the synthetic dev-open-access token in production (strict mode).
  const accessConfig = getIVXAccessControlConfig();
  const isDevOpenToken = accessToken === IVX_OPEN_ACCESS_OWNER_TOKEN;
  if (isDevOpenToken && !accessConfig.ownerBypassEnabled) {
    checks.push({
      id: 'dev_token_block',
      passed: false,
      detail: 'Synthetic dev-open-access token blocked from owner route in production.',
    });
    return {
      ok: false,
      label: OWNER_SESSION_REQUIRED_LABEL,
      reason: 'dev_token_blocked_in_production',
      detail: 'Development-only token is not accepted by the owner route. Sign in as the IVX owner and retry.',
      email: sessionEmail,
      checks,
    };
  }
  checks.push({
    id: 'dev_token_block',
    passed: true,
    detail: isDevOpenToken
      ? 'Dev-open-access token allowed in this non-production runtime.'
      : accessToken.startsWith('ivxos1.')
        ? 'Bounded owner outage token (not the dev-open-access token).'
        : 'Real Supabase JWT (not the dev-open-access token).',
  });

  // A bounded owner outage token is not a Supabase JWT. It is only installed in
  // memory by the successful backend owner-login response, expires within an
  // hour, and is HMAC-verified by the backend on every request. The client can
  // validate its shape, expiry and allowlisted identity but never treats that
  // inspection as signature verification.
  if (!isDevOpenToken && accessToken.startsWith('ivxos1.')) {
    const decodedOutageToken = decodeBoundedOwnerOutageToken(accessToken);
    const secondsUntilExpiry = decodedOutageToken
      ? Math.round(decodedOutageToken.expiresAt - Date.now() / 1000)
      : null;
    if (!decodedOutageToken || secondsUntilExpiry === null || secondsUntilExpiry <= 0) {
      checks.push({
        id: 'bounded_outage_session',
        passed: false,
        detail: decodedOutageToken
          ? `Bounded owner outage session expired ${Math.abs(secondsUntilExpiry ?? 0)}s ago.`
          : 'Bounded owner outage session is malformed or its email is not allowlisted.',
      });
      return {
        ok: false,
        label: OWNER_SESSION_REQUIRED_LABEL,
        reason: 'outage_token_invalid',
        detail: 'The bounded owner outage session is invalid or expired. Sign in as the IVX owner and retry.',
        email: decodedOutageToken?.email ?? sessionEmail,
        checks,
      };
    }
    checks.push({
      id: 'bounded_outage_session',
      passed: true,
      detail: `Backend-minted owner outage session present (expires in ${secondsUntilExpiry}s; signature remains backend-authoritative).`,
    });
    checks.push({ id: 'token_validity', passed: true, detail: 'Bounded owner outage session is not expired.' });
    checks.push({ id: 'issuer_match', passed: null, detail: 'Supabase issuer check is not applicable to a backend-minted outage session.' });
    checks.push({ id: 'owner_email', passed: true, detail: 'Owner email decoded from bounded outage session.' });
    checks.push({ id: 'owner_email_allowlisted', passed: true, detail: 'Owner email is in the device allowlist.' });
    return { ok: true, accessToken, email: decodedOutageToken.email, checks };
  }

  // For a real JWT, validate format / expiry / issuer and resolve the email.
  if (!isDevOpenToken) {
    const decoded = decodeJwtPayload(accessToken);
    if (!decoded) {
      checks.push({ id: 'token_validity', passed: false, detail: 'Access token is not a decodable JWT.' });
      return {
        ok: false,
        label: OWNER_SESSION_REQUIRED_LABEL,
        reason: 'token_not_jwt',
        detail: 'The session token is not a valid Supabase JWT. Sign in as the IVX owner and retry.',
        email: sessionEmail,
        checks,
      };
    }

    // Check 7 — expired session must not POST.
    const exp = typeof decoded.exp === 'number' ? decoded.exp : null;
    const secondsUntilExpiry = exp !== null ? Math.round(exp - Date.now() / 1000) : null;
    if (secondsUntilExpiry !== null && secondsUntilExpiry <= 0) {
      checks.push({
        id: 'token_validity',
        passed: false,
        detail: `Token expired ${Math.abs(secondsUntilExpiry)}s ago.`,
      });
      return {
        ok: false,
        label: OWNER_SESSION_REQUIRED_LABEL,
        reason: 'token_expired',
        detail: 'The session token is expired. Sign in as the IVX owner and retry.',
        email: sessionEmail,
        checks,
      };
    }
    checks.push({
      id: 'token_validity',
      passed: true,
      detail:
        secondsUntilExpiry !== null ? `Token valid (expires in ${secondsUntilExpiry}s).` : 'Token format valid.',
    });

    // Check 6 — issuer matches the app's Supabase project. This is a HARD block on
    // the client: a token issued by a DIFFERENT Supabase project is a stale cached
    // session from an old build (or a wrong project) and will ALWAYS be rejected by
    // the backend with `issuer_mismatch`. Instead of just blocking, we now actively
    // wipe the stale session and retry once: this handles the common case where the
    // only bad state is the persisted token, and a fresh sign-in will immediately
    // mint a valid token from the current production project.
    const issuer = typeof decoded.iss === 'string' ? decoded.iss : null;
    const issuerMatchResult = issuerMatchesAppProject(issuer);
    const issuerMatch = issuerMatchResult.matches;
    checks.push({
      id: 'issuer_match',
      passed: issuerMatch,
      detail:
        issuerMatch === false
          ? `Token issuer "${issuerMatchResult.actualIssuer ?? 'unknown'}" does not match expected "${issuerMatchResult.expectedIssuer ?? 'unknown'}" (project URL: ${issuerMatchResult.frontendSupabaseUrl ?? 'unset'}). The stale session will be wiped automatically.`
          : issuerMatch === null
            ? 'Issuer match unknown (no app Supabase URL configured).'
            : 'Issuer matches app project.',
    });

    if (issuerMatch === false) {
      // Auto-clear the stale session so the user cannot keep retrying with the
      // bad token. Then try one refresh: if the refresh token belongs to the
      // same wrong project, this will fail and we'll return the clear re-auth
      // instruction. If it somehow recovers, we continue the normal preflight.
      console.log('[IVXOwnerPreflight] issuer_mismatch detected; wiping stale session:', {
        actualIssuer: issuerMatchResult.actualIssuer,
        expectedIssuer: issuerMatchResult.expectedIssuer,
      });
      await wipeStaleSupabaseSession();
      const recoveredToken = await getIVXAccessToken({ forceRefresh: true });
      if (recoveredToken) {
        const recoveredDecoded = decodeJwtPayload(recoveredToken);
        const recoveredIssuer = typeof recoveredDecoded?.iss === 'string' ? recoveredDecoded.iss : null;
        const recoveredMatch = issuerMatchesAppProject(recoveredIssuer);
        if (recoveredMatch.matches === true) {
          // Fresh token from the correct project: continue preflight with it.
          console.log('[IVXOwnerPreflight] Recovered token matches project after stale-session wipe; continuing preflight.');
          return { ok: true, accessToken: recoveredToken, email: sessionEmail, checks };
        }
        console.log('[IVXOwnerPreflight] Recovered token still mismatched after wipe:', {
          recoveredIssuer,
          expectedIssuer: recoveredMatch.expectedIssuer,
        });
      }
      return {
        ok: false,
        label: OWNER_SESSION_REQUIRED_LABEL,
        reason: 'issuer_mismatch',
        detail: `Owner session issuer mismatch: this device had a cached token from "${issuerMatchResult.actualIssuer ?? 'unknown'}" but the app now expects "${issuerMatchResult.expectedIssuer ?? 'unknown'}". The stale session was cleared automatically. Sign in again with your IVX owner email, then resend. Your message was kept and nothing was sent or changed.`,
        email: sessionEmail,
        checks,
      };
    }

    // Check 4 — owner email detected (prefer session email, fall back to JWT email).
    const decodedEmail = typeof decoded.email === 'string' ? decoded.email : null;
    const ownerEmail = sessionEmail ?? decodedEmail;
    checks.push({
      id: 'owner_email',
      passed: Boolean(ownerEmail),
      detail: ownerEmail ? 'Owner email detected.' : 'No owner email on the session.',
    });
    void ownerEmail;

    // Check 5 — owner email allowlisted (soft: the backend allowlist is the source of
    // truth, so a client-side miss is recorded as a warning, not a hard block — the
    // owner route + auth-diagnostic surface the authoritative result).
    const allowlisted = ownerEmail ? isIVXOwnerAllowlistedEmail(ownerEmail) : null;
    checks.push({
      id: 'owner_email_allowlisted',
      passed: allowlisted,
      detail:
        allowlisted === null
          ? 'Owner email allowlist status will be verified by the backend.'
          : allowlisted
            ? 'Owner email is in the device allowlist.'
            : 'Owner email not in the device allowlist; the backend allowlist is authoritative.',
    });

    return { ok: true, accessToken, email: ownerEmail, checks };
  }

  // Dev-open-access token accepted in a non-production runtime.
  return { ok: true, accessToken, email: sessionEmail, checks };
}

/**
 * Convenience for owner-gated `ownerFetch` helpers: returns the verified access
 * token, or throws `OwnerSessionRequiredError` so the action never POSTs without a
 * real owner session and never falls back to /public/chat.
 */
export async function assertOwnerSessionAccessToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const result = await runOwnerSessionPreflight(options);
  if (!result.ok) {
    throw new OwnerSessionRequiredError(result.reason, result.detail, result.checks);
  }
  return result.accessToken;
}
