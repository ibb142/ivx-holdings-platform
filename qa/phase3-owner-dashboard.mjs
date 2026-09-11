import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Live, read-only browser acceptance. No session export, tracing or secret logs.
const api = 'https://api.ivxholding.com';
const app = 'https://chat.ivxholding.com';
const sha = process.env.IVX_TARGET_SHA || process.env.GITHUB_SHA;
const password = ['OWNER_NEW_PASSWORD', 'OWNER_PASSWORD', 'IVX_OWNER_PASSWORD',
  'IVX_OWNER_NEW_PASSWORD', 'OWNER_LOGIN_PASSWORD', 'IVX_OWNER_LOGIN_PASSWORD']
  .map(key => process.env[key]).find(Boolean);
assert.match(sha || '', /^[a-f0-9]{40}$/);
assert(password, 'Protected Owner password binding is missing');
const checks = [];
const samples = [];
const output = 'qa/evidence/phase3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
let latest;
const recent = [];
function observe(dashboard) {
  if (dashboard?.fleetSignals && dashboard.backendCommitSha === sha
      && (!latest || dashboard.generatedAt >= latest.generatedAt)) {
    latest = dashboard;
    recent.push(dashboard);
    if (recent.length > 20) recent.shift();
  }
}
page.on('response', async response => {
  if (response.url().startsWith(api + '/api/ivx/live-work/agents?') && response.ok()) {
    try { observe((await response.json()).dashboard); } catch { /* No incomplete response is evidence. */ }
  }
});
page.on('websocket', socket => socket.on('framereceived', event => {
  try { const message = JSON.parse(String(event.payload)); if (message.type === 'snapshot') observe(message.dashboard); } catch { /* Ignore transport control frames. */ }
}));
async function health() {
  const response = await fetch(api + '/health', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commit, sha, 'Production SHA changed during proof');
}
async function capture(label) {
  await page.waitForFunction(() => document.body.innerText.includes('QA OBSERVATIONS'), undefined, { timeout: 45_000 });
  assert(latest, 'No real dashboard response observed');
  const rendered = await page.locator('[data-testid^="enterprise-agent-"]').evaluateAll(elements => elements.map(element => ({
    number: Number(element.getAttribute('data-testid').replace('enterprise-agent-', '')), text: element.innerText,
  })));
  const data = structuredClone([...recent].reverse().find(dashboard => dashboard.agents.every(agent => {
    const row = rendered.find(item => item.number === agent.agentNumber);
    return row && (!agent.signals?.observation || row.text.includes(agent.signals.observation.evidenceId));
  })));
  assert(data, 'Rendered observations do not reconcile with any received dashboard snapshot');
  assert.equal(data.backendCommitSha, sha);
  assert.equal(data.enterprise112?.ledgerOk, true);
  assert.equal(data.agents.length, 112);
  assert.equal(new Set(data.agents.map(agent => agent.agentId)).size, 112);
  assert.deepEqual(data.agents.map(agent => agent.agentNumber).sort((a,b) => a-b), Array.from({length:112},(_,i)=>i+1));
  assert.equal(data.fleetSignals.status, 'AVAILABLE');
  assert(Date.now() - Date.parse(data.fleetSignals.measuredAt) < 15_000, 'Dashboard sample is stale');
  assert.equal(await page.locator('[data-testid^="enterprise-agent-"]').count(), 112);
  const metrics = await page.getByTestId('fleet-independent-signals').innerText();
  for (const name of ['Registry', 'Running leases', 'QA observed', 'Model requests sampled', 'Model queue sampled', 'Repair jobs sampled']) assert(metrics.includes(name), `Missing independent metric: ${name}`);
  // Require a persisted observation to appear in its actual identity's card.
  for (const agent of data.agents) {
    const row = rendered.find(item => item.number === agent.agentNumber).text;
    assert(row.includes(agent.name), `Identity ${agent.agentNumber} rendered incorrectly`);
    assert(row.includes('Control:'), `Control state missing for ${agent.agentNumber}`);
    assert(row.includes('QA source:'), `Source freshness missing for ${agent.agentNumber}`);
  }
  samples.push({ label, generatedAt: data.generatedAt, measuredAt: data.fleetSignals.measuredAt,
    backendCommitSha: sha, counts: data.fleetSignals.counts, execution: data.fleetSignals.execution,
    history: data.history, agents: data.agents.map(a => ({ agentNumber:a.agentNumber, agentId:a.agentId, signals:a.signals })) });
  await page.getByTestId('fleet-independent-signals').screenshot({ path: `${output}/dashboard-${label}.png` });
  checks.push(`${label}: 112 distinct rendered rows; live durable same-SHA dashboard; separate execution counters and source freshness`);
}
try {
  await health();
  await page.goto(app + '/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId('login-email').fill(process.env.OWNER_EMAIL || 'iperez4242@gmail.com');
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  checks.push('Real Owner password submitted through production login UI');
  await page.goto(app + '/ivx/autonomous-ops', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await capture('A');
  await context.setOffline(true);
  await page.getByText('PRODUCTIVITY UNKNOWN', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  assert((await page.getByTestId('fleet-independent-signals').innerText()).includes('UNKNOWN'));
  checks.push('Disconnected browser expires its last sample instead of displaying stale work as current');
  await context.setOffline(false);
  await page.getByText('PRODUCTIVITY UNKNOWN', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 });
  await capture('B');
  assert(Date.parse(samples[1].measuredAt) > Date.parse(samples[0].measuredAt));
  await health();
  checks.push('Fresh telemetry recovered after browser reconnection');
} catch (error) {
  process.exitCode = 1;
  checks.push({ failed: error instanceof Error ? error.message.replaceAll(password, '[redacted]') : 'Browser proof failed' });
} finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
  const result = { item:'9.5', passed:!process.exitCode, sourceSha:sha, observedAt:new Date().toISOString(), checks, samples,
    noProductionMutation:true, secretValuesReturned:false, continuity24x7Certified:false };
  await writeFile(`${output}/owner-dashboard.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, samples: samples.map(({agents,...sample})=>({...sample,identities:agents.length})) }));
}
