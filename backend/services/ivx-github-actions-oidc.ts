import { createPublicKey, verify as verifySignature } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCE = 'ivx-360-autonomous-recovery';
const REPOSITORY = 'ibb142/ivx-holdings-platform';
const OWNER_ID = '74543014';
const REPOSITORY_ID = '1169662811';
const REF = 'refs/heads/main';
const WORKFLOW_SUFFIXES = [
  '/.github/workflows/ivx-360-early-warning.yml@refs/heads/main',
  '/.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml@refs/heads/main',
  '/.github/workflows/ivx-autonomous-radar-self-heal.yml@refs/heads/main',
] as const;
const CLOCK_SKEW_SECONDS = 60;

export type IVXGitHubOIDCClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  repository?: unknown;
  repository_id?: unknown;
  repository_owner_id?: unknown;
  ref?: unknown;
  workflow_ref?: unknown;
  event_name?: unknown;
  sub?: unknown;
};

export type IVXGitHubOIDCReason =
  | 'ok'
  | 'missing_token'
  | 'malformed_token'
  | 'invalid_header'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'repository_mismatch'
  | 'repository_id_mismatch'
  | 'owner_id_mismatch'
  | 'ref_mismatch'
  | 'workflow_ref_mismatch'
  | 'event_mismatch'
  | 'expired'
  | 'not_yet_valid'
  | 'subject_mismatch'
  | 'jwks_fetch_failed'
  | 'kid_not_found'
  | 'signature_invalid';

export type IVXGitHubOIDCDiagnostic = {
  ok: boolean;
  reason: IVXGitHubOIDCReason;
  claimShape?: {
    repository: boolean;
    repositoryId: boolean;
    ownerId: boolean;
    ref: boolean;
    workflowRef: boolean;
    eventName: boolean;
    audience: boolean;
  };
};

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string; kty?: string };
type Jwks = { keys?: Jwk[] };

let jwksCache: { value: Jwks; at: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

function decodeBase64UrlJson<T>(value: string): T {
  const text = Buffer.from(value, 'base64url').toString('utf8');
  return JSON.parse(text) as T;
}

function hasAudience(value: unknown): boolean {
  if (typeof value === 'string') return value === AUDIENCE;
  return Array.isArray(value) && value.some((item) => item === AUDIENCE);
}

function claimShape(claims: IVXGitHubOIDCClaims) {
  return {
    repository: typeof claims.repository === 'string',
    repositoryId: typeof claims.repository_id === 'string',
    ownerId: typeof claims.repository_owner_id === 'string',
    ref: typeof claims.ref === 'string',
    workflowRef: typeof claims.workflow_ref === 'string',
    eventName: typeof claims.event_name === 'string',
    audience: typeof claims.aud === 'string' || Array.isArray(claims.aud),
  };
}

function validSubject(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const legacyPrefix = `repo:${REPOSITORY}:`;
  const immutablePrefix = `repo:ibb142@${OWNER_ID}/ivx-holdings-platform@${REPOSITORY_ID}:`;
  return value.startsWith(legacyPrefix) || value.startsWith(immutablePrefix);
}

export function diagnoseIVXGitHubOIDCClaims(claims: IVXGitHubOIDCClaims, nowSeconds = Math.floor(Date.now() / 1000)): IVXGitHubOIDCDiagnostic {
  const shape = claimShape(claims);
  if (claims.iss !== ISSUER) return { ok: false, reason: 'issuer_mismatch', claimShape: shape };
  if (!hasAudience(claims.aud)) return { ok: false, reason: 'audience_mismatch', claimShape: shape };
  if (claims.repository !== REPOSITORY) return { ok: false, reason: 'repository_mismatch', claimShape: shape };
  if (typeof claims.repository_id === 'string' && claims.repository_id !== REPOSITORY_ID) return { ok: false, reason: 'repository_id_mismatch', claimShape: shape };
  if (typeof claims.repository_owner_id === 'string' && claims.repository_owner_id !== OWNER_ID) return { ok: false, reason: 'owner_id_mismatch', claimShape: shape };
  if (claims.ref !== REF) return { ok: false, reason: 'ref_mismatch', claimShape: shape };
  const workflowRef = claims.workflow_ref;
  if (typeof workflowRef !== 'string' || !WORKFLOW_SUFFIXES.some((suffix) => workflowRef.endsWith(suffix))) return { ok: false, reason: 'workflow_ref_mismatch', claimShape: shape };
  if (claims.event_name !== 'push' && claims.event_name !== 'schedule' && claims.event_name !== 'workflow_dispatch' && claims.event_name !== 'workflow_run') return { ok: false, reason: 'event_mismatch', claimShape: shape };
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) return { ok: false, reason: 'expired', claimShape: shape };
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) return { ok: false, reason: 'not_yet_valid', claimShape: shape };
  if (!validSubject(claims.sub)) return { ok: false, reason: 'subject_mismatch', claimShape: shape };
  return { ok: true, reason: 'ok', claimShape: shape };
}

