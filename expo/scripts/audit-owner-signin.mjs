/**
 * End-to-end owner sign-in + Supabase approval audit.
 *
 * Steps:
 * 1. Sign in to Supabase as IVX_OWNER_EMAIL/IVX_OWNER_PASSWORD.
 * 2. Probe backend /api/ivx/owner-ai/auth-diagnostic with the bearer token.
 * 3. Probe /api/ivx/owner-ai to confirm the owner-gated route is reachable.
 * 4. Print a sanitized, evidence-ready JSON result (no secrets, no tokens).
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://kvclcdjmjghndxsngfzb.supabase.co';
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const OWNER_EMAIL = process.env.IVX_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.IVX_OWNER_PASSWORD ?? '';
const BACKEND_BASE = process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL ?? 'https://api.ivxholding.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeJwtIssuer(token) {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    return typeof obj.iss === 'string' ? obj.iss : null;
  } catch {
    return null;
  }
}

async function fetchWithTransientRetry(url, init, label, attempts = 5) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      lastResponse = response;
      if (response.status < 500 && response.status !== 429) return response;
      if (attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    const delayMs = Math.min(8000, 1000 * (2 ** (attempt - 1)));
    console.error(`${label} transient failure; retry ${attempt}/${attempts} after ${delayMs}ms`);
    await sleep(delayMs);
  }
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error(`${label} failed without a response`);
}

async function signInOwner() {
  const response = await fetchWithTransientRetry(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
    },
    'Supabase owner sign-in',
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const details = JSON.stringify({
      status: response.status,
      error: body?.error ?? null,
      error_description: body?.error_description ?? null,
      message: body?.message ?? null,
      code: body?.code ?? null,
    });
    throw new Error(`Supabase sign-in failed: ${details}`);
  }
  const accessToken = body?.access_token;
  if (!accessToken) throw new Error('Supabase sign-in succeeded but no access_token was returned.');
  return {
    accessToken,
    refreshToken: body?.refresh_token ?? null,
    userId: body?.user?.id ?? null,
    email: body?.user?.email ?? null,
    expiresAt: body?.expires_at ?? null,
    issuer: decodeJwtIssuer(accessToken),
  };
}

async function probeBackendAuthDiagnostic(accessToken) {
  const response = await fetchWithTransientRetry(`${BACKEND_BASE}/api/ivx/owner-ai/auth-diagnostic`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: '{}',
  }, 'Owner auth diagnostic');
  const body = await response.json().catch(() => null);
  return {
    httpStatus: response.status,
    ok: body?.ok === true,
    rootCause: body?.rootCause ?? null,
    checks: body?.checks ?? {},
    supabaseLookup: body?.supabaseLookup ?? {},
  };
}

async function probeOwnerAI(accessToken) {
  const response = await fetchWithTransientRetry(`${BACKEND_BASE}/api/ivx/owner-ai`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ message: 'Return one word only: ALIVE', mode: 'chat' }),
  }, 'Owner AI reachability');
  const text = await response.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { body = { preview: text.slice(0, 200) }; }
  return {
    httpStatus: response.status,
    bodyPreview: typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  let signIn = null;
  let diagnostic = null;
  let ownerAi = null;
  let error = null;

  try {
    signIn = await signInOwner();
    diagnostic = await probeBackendAuthDiagnostic(signIn.accessToken);
    ownerAi = await probeOwnerAI(signIn.accessToken);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const evidence = {
    auditId: `owner-signin-${Date.now()}`,
    auditedAt: startedAt,
    supabaseProject: SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    ownerEmail: OWNER_EMAIL.toLowerCase(),
    signIn: signIn ? {
      success: true,
      userId: signIn.userId,
      email: signIn.email,
      issuer: signIn.issuer,
      tokenLength: signIn.accessToken.length,
      expiresAt: signIn.expiresAt ? new Date(signIn.expiresAt * 1000).toISOString() : null,
    } : { success: false, error },
    backendAuthDiagnostic: diagnostic ? {
      httpStatus: diagnostic.httpStatus,
      accepted: diagnostic.ok,
      rootCause: diagnostic.rootCause,
      tokenExpired: diagnostic.checks?.tokenExpired ?? null,
      issuerMatchesBackend: diagnostic.checks?.issuerMatchesBackendProject ?? null,
      supabaseUserFound: diagnostic.supabaseLookup?.userFound ?? null,
      ownerEmailAllowlisted: diagnostic.checks?.ownerEmailAllowlisted ?? null,
      authenticatedEmailMasked: diagnostic.supabaseLookup?.emailMasked ?? null,
    } : null,
    ownerAIReachability: ownerAi ? {
      httpStatus: ownerAi.httpStatus,
      bodyPreview: ownerAi.bodyPreview,
    } : null,
    verdict: error
      ? 'FAILED'
      : diagnostic?.ok && ownerAi?.httpStatus === 200
        ? 'OWNER_APPROVED_AND_AI_REACHABLE'
        : diagnostic?.ok
          ? 'OWNER_APPROVED_BUT_AI_UNREACHABLE'
          : 'OWNER_NOT_APPROVED',
  };

  console.log(JSON.stringify(evidence, null, 2));
  process.exit(evidence.verdict === 'OWNER_APPROVED_AND_AI_REACHABLE' ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
