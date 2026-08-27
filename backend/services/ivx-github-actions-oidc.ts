import { createPublicKey, verify as verifySignature } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCE = 'ivx-360-autonomous-recovery';
const REPOSITORY = 'ibb142/ivx-holdings-platform';
const REF = 'refs/heads/main';
const WORKFLOW_SUFFIX = '/.github/workflows/ivx-360-early-warning.yml@refs/heads/main';
const CLOCK_SKEW_SECONDS = 60;

export type IVXGitHubOIDCClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  repository?: unknown;
  ref?: unknown;
  workflow_ref?: unknown;
  event_name?: unknown;
  sub?: unknown;
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

export function validateIVXGitHubOIDCClaims(claims: IVXGitHubOIDCClaims, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (claims.iss !== ISSUER) return false;
  if (!hasAudience(claims.aud)) return false;
  if (claims.repository !== REPOSITORY) return false;
  if (claims.ref !== REF) return false;
  if (typeof claims.workflow_ref !== 'string' || !claims.workflow_ref.endsWith(WORKFLOW_SUFFIX)) return false;
  if (claims.event_name !== 'push' && claims.event_name !== 'schedule' && claims.event_name !== 'workflow_dispatch') return false;
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) return false;
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) return false;
  if (typeof claims.sub !== 'string' || !claims.sub.startsWith(`repo:${REPOSITORY}:`)) return false;
  return true;
}

async function loadJwks(): Promise<Jwks> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.value;
  const response = await fetch(JWKS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`GitHub OIDC JWKS unavailable: HTTP ${response.status}`);
  const value = await response.json() as Jwks;
  if (!Array.isArray(value.keys) || value.keys.length === 0) throw new Error('GitHub OIDC JWKS is empty.');
  jwksCache = { value, at: now };
  return value;
}

export async function verifyIVXGitHubActionsOIDCToken(token: string): Promise<boolean> {
  const compact = token.trim();
  if (!compact) return false;
  const parts = compact.split('.');
  if (parts.length !== 3) return false;

  let header: { alg?: unknown; kid?: unknown; typ?: unknown };
  let claims: IVXGitHubOIDCClaims;
  try {
    header = decodeBase64UrlJson(parts[0]);
    claims = decodeBase64UrlJson(parts[1]);
  } catch {
    return false;
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return false;
  if (!validateIVXGitHubOIDCClaims(claims)) return false;

  try {
    const jwks = await loadJwks();
    const jwk = jwks.keys?.find((item) => item.kid === header.kid && item.kty === 'RSA');
    if (!jwk) return false;
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    const signature = Buffer.from(parts[2], 'base64url');
    return verifySignature('RSA-SHA256', signingInput, publicKey, signature);
  } catch {
    return false;
  }
}

export async function verifyIVXGitHubActionsOIDCRequest(request: Request): Promise<boolean> {
  const token = request.headers.get('X-IVX-GitHub-OIDC')?.trim() ?? '';
  return verifyIVXGitHubActionsOIDCToken(token);
}

export const IVX_GITHUB_OIDC_CONTRACT = Object.freeze({
  issuer: ISSUER,
  audience: AUDIENCE,
  repository: REPOSITORY,
  ref: REF,
  workflow: '.github/workflows/ivx-360-early-warning.yml',
});
