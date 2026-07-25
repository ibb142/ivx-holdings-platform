#!/usr/bin/env node
/**
 * IVX GitHub Token Fixer — updates GITHUB_TOKEN on both Render services
 * and restarts them. Run with: GITHUB_TOKEN=your_new_token node fix-github-token.mjs
 *
 * The token is read from process.env.GITHUB_TOKEN and pushed directly to
 * Render's env-vars API. It is never logged, never written to disk, never
 * stored in source. The old expired token is overwritten in-place.
 */
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
if (!RENDER_API_KEY) {
  console.error('ERROR: RENDER_API_KEY env var is empty.');
  console.error('Usage: RENDER_API_KEY=rnd_xxx... GITHUB_TOKEN=ghp_xxx... node fix-github-token.mjs');
  process.exit(1);
}
const API_SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const WORKER_SERVICE_ID = 'srv-d9i15fg4n6ts73bn00j0';
const RENDER_API = 'https://api.render.com/v1';

const newToken = (process.env.GITHUB_TOKEN || '').trim();

if (!newToken) {
  console.error('ERROR: GITHUB_TOKEN env var is empty.');
  console.error('Usage: GITHUB_TOKEN=ghp_xxx... node fix-github-token.mjs');
  process.exit(1);
}

if (newToken.length < 20) {
  console.error(`ERROR: Token too short (${newToken.length} chars). Expected 40+ chars.`);
  process.exit(1);
}

console.log(`Token received: ${newToken.length} chars, prefix ${newToken.slice(0, 6)}...`);

async function updateEnvVar(serviceId, serviceName) {
  console.log(`\n--- Updating ${serviceName} (${serviceId}) ---`);

  // 1. Verify the token works against GitHub API first
  const authRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${newToken}`, 'User-Agent': 'IVX-Fix' },
  });
  if (!authRes.ok) {
    const body = await authRes.json().catch(() => ({}));
    console.error(`FAIL: GitHub rejected token — HTTP ${authRes.status}: ${body.message || 'unknown'}`);
    process.exit(1);
  }
  const user = await authRes.json();
  console.log(`GitHub auth: PASS (login: ${user.login})`);

  // 2. Verify repo access
  const repoRes = await fetch('https://api.github.com/repos/ibb142/ivx-holdings-platform', {
    headers: { Authorization: `token ${newToken}`, 'User-Agent': 'IVX-Fix' },
  });
  if (!repoRes.ok) {
    const body = await repoRes.json().catch(() => ({}));
    console.error(`FAIL: Cannot access repo — HTTP ${repoRes.status}: ${body.message || 'unknown'}`);
    process.exit(1);
  }
  const repo = await repoRes.json();
  console.log(`Repo access: PASS (${repo.full_name}, push: ${repo.permissions?.push})`);

  // 3. Update GITHUB_TOKEN on Render
  const updateRes = await fetch(
    `${RENDER_API}/services/${serviceId}/env-vars/GITHUB_TOKEN`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'GITHUB_TOKEN', value: newToken }),
    },
  );
  if (!updateRes.ok) {
    const body = await updateRes.text();
    console.error(`FAIL: Render env update — HTTP ${updateRes.status}: ${body}`);
    process.exit(1);
  }
  console.log(`Render env update: PASS`);

  // 4. Also ensure GITHUB_REPO_URL is correct
  const urlRes = await fetch(
    `${RENDER_API}/services/${serviceId}/env-vars/GITHUB_REPO_URL`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: 'GITHUB_REPO_URL',
        value: 'https://github.com/ibb142/ivx-holdings-platform',
      }),
    },
  );
  if (urlRes.ok) {
    console.log(`GITHUB_REPO_URL confirmed: PASS`);
  }

  // 5. Restart the service to pick up new env
  const restartRes = await fetch(`${RENDER_API}/services/${serviceId}/restart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RENDER_API_KEY}` },
  });
  if (restartRes.ok) {
    console.log(`Service restart: PASS`);
  } else {
    console.error(`WARN: Restart returned HTTP ${restartRes.status}`);
  }
}

async function verifyProduction() {
  console.log('\n--- Waiting for restart (30s) ---');
  await new Promise((r) => setTimeout(r, 30000));

  console.log('Checking production /health...');
  const res = await fetch('https://api.ivxholding.com/health');
  const d = await res.json();
  const s = d.seniorDeveloperRuntime || {};
  const g = s.github || {};

  console.log(`\n=== PRODUCTION VERIFICATION ===`);
  console.log(`Status: ${d.status}`);
  console.log(`Boot: ${d.bootTime}`);
  console.log(`Commit: ${(d.commit || '').slice(0, 16)}`);
  console.log(`GitHub canReadRepo: ${g.canReadRepo}`);
  console.log(`GitHub canPush: ${g.canPush}`);
  console.log(`Render canDeploy: ${s.render?.canDeploy}`);
  console.log(`Blockers: ${(s.blockers || []).length}`);
  for (const b of s.blockers || []) {
    console.log(`  → ${b.slice(0, 100)}`);
  }

  if (g.canReadRepo && g.canPush) {
    console.log('\n✅ 401 ISSUE RESOLVED — GitHub stage is LIVE');
    console.log('✅ Autonomous deploy flow is UNBLOCKED end-to-end');
  } else {
    console.log('\n❌ 401 still present — check token scopes/permissions');
  }
}

async function main() {
  await updateEnvVar(API_SERVICE_ID, 'IVX API (ivx-holdings-platform)');
  await updateEnvVar(WORKER_SERVICE_ID, 'IVX Worker (ivx-senior-dev-01)');
  await verifyProduction();
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
