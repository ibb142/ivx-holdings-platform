// Live end-to-end audit of the IVX Senior Developer Brain fix.
// Hits the real Render backend and verifies the senior-developer brain path
// is deployed and answering directly (no BLOCKED state).
import https from 'node:https';

const API_BASE = 'https://api.ivxholding.com';
const OWNER_TOKEN = process.env.IVX_OWNER_TOKEN || '';
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const RENDER_SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const OWNER_EMAIL = 'iperez4242@gmail.com';
const OWNER_PASSWORD = process.env.IVX_OWNER_PASSWORD || '';

function fetchJson(url, opts = {}, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: opts.method || 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: opts.headers || {},
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { parsed = body.slice(0, 2000); }
          resolve({ status: res.statusCode, data: parsed, raw: body.slice(0, 3000) });
        });
      }
    );
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  const ts = new Date().toISOString();
  const evidence = {
    auditId: 'senior-dev-brain-live-proof-' + Date.now(),
    timestamp: ts,
    apiBase: API_BASE,
    steps: {},
  };

  // 1. Health check
  const health = await fetchJson(`${API_BASE}/health`);
  evidence.steps.health = {
    status: health.status,
    commit: health.data?.commit,
    commitShort: health.data?.commitShort,
    bootTime: health.data?.bootTime,
    service: health.data?.service,
    routesRegistered: Array.isArray(health.data?.routes),
    routeCount: Array.isArray(health.data?.routes) ? health.data.routes.length : 0,
  };

  // 2. Supabase owner sign-in (do this FIRST so we have a real bearer for cred audit)
  const supaRes = await fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const supaAccess = supaRes.data?.access_token || null;
  evidence.steps.supabaseOwner = {
    status: supaRes.status,
    signInOk: !!supaAccess,
    userId: supaRes.data?.user?.id,
    email: supaRes.data?.user?.email,
    accessTokenLen: supaAccess ? supaAccess.length : 0,
  };

  // 3. Senior-developer BRAIN prompt via owner-ai
  const brainPrompt = 'I want my senior developer to have same brain like you — answer exactly what I ask, audit and fix this now';
  const brainRes = await fetchJson(`${API_BASE}/api/ivx/owner-ai`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OWNER_TOKEN}`,
      'X-IVX-Owner-Email': OWNER_EMAIL,
    },
    body: JSON.stringify({ message: brainPrompt, mode: 'chat' }),
  });
  evidence.steps.seniorDevBrain = {
    status: brainRes.status,
    source: brainRes.data?.source,
    blocked: brainRes.data?.status === 'blocked',
    answerPreview: typeof brainRes.data?.answer === 'string' ? brainRes.data.answer.slice(0, 500) : null,
    verdict: brainRes.data?.source === 'ivx-owner-ai-senior-dev-brain' && brainRes.data?.status !== 'blocked'
      ? 'PASS — senior dev brain live, direct answer'
      : 'FAIL — still blocked or wrong source',
  };

  // 4. Senior-developer MODE STATUS question
  const statusPrompt = 'Do you in a senior developer mode?';
  const statusRes = await fetchJson(`${API_BASE}/api/ivx/owner-ai`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OWNER_TOKEN}`,
      'X-IVX-Owner-Email': OWNER_EMAIL,
    },
    body: JSON.stringify({ message: statusPrompt, mode: 'chat' }),
  });
  evidence.steps.seniorDevStatus = {
    status: statusRes.status,
    source: statusRes.data?.source,
    blocked: statusRes.data?.status === 'blocked',
    answerPreview: typeof statusRes.data?.answer === 'string' ? statusRes.data.answer.slice(0, 400) : null,
  };

  // 5. Credential audit (owner-gated — uses real Supabase owner bearer)
  const credRes = await fetchJson(`${API_BASE}/api/ivx/senior-developer/credential-audit`, {
    headers: {
      Authorization: `Bearer ${supaAccess || OWNER_TOKEN}`,
      'X-IVX-Owner-Email': OWNER_EMAIL,
      'X-IVX-Owner-Token': OWNER_TOKEN,
    },
  });
  evidence.steps.credentialAudit = {
    status: credRes.status,
    ok: credRes.data?.ok,
    ownerVerified: credRes.data?.ownerApproval?.ownerVerified,
    ownerEmailMatched: credRes.data?.ownerApproval?.ownerEmailMatched,
    githubPresent: credRes.data?.audit?.credentials?.GITHUB_TOKEN?.present,
    renderPresent: credRes.data?.audit?.credentials?.RENDER_API_KEY?.present,
    githubRepoUrl: credRes.data?.audit?.credentials?.GITHUB_REPO_URL?.present,
    blockers: credRes.data?.audit?.blockers?.length || 0,
  };

  // 6. Render service
  const renderRes = await fetchJson(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}`, {
    headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' },
  });
  evidence.steps.renderService = {
    status: renderRes.status,
    name: renderRes.data?.name,
    serviceId: RENDER_SERVICE_ID,
    status2: renderRes.data?.status,
    url: renderRes.data?.url,
  };

  // 7. Render deploys
  const deploysRes = await fetchJson(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys?limit=3`, {
    headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' },
  });
  evidence.steps.renderDeploys = Array.isArray(deploysRes.data)
    ? deploysRes.data.map((d) => ({ id: d.id, status: d.status, commit: d.commit?.id?.slice(0, 8), createdAt: d.createdAt, finishedAt: d.finishedAt }))
    : { status: deploysRes.status, error: deploysRes.error };

  // 8. GitHub repo
  const ghRes = await fetchJson('https://api.github.com/repos/ibb142/ivx-holdings-platform', {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'IVX-Audit' },
  });
  evidence.steps.githubRepo = {
    status: ghRes.status,
    fullName: ghRes.data?.full_name,
    private: ghRes.data?.private,
    defaultBranch: ghRes.data?.default_branch,
    pushedAt: ghRes.data?.pushed_at,
  };

  // 9. GitHub latest commit on main
  const ghCommit = await fetchJson('https://api.github.com/repos/ibb142/ivx-holdings-platform/commits/main', {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'IVX-Audit' },
  });
  evidence.steps.githubLatestCommit = {
    status: ghCommit.status,
    sha: ghCommit.data?.sha,
    shaShort: ghCommit.data?.sha?.slice(0, 8),
    message: ghCommit.data?.commit?.message?.slice(0, 150),
    date: ghCommit.data?.commit?.committer?.date,
  };

  // 10. Version endpoint
  const versionRes = await fetchJson(`${API_BASE}/version`);
  evidence.steps.version = {
    status: versionRes.status,
    version: versionRes.data?.version,
    commit: versionRes.data?.commit,
  };

  // Overall verdict
  const brainPass = evidence.steps.seniorDevBrain.verdict.startsWith('PASS');
  const statusPass = evidence.steps.seniorDevStatus.source === 'ivx-owner-ai-senior-dev-mode' && !evidence.steps.seniorDevStatus.blocked;
  const infraPass =
    evidence.steps.health.status === 200 &&
    evidence.steps.renderService.status === 200 &&
    evidence.steps.supabaseOwner.signInOk === true &&
    evidence.steps.githubRepo.status === 200;

  evidence.verdict = (brainPass && statusPass && infraPass)
    ? 'SENIOR_DEVELOPER_BRAIN_LIVE_AND_VERIFIED_END_TO_END'
    : 'PARTIAL — see steps';

  evidence.summary = {
    brainPath: brainPass ? 'LIVE — answers directly, no BLOCKED' : 'FAILED',
    statusPath: statusPass ? 'LIVE — confirms senior dev mode' : 'FAILED',
    supabaseOwner: evidence.steps.supabaseOwner.signInOk ? 'OK — owner signed in' : 'FAILED',
    renderBackend: evidence.steps.health.status === 200 ? `OK — commit ${evidence.steps.health.commitShort}` : 'FAILED',
    githubRepo: evidence.steps.githubRepo.status === 200 ? 'OK — repo accessible' : 'FAILED',
    credentialAudit: evidence.steps.credentialAudit.ok === true ? 'OK — credentials verified' : `status ${evidence.steps.credentialAudit.status}`,
  };

  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((e) => {
  console.error('AUDIT_FATAL', e.message);
  process.exit(1);
});
