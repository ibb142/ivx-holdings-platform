import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function authenticateOwner({ email, password, supabaseUrl, anonKey }, fetchImpl = fetch) {
  if (![email, password, supabaseUrl, anonKey].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('owner_auth_credentials_missing');
  }
  const base = new URL(supabaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
    throw new Error('owner_auth_url_invalid');
  }
  let response;
  try {
    response = await fetchImpl(`${base.origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch { throw new Error('owner_auth_transport_failed'); }
  if (!response.ok) throw new Error(`owner_auth_http_${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('owner_auth_response_invalid'); }
  const role = data?.user?.app_metadata?.role ?? data?.user?.user_metadata?.role;
  if (String(data?.user?.email ?? '').toLowerCase() !== email.trim().toLowerCase() || !['owner', 'admin'].includes(role)) {
    throw new Error('owner_auth_identity_invalid');
  }
  const token = data?.access_token;
  if (typeof token !== 'string' || token.length < 100 || /[\r\n]/.test(token)) throw new Error('owner_auth_session_invalid');
  return { token, role };
}

export async function waitForDeployment({ apiBase, sha, attempts = 60, fetchImpl = fetch, sleep = delay }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('target_sha_invalid');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const probes = await Promise.all(['/health', '/version'].map(async path => {
      try {
        const response = await fetchImpl(`${apiBase.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        if (!response.ok) return false;
        const data = await response.json();
        return data?.ok === true && data.commit === sha;
      } catch { return false; }
    }));
    if (probes.every(Boolean)) return { sha, attempts: attempt, observedAt: new Date().toISOString() };
    if (attempt < attempts) await sleep(5000);
  }
  throw new Error('deployment_not_ready');
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'push' || !process.env.GITHUB_ENV) {
    throw new Error('protected_main_push_required');
  }
  const deployment = await waitForDeployment({ apiBase: 'https://api.ivxholding.com', sha: process.env.IVX_COMMIT_SHA });
  const session = await authenticateOwner({
    email: process.env.IVX_QA_OWNER_EMAIL, password: process.env.IVX_QA_OWNER_PASSWORD,
    supabaseUrl: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY,
  });
  console.log(`::add-mask::${session.token}`);
  appendFileSync(process.env.GITHUB_ENV, `IVX_OWNER_TOKEN=${session.token}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ event: 'qa_preflight', result: 'PASS', deployment, ownerRole: session.role, auth: 'supabase_password', credentialValuesLogged: false }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`QA_PREFLIGHT_FAIL ${error.message}`); process.exitCode = 1; });
}
