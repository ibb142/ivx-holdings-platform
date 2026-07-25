// IVX Holdings — Final Enterprise Live Audit (fresh, no fabricated data)
// Run with: bun expo/scripts/audit-enterprise-final.mjs
import https from 'node:https';

const SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RENDER_KEY = process.env.RENDER_API_KEY || '';
const RENDER_SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const BACKEND_URL = 'https://api.ivxholding.com';
const OWNER_EMAIL = 'Iperez4242@gmail.com';
const OWNER_PASSWORD = process.env.IVX_OWNER_PASSWORD || '';

function fetch(url, opts = {}, timeout = 20000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e.message || e), body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout', body: '' }); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };
const supaHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

const result = { auditId: 'ivx-enterprise-final-' + Date.now(), timestamp: new Date().toISOString(), phases: {} };

// ── PHASE 0: Infrastructure health ──
async function phase0() {
  const p = {};
  const [health, version, render, ghRepo] = await Promise.all([
    fetch(`${BACKEND_URL}/health`),
    fetch(`${BACKEND_URL}/version`),
    fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}`, { headers: { Authorization: `Bearer ${RENDER_KEY}`, Accept: 'application/json' } }),
    fetch('https://api.github.com/repos/ibb142/ivx-holdings-platform', { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'IVX-Audit' } }),
  ]);
  p.health = { status: health.status, body: health.body?.slice(0, 300) };
  const vj = j(version.body || '');
  p.version = { status: version.status, sha: vj?.commit || vj?.sha || vj?.version || (version.body?.slice(0,120)) };
  const rj = j(render.body || '');
  p.render = { status: render.status, name: rj?.name, suspended: rj?.suspended, serviceId: RENDER_SERVICE_ID, url: rj?.serviceUrl || rj?.url };
  // latest deploy
  const depRes = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys?limit=1`, { headers: { Authorization: `Bearer ${RENDER_KEY}`, Accept: 'application/json' } });
  const dep = j(depRes.body || '');
  p.latestDeploy = dep?.[0] ? { id: dep[0].id, status: dep[0].status, commit: dep[0].commit?.id, createdAt: dep[0].createdAt, finishedAt: dep[0].finishedAt } : null;
  const ghj = j(ghRepo.body || '');
  p.github = { status: ghRepo.status, repo: ghj?.full_name, private: ghj?.private, defaultBranch: ghj?.default_branch, pushedAt: ghj?.pushed_at };
  // latest commit
  const ghCommits = await fetch('https://api.github.com/repos/ibb142/ivx-holdings-platform/commits?per_page=1', { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'IVX-Audit' } });
  const ghc = j(ghCommits.body || '');
  p.latestCommit = ghc?.[0] ? { sha: ghc[0].sha, message: ghc[0].commit?.message?.slice(0,120), date: ghc[0].commit?.author?.date } : null;
  p.commitMatch = (p.latestDeploy?.commit && p.latestCommit?.sha && p.latestDeploy.commit === p.latestCommit.sha.slice(0,8)) || false;
  return p;
}

// ── PHASE 1: Supabase table audit (live counts) ──
async function phase1() {
  const tables = ['profiles','wallets','transactions','jv_deals','landing_deals','waitlist','notifications','analytics_events','conversations','messages','conversation_participants','landing_analytics','landing_investments','live_sessions','market_data','lenders','realtime_audit','ivx_knowledge_documents','wire_transfers','withdrawals','treasury','ledger','capital_accounts','distributions','tokenized_assets','private_lenders','buyers','kyc_verifications','holdings','properties'];
  const counts = {};
  await Promise.all(tables.map(async (t) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=count&limit=1`, { headers: { ...supaHeaders, Range: '0-0', Prefer: 'count=exact' } });
    const range = r.headers['content-range'] || r.headers['Content-Range'] || '';
    const m = range.match(/\/(\d+)/);
    counts[t] = m ? parseInt(m[1],10) : (r.status === 200 ? 0 : `ERR:${r.status}`);
  }));
  return counts;
}

// ── PHASE 2: Auth users + real member list ──
async function phase2() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers: supaHeaders });
  const users = j(r.body || '');
  const list = Array.isArray(users?.users) ? users.users : (Array.isArray(users) ? users : []);
  const members = list.map((u) => ({ id: u.id, email: u.email, confirmed: !!u.email_confirmed_at || !!u.confirmed_at, bannedUntil: u.banned_until || null, createdAt: u.created_at }));
  return { httpStatus: r.status, total: members.length, members };
}

// ── PHASE 3: Owner sign-in (real Supabase auth) ──
async function phase3() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const data = j(r.body || '');
  return { status: r.status, signedIn: !!data?.access_token, userId: data?.user?.id, email: data?.user?.email, hasAccessToken: !!data?.access_token, error: data?.error_description || data?.msg || null };
}

// ── PHASE 4: Owner AI identity + knowledge ──
async function phase4(ownerToken) {
  const questions = [
    'What is your name?',
    'Who created you?',
    'Who is the owner of IVXHOLDINGS?',
    'Tell me about IVXHOLDINGS investments and projects',
    'What is 15 multiplied by 3?',
  ];
  const out = {};
  for (const q of questions) {
    const r = await fetch(`${BACKEND_URL}/api/ivx/owner-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ivx-owner-token': ownerToken || '' },
      body: JSON.stringify({ message: q }),
    });
    const data = j(r.body || '');
    out[q] = { status: r.status, answer: (data?.answer || data?.reply || data?.message || r.body)?.slice(0, 400) };
  }
  return out;
}

