// IVX Holdings — Final Enterprise Live Audit (corrected route paths)
import https from 'node:https';
import fs from 'node:fs/promises';

const SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RENDER_KEY = process.env.RENDER_API_KEY || '';
const RENDER_SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const BACKEND_URL = 'https://api.ivxholding.com';
const OWNER_EMAIL = 'Iperez4242@gmail.com';
const OWNER_PASSWORD = process.env.IVX_OWNER_PASSWORD || '';

function fetch(url, opts = {}, timeout = 25000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers || {}, timeout }, (res) => {
      let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e.message || e), body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout', body: '' }); });
    if (opts.body) req.write(opts.body); req.end();
  });
}
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };
const supaHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const result = { auditId: 'ivx-enterprise-final-v2-' + Date.now(), timestamp: new Date().toISOString(), phases: {} };

// ── PHASE 0: Infrastructure ──
async function phase0() {
  const p = {};
  const [health, version, render, ghRepo] = await Promise.all([
    fetch(`${BACKEND_URL}/health`),
    fetch(`${BACKEND_URL}/api/ivx/version`),
    fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}`, { headers: { Authorization: `Bearer ${RENDER_KEY}`, Accept: 'application/json' } }),
    fetch('https://api.github.com/repos/ibb142/ivx-holdings-platform', { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'IVX-Audit' } }),
  ]);
  p.health = { status: health.status, ok: health.status === 200 };
  const vj = j(version.body || '');
  p.version = { status: version.status, sha: vj?.commit || vj?.sha || (version.body?.slice(0,120)), bootTime: vj?.bootTime || null };
  const rj = j(render.body || '');
  p.render = { status: render.status, name: rj?.name, suspended: rj?.suspended, url: rj?.serviceUrl || rj?.url };
  const depRes = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys?limit=1`, { headers: { Authorization: `Bearer ${RENDER_KEY}`, Accept: 'application/json' } });
  const dep = j(depRes.body || '');
  p.latestDeploy = dep?.[0] ? { id: dep[0].id, status: dep[0].status, commit: dep[0].commit?.id, createdAt: dep[0].createdAt, finishedAt: dep[0].finishedAt } : null;
  const ghj = j(ghRepo.body || '');
  p.github = { status: ghRepo.status, repo: ghj?.full_name, private: ghj?.private, defaultBranch: ghj?.default_branch };
  const ghCommits = await fetch('https://api.github.com/repos/ibb142/ivx-holdings-platform/commits?per_page=1', { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'IVX-Audit' } });
  const ghc = j(ghCommits.body || '');
  p.latestCommit = ghc?.[0] ? { sha: ghc[0].sha, message: ghc[0].commit?.message?.slice(0,140), date: ghc[0].commit?.author?.date } : null;
  p.commitMatch = !!(p.latestDeploy?.commit && p.latestCommit?.sha && p.latestCommit.sha.startsWith(p.latestDeploy.commit));
  // Supabase ping
  const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: supaHeaders });
  p.supabase = { status: supaRes.status, connected: supaRes.status === 200 || supaRes.status === 200 };
  return p;
}