export function validateIVXGitHubOIDCClaims(claims: IVXGitHubOIDCClaims, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return diagnoseIVXGitHubOIDCClaims(claims, nowSeconds).ok;
}

async function loadJwks(): Promise<Jwks> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.value;
  const response = await fetch(JWKS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const value = await response.json() as Jwks;
  if (!Array.isArray(value.keys) || value.keys.length === 0) throw new Error('EMPTY_JWKS');
  jwksCache = { value, at: now };
  return value;
}

export async function diagnoseIVXGitHubActionsOIDCToken(token: string): Promise<IVXGitHubOIDCDiagnostic> {
  const compact = token.trim();
  if (!compact) return { ok: false, reason: 'missing_token' };
  const parts = compact.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_token' };

  let header: { alg?: unknown; kid?: unknown; typ?: unknown };
  let claims: IVXGitHubOIDCClaims;
  try {
    header = decodeBase64UrlJson(parts[0]);
    claims = decodeBase64UrlJson(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return { ok: false, reason: 'invalid_header', claimShape: claimShape(claims) };

  const claimsDiagnostic = diagnoseIVXGitHubOIDCClaims(claims);
  if (!claimsDiagnostic.ok) return claimsDiagnostic;

  let jwks: Jwks;
  try {
    jwks = await loadJwks();
  } catch {
    return { ok: false, reason: 'jwks_fetch_failed', claimShape: claimShape(claims) };
  }

  const jwk = jwks.keys?.find((item) => item.kid === header.kid && item.kty === 'RSA');
  if (!jwk) return { ok: false, reason: 'kid_not_found', claimShape: claimShape(claims) };

  try {
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    const signature = Buffer.from(parts[2], 'base64url');
    const valid = verifySignature('RSA-SHA256', signingInput, publicKey, signature);
    return valid ? { ok: true, reason: 'ok', claimShape: claimShape(claims) } : { ok: false, reason: 'signature_invalid', claimShape: claimShape(claims) };
  } catch {
    return { ok: false, reason: 'signature_invalid', claimShape: claimShape(claims) };
  }
}

export async function verifyIVXGitHubActionsOIDCToken(token: string): Promise<boolean> {
  return (await diagnoseIVXGitHubActionsOIDCToken(token)).ok;
}

export async function diagnoseIVXGitHubActionsOIDCRequest(request: Request): Promise<IVXGitHubOIDCDiagnostic> {
  const token = request.headers.get('X-IVX-GitHub-OIDC')?.trim() ?? '';
  return diagnoseIVXGitHubActionsOIDCToken(token);
}

export async function verifyIVXGitHubActionsOIDCRequest(request: Request): Promise<boolean> {
  return (await diagnoseIVXGitHubActionsOIDCRequest(request)).ok;
}

export const IVX_GITHUB_OIDC_CONTRACT = Object.freeze({
  issuer: ISSUER,
  audience: AUDIENCE,
  repository: REPOSITORY,
  repositoryId: REPOSITORY_ID,
  ownerId: OWNER_ID,
  ref: REF,
  workflows: [
    '.github/workflows/ivx-360-early-warning.yml',
    '.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml',
    '.github/workflows/ivx-autonomous-radar-self-heal.yml',
  ],
});