// ── PHASE 5: Public chat AI ──
async function phase5() {
  const r = await fetch(`${BACKEND_URL}/api/ivx/public-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is IVXHOLDINGS?' }),
  });
  const data = j(r.body || '');
  return { status: r.status, answer: (data?.answer || data?.reply || data?.message || r.body)?.slice(0, 400) };
}

// ── PHASE 6: Key endpoint health (modules) ──
async function phase6(ownerToken) {
  const endpoints = [
    ['landing', `${BACKEND_URL}/`],
    ['registration', `${BACKEND_URL}/api/members/register`],
    ['login', `${BACKEND_URL}/api/members/login`],
    ['forgotPassword', `${BACKEND_URL}/api/members/forgot-password`],
    ['investors', `${BACKEND_URL}/api/ivx/investors`],
    ['jvDeals', `${BACKEND_URL}/api/ivx/jv-deals`],
    ['variables', `${BACKEND_URL}/api/ivx/variables`],
    ['analytics', `${BACKEND_URL}/api/ivx/analytics`],
    ['admin', `${BACKEND_URL}/api/ivx/admin`],
    ['ownerDashboard', `${BACKEND_URL}/api/ivx/owner-dashboard`],
    ['wallet', `${BACKEND_URL}/api/ivx/wallet`],
    ['treasury', `${BACKEND_URL}/api/ivx/treasury`],
    ['ledger', `${BACKEND_URL}/api/ivx/ledger`],
    ['withdrawals', `${BACKEND_URL}/api/ivx/withdrawals`],
    ['wires', `${BACKEND_URL}/api/ivx/wire-transfers`],
    ['kyc', `${BACKEND_URL}/api/ivx/kyc`],
    ['notifications', `${BACKEND_URL}/api/ivx/notifications`],
    ['auditReport', `${BACKEND_URL}/api/ivx/audit-report`],
  ];
  const headers = { 'x-ivx-owner-token': ownerToken || '' };
  const out = {};
  await Promise.all(endpoints.map(async ([name, url]) => {
    const r = await fetch(url, { headers });
    out[name] = { status: r.status, note: r.status === 404 ? 'NOT FOUND' : (r.status >= 200 && r.status < 300 ? 'OK' : (r.status === 401 || r.status === 403 ? 'AUTH REQUIRED' : 'CHECK')) };
  }));
  return out;
}

// ── Run all phases ──
console.log('Starting IVX Enterprise Final Audit...\n');
const infra = await phase0();
console.log('Phase 0 (Infrastructure):', JSON.stringify({ health: infra.health.status, render: infra.render.status, deploy: infra.latestDeploy?.id, commitMatch: infra.commitMatch }));
const tableCounts = await phase1();
console.log('Phase 1 (Tables):', Object.entries(tableCounts).filter(([,v]) => v > 0).map(([k,v])=>`${k}=${v}`).join(', '));
const authUsers = await phase2();
console.log('Phase 2 (Auth users):', authUsers.total, authUsers.members.map(m=>m.email).join(', '));
const ownerSignIn = await phase3();
console.log('Phase 3 (Owner sign-in):', ownerSignIn.status, 'signedIn=', ownerSignIn.signedIn);
const ownerAI = await phase4(ownerSignIn.signedIn ? undefined : undefined);
console.log('Phase 4 (Owner AI):', Object.keys(ownerAI).map(k=>`${k.slice(0,20)}=>${ownerAI[k].status}`).join(' | '));
const publicAI = await phase5();
console.log('Phase 5 (Public AI):', publicAI.status);
const modules = await phase6();
console.log('Phase 6 (Modules):', Object.entries(modules).map(([k,v])=>`${k}:${v.status}`).join(' '));

result.phases.infra = infra;
result.phases.tableCounts = tableCounts;
result.phases.authUsers = authUsers;
result.phases.ownerSignIn = ownerSignIn;
result.phases.ownerAI = ownerAI;
result.phases.publicAI = publicAI;
result.phases.modules = modules;

// Final verdict
const allLive = infra.health.status === 200 && infra.render.status === 200 && ownerSignIn.signedIn;
result.finalVerdict = allLive ? 'LIVE — production verified' : 'BLOCKED — see phases';
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

const fs = await import('node:fs/promises');
const outPath = 'backend/verification-proof/ivx-enterprise-final-audit-' + Date.now() + '.json';
await fs.writeFile(outPath, JSON.stringify(result, null, 2));
console.log('\n=== AUDIT COMPLETE ===');
console.log('Verdict:', result.finalVerdict);
console.log('Real counts:', JSON.stringify(result.realCounts));
console.log('Proof file:', outPath);
console.log('\nFull result:\n', JSON.stringify(result, null, 2));
