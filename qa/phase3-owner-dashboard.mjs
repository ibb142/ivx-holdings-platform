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
const transport = [];
const sessionReload = { item: '16.1', passed: false, backendSha: sha,
  startedAt: null, completedAt: null, persistedBeforeReload: false,
  identityVerifiedAfterReload: false, ownerControlsAccessible: false,
  error: null, secretValuesReturned: false };
function recordTransport(value) {
  transport.push({ observedAt:new Date().toISOString(), ...value });
  if (transport.length > 60) transport.shift();
}
const output = 'qa/evidence/phase3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let disconnected=false;
const transports=new Set();
await context.routeWebSocket('**/api/ivx/autonomous-dashboard-stream', socket=>{
  if(disconnected){socket.close({code:1001,reason:'Network interruption proof'});return;}
  const server=socket.connectToServer();
  transports.add({socket,server});
});
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
  if (response.url().startsWith(api + '/api/ivx/live-work/agents?')) {
    recordTransport({type:'dashboard_http',status:response.status()});
    if (response.ok()) {
      try {
        const body=await response.json();
        recordTransport({type:'dashboard_payload',ok:body.ok,sourceSha:body.dashboard?.backendCommitSha,
          status:body.dashboard?.fleetSignals?.status,measuredAt:body.dashboard?.fleetSignals?.measuredAt});
        observe(body.dashboard);
      } catch { /* No incomplete response is evidence. */ }
    }
  }
});
page.on('requestfailed', request => {
  if (request.url().startsWith(api + '/api/ivx/live-work/agents?')) recordTransport({type:'dashboard_request_failed'});
});
page.on('websocket', socket => socket.on('framereceived', event => {
  try { const message = JSON.parse(String(event.payload)); if (message.type === 'snapshot') {
    recordTransport({type:'dashboard_websocket_snapshot',sourceSha:message.dashboard?.backendCommitSha,
      status:message.dashboard?.fleetSignals?.status,measuredAt:message.dashboard?.fleetSignals?.measuredAt});
    observe(message.dashboard);
  } } catch { /* Ignore transport control frames. */ }
}));
async function health() {
  const response = await fetch(api + '/health', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commit, sha, 'Production SHA changed during proof');
}
async function verifyOwnerSessionReload() {
  sessionReload.startedAt = new Date().toISOString();
  const storageKey = 'sb-kvclcdjmjghndxsngfzb-auth-token';
  // Wait for the completed client persistence operation, not just a redirect.
  // The browser returns identity only; tokens never leave its storage.
  await page.waitForFunction(key => {
    try {
      const session = JSON.parse(localStorage.getItem(key) || 'null');
      return !!(session?.user?.id && session.access_token && session.refresh_token
        && session.expires_at * 1000 > Date.now() + 5000);
    } catch { return false; }
  }, storageKey, { timeout: 45_000 });
  const identity = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).user.id, storageKey);
  sessionReload.persistedBeforeReload = true;
  await page.waitForLoadState('networkidle', { timeout: 45_000 });

  // Observe a fresh authority verification caused by the reload. A cached UI
  // or a stored identity alone cannot make this acceptance pass.
  const verification = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === 'https://kvclcdjmjghndxsngfzb.supabase.co'
      && url.pathname === '/auth/v1/user'
      && response.request().method() === 'GET';
  }, { timeout: 60_000 }).then(async response => {
    if (response.status() !== 200) return false;
    return (await response.json()).id === identity;
  }).catch(() => false);
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
  assert.equal(await verification, true, 'OWNER_RELOAD_AUTHORITY_NOT_VERIFIED');
  sessionReload.identityVerifiedAfterReload = true;
  await page.getByTestId('home-runtime-ready').waitFor({ state: 'visible', timeout: 60_000 });
  assert.equal(await page.getByTestId('login-submit').count(), 0, 'OWNER_RELOAD_RETURNED_TO_LOGIN');
  await page.waitForFunction(({ key, expected }) => {
    try {
      const session = JSON.parse(localStorage.getItem(key) || 'null');
      return session?.user?.id === expected && !!session.access_token && !!session.refresh_token;
    } catch { return false; }
  }, { key: storageKey, expected: identity }, { timeout: 45_000 });
  await health();
  checks.push('Owner reload retained persisted identity and received fresh Supabase verification');
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
  await page.getByTestId('home-runtime-ready').waitFor({state:'visible'});
  checks.push('Real Owner password submitted through production login UI');
  await verifyOwnerSessionReload();
  await page.getByTestId('tab-profile').click();
  await page.getByText('Admin Panel', {exact:true}).click();
  await page.getByTestId('admin-autonomous-live-work-btn').waitFor({ state: 'visible' });
  sessionReload.ownerControlsAccessible = true;
  sessionReload.passed = true;
  sessionReload.completedAt = new Date().toISOString();
  await page.getByTestId('admin-autonomous-live-work-btn').click();
  await page.getByTestId('autonomous-control-ops').click();
  await page.waitForURL(url => url.pathname === '/ivx/autonomous-ops');
  checks.push('Owner reached Ops through Profile, Admin Panel and Autonomous Live Work controls');
  await capture('A');
  disconnected=true;
  await context.setOffline(true);
  // Existing WebSockets can survive Chromium's HTTP offline switch. Close the
  // real transport as well; never fabricate snapshots or advance the clock.
  for(const {socket,server} of transports){server.close();socket.close({code:1001,reason:'Network interruption proof'});}
  transports.clear();
  await page.getByText('PRODUCTIVITY UNKNOWN', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  assert((await page.getByTestId('fleet-independent-signals').innerText()).includes('UNKNOWN'));
  checks.push('Disconnected browser expires its last sample instead of displaying stale work as current');
  disconnected=false;
  await context.setOffline(false);
  await page.getByText('PRODUCTIVITY UNKNOWN', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 });
  await capture('B');
  assert(Date.parse(samples[1].measuredAt) > Date.parse(samples[0].measuredAt));
  await health();
  checks.push('Fresh telemetry recovered after browser reconnection');
} catch (error) {
  process.exitCode = 1;
  if (!sessionReload.passed) {
    sessionReload.error = error?.message?.match(/OWNER_RELOAD_[A-Z_]+/)?.[0] || 'OWNER_RELOAD_ACCEPTANCE_FAILED';
  }
  checks.push({ failed: error instanceof Error ? error.message.replaceAll(password, '[redacted]') : 'Browser proof failed' });
  // Record only known UI states and transport metadata, never cookies, tokens,
  // input values, the complete page text, or arbitrary response bodies.
  const visibleState=await page.evaluate(()=>({path:location.pathname,
    rows:document.querySelectorAll('[data-testid^="enterprise-agent-"]').length,
    metrics:!!document.querySelector('[data-testid="fleet-independent-signals"]'),
    signIn:!!document.querySelector('[data-testid="login-submit"]'),
    labels:['PRODUCTIVITY UNKNOWN','QA OBSERVATIONS','Access denied','Loading secure session',
      'Dashboard unavailable','Something went wrong','authenticated Autonomous telemetry'].filter(label=>document.body.innerText.includes(label))
  })).catch(()=>({unavailable:true}));
  checks.push({visibleState,transport,receivedMatchingSnapshots:recent.length});
} finally {
  disconnected=false;
  await context.setOffline(false).catch(() => {});
  await browser.close();
  sessionReload.completedAt ??= new Date().toISOString();
  await writeFile(`${output}/owner-session-reload.json`, JSON.stringify(sessionReload, null, 2));
  const result = { item:'9.5', passed:!process.exitCode, sourceSha:sha, observedAt:new Date().toISOString(), checks, samples,
    noProductionMutation:true, secretValuesReturned:false, continuity24x7Certified:false };
  await writeFile(`${output}/owner-dashboard.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, samples: samples.map(({agents,...sample})=>({...sample,identities:agents.length})) }));
}
