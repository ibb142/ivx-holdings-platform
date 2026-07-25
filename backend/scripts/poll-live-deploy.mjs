import https from 'node:https';
import fs from 'node:fs/promises';

const RENDER_KEY = process.env.RENDER_API_KEY || '';
const BACKEND_SVC = 'srv-d7t9ivreo5us73ftose0';
const FRONTEND_SVC = 'srv-d7t9j00sfn5c738a18j0';
const BACKEND_URL = 'https://api.ivxholding.com';
const FRONTEND_URL = 'https://chat.ivxholding.com';
const EXPECTED_SHA = (process.env.EXPECTED_SHA || '8720b10').slice(0, 7);
const SHORT_SHA = EXPECTED_SHA.slice(0, 7);

function fetch(url, opts = {}, timeout = 15000) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getDeploy(serviceId) {
  const r = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, { headers: { Authorization: `Bearer ${RENDER_KEY}`, Accept: 'application/json' } });
  const arr = j(r.body || '[]');
  const first = Array.isArray(arr) && arr[0] ? arr[0] : null;
  const dep = first?.deploy || first;
  return dep ? { id: dep.id, status: dep.status, commit: dep.commit?.id, message: dep.commit?.message, createdAt: dep.createdAt, finishedAt: dep.finishedAt } : null;
}

async function getBackendHealth() {
  const r = await fetch(`${BACKEND_URL}/health`);
  const data = j(r.body || '{}');
  return { status: r.status, body: data, text: r.body?.slice(0, 200) };
}

async function getBackendVersion() {
  const r = await fetch(`${BACKEND_URL}/api/ivx/version`);
  const data = j(r.body || '{}');
  return { status: r.status, sha: data?.commit || data?.version || data?.sha || r.body?.slice(0, 120) };
}

async function getFrontendRoot() {
  const r = await fetch(`${FRONTEND_URL}/`);
  return { status: r.status, text: r.body?.slice(0, 120) };
}

async function main() {
  const result = { timestamp: new Date().toISOString(), expectedSha: EXPECTED_SHA, polls: [], live: false };
  let live = false;
  for (let i = 0; i < 10; i++) {
    const backendDeploy = await getDeploy(BACKEND_SVC);
    const frontendDeploy = await getDeploy(FRONTEND_SVC);
    const backendHealth = await getBackendHealth();
    const backendVersion = await getBackendVersion();
    const frontendRoot = await getFrontendRoot();

    const backendCommitMatch = backendVersion.sha === EXPECTED_SHA || backendVersion.sha?.startsWith(SHORT_SHA) || backendDeploy?.commit === EXPECTED_SHA || backendHealth.body?.commit?.startsWith(EXPECTED_SHA) || backendHealth.body?.commit?.startsWith(SHORT_SHA);
    const backendHealthy = backendHealth.status === 200;
    const backendDeployLive = backendDeploy?.status === 'live';
    const frontendDeployLive = frontendDeploy?.status === 'live';
    const frontendHealthy = frontendRoot.status === 200;

    const poll = {
      iteration: i,
      backendDeploy: { id: backendDeploy?.id, status: backendDeploy?.status, commit: backendDeploy?.commit },
      frontendDeploy: { id: frontendDeploy?.id, status: frontendDeploy?.status, commit: frontendDeploy?.commit },
      backendHealth: { status: backendHealth.status, sha: backendVersion.sha, commitMatch: backendCommitMatch },
      frontendRoot: { status: frontendRoot.status, healthy: frontendHealthy },
    };
    result.polls.push(poll);

    if (backendDeployLive && frontendDeployLive && backendHealthy && frontendHealthy && backendCommitMatch) {
      result.live = true;
      result.backendDeploy = backendDeploy;
      result.frontendDeploy = frontendDeploy;
      result.backendHealth = backendHealth;
      result.backendVersion = backendVersion;
      result.frontendRoot = frontendRoot;
      live = true;
      break;
    }
    await sleep(5000);
  }

  const outPath = 'backend/verification-proof/ivx-deploy-poll-' + Date.now() + '.json';
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(live ? 'LIVE' : 'NOT YET LIVE', JSON.stringify({ backendDeploy: result.polls.at(-1)?.backendDeploy, frontendDeploy: result.polls.at(-1)?.frontendDeploy, backendHealth: result.polls.at(-1)?.backendHealth, frontendRoot: result.polls.at(-1)?.frontendRoot }, null, 2));
  console.log('Proof:', outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