// ── PHASE 1: Live table counts ──
async function phase1() {
  const tables = ['profiles','wallets','transactions','jv_deals','landing_deals','waitlist','notifications','analytics_events','conversations','messages','conversation_participants','landing_analytics','landing_investments','live_sessions','lenders','wire_transfers','withdrawals','treasury','ledger','capital_accounts','distributions','tokenized_assets','private_lenders','buyers','kyc_verifications','holdings','properties'];
  const counts = {};
  await Promise.all(tables.map(async (t) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=count&limit=1`, { headers: { ...supaHeaders, Range: '0-0', Prefer: 'count=exact' } });
    const range = r.headers['content-range'] || r.headers['Content-Range'] || '';
    const m = range.match(/\/(\d+)/);
    counts[t] = m ? parseInt(m[1],10) : (r.status === 200 ? 0 : `ERR:${r.status}`);
  }));
  return counts;
}

// ── PHASE 2: Auth users (real members) ──
async function phase2() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: supaHeaders });
  const users = j(r.body || '');
  const list = Array.isArray(users?.users) ? users.users : (Array.isArray(users) ? users : []);
  const members = list.map((u) => ({ id: u.id, email: u.email, confirmed: !!u.email_confirmed_at || !!u.confirmed_at, bannedUntil: u.banned_until || null }));
  return { httpStatus: r.status, total: members.length, members };
}

// ── PHASE 3: Owner sign-in ──
async function phase3() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const data = j(r.body || '');
  return { status: r.status, signedIn: !!data?.access_token, userId: data?.user?.id, email: data?.user?.email, error: data?.error_description || data?.msg || null };
}

// ── PHASE 4: Owner AI (identity + conversation + knowledge) ──
async function phase4() {
  const ownerToken = process.env.IVX_OWNER_TOKEN || '';
  const questions = [
    'What is your name?',
    'Who created you?',
    'Who is the owner of IVXHOLDINGS?',
    'Tell me about IVXHOLDINGS investments and projects',
    'What is 15 multiplied by 3?',
    'Hello',
    'What can you do?',
  ];
  const out = {};
  for (const q of questions) {
    const r = await fetch(`${BACKEND_URL}/api/ivx/owner-ai`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ivx-owner-token': ownerToken },
      body: JSON.stringify({ message: q }),
    });
    const data = j(r.body || '');
    out[q] = { status: r.status, source: data?.source, answer: (data?.answer || data?.reply || data?.message || r.body)?.slice(0, 350) };
  }
  return out;
}

// ── PHASE 5: Public chat ──
async function phase5() {
  const questions = ['What is IVXHOLDINGS?', 'What is your name?', 'What is 10 plus 5?'];
  const out = {};
  for (const q of questions) {
    const r = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q }),
    });
    const data = j(r.body || '');
    out[q] = { status: r.status, answer: (data?.answer || data?.reply || data?.message || r.body)?.slice(0, 350) };
  }
  return out;
}

// ── PHASE 6: Module endpoints (correct paths) ──
async function phase6() {
  const ownerToken = process.env.IVX_OWNER_TOKEN || '';
  const headers = { 'x-ivx-owner-token': ownerToken };
  const endpoints = [
    ['landing', `${BACKEND_URL}/`],
    ['landingConfig', `${BACKEND_URL}/api/landing-config`],
    ['registration (POST)', `${BACKEND_URL}/api/members/register`],
    ['login (POST)', `${BACKEND_URL}/api/members/login`],
    ['forgotPassword (POST)', `${BACKEND_URL}/api/members/forgot-password`],
    ['resetPassword (POST)', `${BACKEND_URL}/api/members/reset-password`],
    ['sendEmailCode (POST)', `${BACKEND_URL}/api/members/send-email-code`],
    ['verifyEmail (POST)', `${BACKEND_URL}/api/members/verify-email`],
    ['sendPhoneCode (POST)', `${BACKEND_URL}/api/members/send-phone-code`],
    ['verifyPhone (POST)', `${BACKEND_URL}/api/members/verify-phone`],
    ['members/me', `${BACKEND_URL}/api/members/me`],
    ['startKYC (POST)', `${BACKEND_URL}/api/members/start-kyc`],
    ['verificationStatus', `${BACKEND_URL}/api/members/verification-status`],
    ['investorApplication (POST)', `${BACKEND_URL}/api/members/investor-application`],
    ['investors', `${BACKEND_URL}/api/ivx/investors`],
    ['jvDeals', `${BACKEND_URL}/api/ivx/jv-deals`],
    ['projectDashboard', `${BACKEND_URL}/api/ivx/project-dashboard`],
    ['analytics', `${BACKEND_URL}/api/ivx/analytics`],
    ['runtimeVariables', `${BACKEND_URL}/api/ivx/runtime-variables`],
    ['ownerVariables', `${BACKEND_URL}/api/ivx/owner-variables/status`],
    ['treasuryDashboard', `${BACKEND_URL}/api/ivx/treasury/dashboard`],
    ['treasuryLedger', `${BACKEND_URL}/api/ivx/treasury/ledger`],
    ['protectionDashboard', `${BACKEND_URL}/api/ivx/protection/dashboard`],
    ['protectionWithdrawals', `${BACKEND_URL}/api/ivx/protection/withdrawals`],
    ['protectionWires', `${BACKEND_URL}/api/ivx/protection/wires`],
    ['protectionWallet', `${BACKEND_URL}/api/ivx/protection/wallet`],
    ['protectionLedgerIntegrity', `${BACKEND_URL}/api/ivx/protection/ledger-integrity`],
    ['protectionAccountStates', `${BACKEND_URL}/api/ivx/protection/account-states`],
    ['protectionDeletionRequests', `${BACKEND_URL}/api/ivx/protection/deletion-requests`],
    ['protectionRecovery', `${BACKEND_URL}/api/ivx/protection/recovery`],
    ['ownerOperationsDashboard', `${BACKEND_URL}/api/ivx/owner-operations/dashboard`],
    ['memberAdminDashboard', `${BACKEND_URL}/api/ivx/member-admin/dashboard`],
    ['auditReport', `${BACKEND_URL}/api/ivx/audit-report`],
    ['version', `${BACKEND_URL}/api/ivx/version`],
  ];
  const out = {};
  await Promise.all(endpoints.map(async ([name, url]) => {
    const r = await fetch(url, { headers });
    const ok = r.status >= 200 && r.status < 300;
    const note = ok ? 'OK' : (r.status === 401 || r.status === 403 ? 'AUTH_REQUIRED' : (r.status === 404 ? 'NOT_FOUND' : (r.status === 405 ? 'METHOD_NOT_ALLOWED_GET' : 'CHECK')));
    out[name] = { status: r.status, note };
  }));
  return out;
}

// ── Run ──
console.log('Starting IVX Enterprise Final Audit (v2 — corrected paths)...\n');
const infra = await phase0();
console.log('Phase 0 (Infra):', { health: infra.health.status, render: infra.render.status, deploy: infra.latestDeploy?.id, commitMatch: infra.commitMatch, supabase: infra.supabase.status });
const tableCounts = await phase1();
console.log('Phase 1 (Tables):', Object.entries(tableCounts).filter(([,v]) => typeof v === 'number' && v > 0).map(([k,v])=>`${k}=${v}`).join(', '));
const authUsers = await phase2();
console.log('Phase 2 (Auth users):', authUsers.total, authUsers.members.map(m=>m.email).join(', '));
const ownerSignIn = await phase3();
console.log('Phase 3 (Owner sign-in):', ownerSignIn.status, 'signedIn=', ownerSignIn.signedIn);
const ownerAI = await phase4();
console.log('Phase 4 (Owner AI):', Object.entries(ownerAI).map(([k,v])=>`${k.slice(0,18)}:${v.status}`).join(' | '));
const publicAI = await phase5();
console.log('Phase 5 (Public AI):', Object.entries(publicAI).map(([k,v])=>`${k.slice(0,15)}:${v.status}`).join(' | '));
const modules = await phase6();
console.log('Phase 6 (Modules):', Object.entries(modules).map(([k,v])=>`${k}:${v.status}`).join(' '));

result.phases.infra = infra;
result.phases.tableCounts = tableCounts;
result.phases.authUsers = authUsers;
result.phases.ownerSignIn = ownerSignIn;
result.phases.ownerAI = ownerAI;
result.phases.publicAI = publicAI;
result.phases.modules = modules;

const allInfraOk = infra.health.ok && infra.render.status === 200 && infra.supabase.connected && ownerSignIn.signedIn;
result.finalVerdict = allInfraOk ? 'LIVE — production verified' : 'BLOCKED — see phases';
result.realCounts = {
  members: authUsers.total,
  investors: tableCounts.lenders || 0,
  buyers: tableCounts.buyers || 0,
  jvDeals: tableCounts.jv_deals || 0,
  privateLenders: tableCounts.private_lenders || 0,
  tokenized: tableCounts.tokenized_assets || 0,
  wallets: tableCounts.wallets || 0,
  treasury: tableCounts.treasury || 0,
  ledger: tableCounts.ledger || 0,
  withdrawals: tableCounts.withdrawals || 0,
  wires: tableCounts.wire_transfers || 0,
  notifications: tableCounts.notifications || 0,
};

const outPath = 'backend/verification-proof/ivx-enterprise-final-audit-v2-' + Date.now() + '.json';
await fs.writeFile(outPath, JSON.stringify(result, null, 2));
console.log('\n=== AUDIT COMPLETE ===');
console.log('Verdict:', result.finalVerdict);
console.log('Real counts:', JSON.stringify(result.realCounts));
console.log('Proof file:', outPath);
console.log('\nFull result:\n', JSON.stringify(result, null, 2));
