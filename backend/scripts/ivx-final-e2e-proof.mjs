import https from 'node:https';
import fs from 'node:fs/promises';

const SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RENDER_KEY = process.env.RENDER_API_KEY || '';
const BACKEND_SVC = 'srv-d7t9ivreo5us73ftose0';
const FRONTEND_SVC = 'srv-d7t9j00sfn5c738a18j0';
const BACKEND_URL = 'https://api.ivxholding.com';
const FRONTEND_URL = 'https://chat.ivxholding.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const OWNER_TOKEN = process.env.IVX_OWNER_TOKEN || '';

function fetch(url, opts = {}, timeout = 20000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers || {}, timeout }, (res) => {
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
const ownerHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OWNER_TOKEN}` };

async function getDeploy(serviceId) {
  const r = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, { headers: { Authorization: `Bearer ${RENDER_KEY}`, Accept: 'application/json' } });
  const arr = j(r.body || '[]');
  const first = Array.isArray(arr) && arr[0] ? arr[0] : null;
  const dep = first?.deploy || first;
  return dep ? { id: dep.id, status: dep.status, commit: dep.commit?.id, message: dep.commit?.message, createdAt: dep.createdAt, finishedAt: dep.finishedAt } : null;
}

async function count(table) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=count&limit=1`, { headers: { ...supaHeaders, Range: '0-0', Prefer: 'count=exact' } });
  const range = r.headers['content-range'] || r.headers['Content-Range'] || '';
  const m = range.match(/\/(\d+)/);
  return m ? parseInt(m[1], 10) : (r.status === 200 ? 0 : `ERR:${r.status}`);
}

async function getJson(path, headers = {}) {
  const r = await fetch(`${BACKEND_URL}${path}`, { headers });
  return { status: r.status, body: j(r.body || '{}'), text: r.body?.slice(0, 300) };
}

async function postJson(path, payload, headers = {}) {
  const r = await fetch(`${BACKEND_URL}${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: r.status, body: j(r.body || '{}'), text: r.body?.slice(0, 300) };
}

async function main() {
  const result = { timestamp: new Date().toISOString() };

  result.github = await fetch('https://api.github.com/repos/ibb142/ivx-holdings-platform/commits?per_page=1', { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'IVX-Audit' } });
  const ghCommits = j(result.github.body || '[]');
  result.latestCommit = ghCommits?.[0] ? { sha: ghCommits[0].sha, message: ghCommits[0].commit?.message?.slice(0, 120), date: ghCommits[0].commit?.author?.date } : null;

  result.backendDeploy = await getDeploy(BACKEND_SVC);
  result.frontendDeploy = await getDeploy(FRONTEND_SVC);

  result.health = await fetch(`${BACKEND_URL}/health`);
  result.version = await fetch(`${BACKEND_URL}/api/ivx/version`);
  result.frontendRoot = await fetch(`${FRONTEND_URL}/`);

  const tables = ['members', 'investors', 'buyers', 'waitlist', 'wallets', 'transactions', 'ledger', 'treasury', 'data_vault', 'jv_deals', 'profiles', 'properties', 'analytics_events', 'messages', 'conversations'];
  result.counts = {};
  await Promise.all(tables.map(async (t) => { result.counts[t] = await count(t); }));

  const auth = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: supaHeaders });
  const authData = j(auth.body || '{}');
  result.authUsers = { total: Array.isArray(authData?.users) ? authData.users.length : 0, emails: (Array.isArray(authData?.users) ? authData.users : []).map((u) => u.email) };

  result.ownerAI = await postJson('/api/ivx/owner-ai', { message: 'hello' }, ownerHeaders);
  result.publicChat = await postJson('/api/chat', { message: 'What is IVXHOLDINGS?' }, {});

  result.restoreCenterOverview = await getJson('/api/ivx/restore-center/overview', ownerHeaders);
  result.dataVaultStatus = await getJson('/api/ivx/data-vault/status', ownerHeaders);
  result.dataGuardAudit = await getJson('/api/ivx/data-guard/audit', ownerHeaders);
  result.restoreCenterPitr = await getJson('/api/ivx/restore-center/pitr', ownerHeaders);
  result.restoreCenterProtectedTables = await getJson('/api/ivx/restore-center/protected-tables', ownerHeaders);
  result.restoreCenterDrill = await postJson('/api/ivx/restore-center/drill', {}, ownerHeaders);
  result.restoreCenterReport = await getJson('/api/ivx/restore-center/report', ownerHeaders);

  const live = result.backendDeploy?.status === 'live' && result.frontendDeploy?.status === 'live' && result.health.status === 200 && result.frontendRoot.status === 200;
  result.live = live;
  result.finalStatus = live ? 'DEPLOYED_END_TO_END_LIVE' : 'DEPLOY_INCOMPLETE';

  const outPath = 'backend/verification-proof/ivx-e2e-deploy-final-proof-' + Date.now() + '.json';
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ live, backendDeploy: result.backendDeploy, frontendDeploy: result.frontendDeploy, counts: result.counts, authUsers: result.authUsers, ownerAI: result.ownerAI.status, publicChat: result.publicChat.status, restoreCenter: result.restoreCenterOverview.status, dataVault: result.dataVaultStatus.status }, null, 2));
  console.log('Proof:', outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
