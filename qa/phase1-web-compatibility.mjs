import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeOwnerResponse } from './phase1-owner-response-proof.mjs';

// Production acceptance: no request mocking, no fabricated replies, no trace/session export.
const API = 'https://api.ivxholding.com';
const APP = 'https://chat.ivxholding.com';
const AUTH = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const target = process.env.IVX_TARGET_SHA;
const password = process.env.IVX_QA_OWNER_PASSWORD;
const anon = process.env.SUPABASE_ANON_KEY;
assert.match(target || '', /^[a-f0-9]{40}$/);
assert(password && anon, 'Protected QA bindings are required');
const output = 'qa-results/phase1-web-compatibility';
await mkdir(output, { recursive: true });
const receipt = { item: '1.5', passed: false, startedAt: new Date().toISOString(),
  workflowSha: process.env.GITHUB_SHA, applicationSha: target, checks: [], errors: [],
  ownerTransport: [], sessionCleanup: null, noApplicationDeployment: true };
function checkpoint() {
  return writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2));
}
const pass = (name, detail = {}) => {
  const check = { name, at: new Date().toISOString(), ...detail };
  receipt.checks.push(check);
  console.log(JSON.stringify({ check }));
};
async function readiness(label) {
  for (const path of ['/health', '/version', '/health/ready']) {
    const response = await fetch(API + path, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    assert.equal(response.status, 200, `${label}: ${path} unavailable`);
    const body = await response.json();
    assert.equal(body.ok, true, `${label}: ${path} not healthy`);
    if (path === '/health/ready') {
      for (const key of ['ai', 'database', 'auth', 'queue']) assert.equal(body.checks?.[key]?.ok, true, `${key} not ready`);
      const workers = body.checks.queue.workers || [];
      assert(workers.length > 0, 'No real worker heartbeat');
      for (const worker of workers) {
        assert.equal(worker.source_sha, target, 'Worker SHA mismatch');
        assert(Date.now() - Date.parse(worker.last_seen_at) < 60_000, 'Stale worker heartbeat');
      }
      pass(`${label}_dependencies_ready`, { workers: workers.map(w => ({ id: w.worker_id, instance: w.instance_id,
        sha: w.source_sha, lastSeenAt: w.last_seen_at })), databaseMs: body.checks.database.latencyMs,
        authMs: body.checks.auth.latencyMs });
    } else {
      assert.equal(body.commit, target, 'Application SHA changed');
      pass(`${label}_${path.slice(1)}`, { sha: body.commit, bootTime: body.bootTime });
    }
  }
}

const marker = `maple_${randomUUID().replaceAll('-', '')}`;
receipt.marker = marker;
await checkpoint();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
const pending = [];
let ownerSession = null;
let ownerReply = null;
let stage = 'preflight';
// Passive wire observation keeps final SSE frames even when the application
// cancels its reader after the final envelope. It never changes requests/replies.
const wire = new Map();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable', { maxTotalBufferSize: 5_000_000, maxResourceBufferSize: 1_000_000, maxPostDataSize: 300_000 });
cdp.on('Network.requestWillBeSent', e => {
  if (e.request.url.startsWith(API + '/api/ivx/owner-ai') && e.request.method === 'POST'
      && (e.request.postData || '').includes(marker)) wire.set(e.requestId, {
    path: new URL(e.request.url).pathname, chunks: [], status: null,
  });
});
cdp.on('Network.responseReceived', e => {
  const entry = wire.get(e.requestId);
  if (!entry) return;
  entry.status = e.response.status;
  entry.mime = e.response.mimeType;
  pending.push(cdp.send('Network.streamResourceContent', { requestId: e.requestId }).then(result => {
    if (result.bufferedData) entry.chunks.unshift(Buffer.from(result.bufferedData, 'base64').toString('utf8'));
  }).catch(() => { entry.captureUnavailable = true; }));
});
cdp.on('Network.dataReceived', e => {
  const entry = wire.get(e.requestId);
  if (entry && e.data) entry.chunks.push(Buffer.from(e.data, 'base64').toString('utf8'));
});
page.on('response', response => {
  const url = response.url();
  if (url.startsWith(AUTH + '/auth/v1/token?grant_type=password') && response.status() === 200) {
    pending.push(response.json().then(async body => {
      assert.equal(body.user?.email?.toLowerCase(), 'iperez4242@gmail.com');
      assert(body.access_token, 'No Auth session');
      ownerSession = body.access_token;
      pass('owner_password_grant_from_login_ui', { http: 200 });
      await checkpoint();
    }).catch(() => { receipt.errors.push({ stage: 'auth_observation', message: 'Could not inspect the login session' }); }));
  }
  const req = response.request();
  if (!url.startsWith(API + '/api/ivx/owner-ai') || req.method() !== 'POST'
      || !(req.postData() || '').includes(marker)) return;
  pending.push((async () => {
    const mime = response.headers()['content-type'] || '';
    const observation = { path: new URL(url).pathname, status: response.status(), mime };
    receipt.ownerTransport.push(observation);
    let body;
    try { body = await response.text(); }
    catch { observation.bodyUnavailable = true; await checkpoint(); return; }
    if (mime.includes('text/event-stream')) {
      const canonical = decodeOwnerResponse(body, marker);
      if (canonical.valid) ownerReply = canonical.answer;
      observation.canonical = { ...canonical, answer: undefined };
      const frames = body.split('\n').filter(l => l.startsWith('data: ')).flatMap(l => {
        try { return [JSON.parse(l.slice(6))]; } catch { return []; }
      });
      const done = frames.find(f => f.type === 'done');
      observation.events = frames.map(f => f.type).filter((v,i,a) => a.indexOf(v) === i);
      observation.requestId = frames.find(f => f.type === 'start')?.requestId;
      observation.usage = done?.usage ?? null;
      observation.error = frames.find(f => f.type === 'error')?.error ? 'provider_stream_error' : null;
      if (done?.text?.includes(marker)) ownerReply = done.text;
    } else {
      let data = {}; try { data = JSON.parse(body); } catch { /* invalid response fails below */ }
      observation.provider = data.provider;
      observation.model = data.model;
      observation.requestId = data.requestId;
      observation.fallback = data.fallback ?? data.providerError ?? null;
      const answer = data.answer ?? data.text ?? '';
      if (answer.includes(marker) && !/fallback|error/.test(data.model || '')) ownerReply = answer;
    }
    await checkpoint();
  })().catch(() => { receipt.errors.push({ stage: 'transport_observation', message: 'Response evidence could not be read' }); }));
});

try {
  await readiness('before');
  stage = 'canonical_domain';
  const landing = await context.newPage();
  const www = await landing.goto('https://www.ivxholding.com/?phase1=15#properties', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await landing.waitForURL('https://ivxholding.com/?phase1=15#properties');
  await landing.locator('#properties-grid').waitFor({ state: 'visible' });
  pass('www_canonical_navigation', { requestHttp: www?.status(), finalUrl: landing.url(),
    redirectMechanism: www?.status() === 200 ? 'client_side' : 'http_redirect' });
  await landing.close();

  stage = 'owner_login';
  const document = await page.goto(APP + '/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  assert.equal(document.status(), 200);
  receipt.frontend = { url: APP, documentSha256: createHash('sha256').update(await document.body()).digest('hex'),
    scripts: await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => n.src)) };
  await page.getByTestId('login-email').fill('iperez4242@gmail.com');
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.getByTestId('home-runtime-ready').waitFor({ state: 'visible' });
  await Promise.all(pending);
  assert(ownerSession, 'The UI did not establish a verified Supabase password session');
  pass('owner_home_rendered', { path: new URL(page.url()).pathname });

  stage = 'owner_chat_navigation';
  await page.getByTestId('tab-chat').click();
  await page.getByTestId('chat-open-message-room').click();
  await page.waitForURL(url => url.pathname === '/ivx/chat');
  await page.getByTestId('ivx-owner-chat-input').waitFor({ state: 'visible' });
  pass('owner_chat_reached_via_ui', { path: '/ivx/chat' });

  stage = 'owner_chat_provider_reply';
  await page.getByTestId('ivx-owner-chat-input').fill(`For this harmless response check, reply with exactly this text: ${marker}`);
  await page.getByTestId('ivx-owner-chat-send').click();
  await checkpoint();
  const rows = page.locator('[data-testid^="ivx-owner-message-"]').filter({ hasText: marker });
  await page.waitForFunction(value => [...document.querySelectorAll('[data-testid^="ivx-owner-message-"]')]
    .filter(e => e.textContent.includes(value)).length >= 2, marker, { timeout: 180_000 });
  await Promise.all(pending);
  for (const entry of wire.values()) {
    const decoded = decodeOwnerResponse(entry.chunks.join(''), marker);
    receipt.ownerTransport.push({ source: 'passive_browser_network', path: entry.path, status: entry.status,
      mime: entry.mime, captureUnavailable: entry.captureUnavailable || false, ...decoded, answer: undefined });
    if (entry.status === 200 && decoded.valid) ownerReply = decoded.answer;
  }
  assert(ownerReply?.includes(marker), 'No completed backend reply matching the new marker');
  assert(receipt.ownerTransport.some(r => r.status === 200 && !r.error && !r.fallback), 'Backend response not successful');
  const reply = rows.last();
  assert((await reply.innerText()).includes(marker));
  await reply.screenshot({ path: `${output}/owner-reply.png` });
  pass('owner_reply_visible_and_received_from_backend', { marker, matchingRows: await rows.count(),
    replySha256: createHash('sha256').update(ownerReply).digest('hex') });
  await readiness('after');
  assert.equal(receipt.errors.length, 0, 'Evidence collector reported an error');
  receipt.passed = true;
} catch (error) {
  receipt.errors.push({ stage, message: String(error.message).replaceAll(password, '[redacted]').slice(0,1200) });
  receipt.visibleState = await page.evaluate(() => ({ path: location.pathname,
    login: !!document.querySelector('[data-testid="login-submit"]'),
    home: !!document.querySelector('[data-testid="home-runtime-ready"]'),
    chat: !!document.querySelector('[data-testid="ivx-owner-chat-input"]'),
    labels: ['Access denied', 'Sign In', 'Loading secure session', 'Opening Chat', 'Service unavailable',
      'Unable to send', 'Please try again'].filter(t => document.body.innerText.includes(t)) })).catch(() => ({ unavailable: true }));
} finally {
  await Promise.allSettled(pending);
  if (ownerSession) {
    try {
      const response = await fetch(AUTH + '/auth/v1/logout?scope=local', { method: 'POST',
        headers: { apikey: anon, authorization: `Bearer ${ownerSession}` }, signal: AbortSignal.timeout(15_000) });
      assert([200,204].includes(response.status));
      receipt.sessionCleanup = { passed: true, scope: 'only_this_qa_session', http: response.status };
    } catch { receipt.sessionCleanup = { passed: false }; receipt.passed = false; }
  }
  await browser.close();
  receipt.finishedAt = new Date().toISOString();
  receipt.browserVersion = browser.version();
  await writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
  if (!receipt.passed) process.exitCode = 1;
}
