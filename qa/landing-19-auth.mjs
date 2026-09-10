// Real Supabase Auth + Postgres acceptance, restricted to an ephemeral local stack.
// No production identities, credentials, database rows, email or SMS are used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const unit = process.argv[2];
assert.ok(['registration.zip-code', 'registration.optional-picture', 'registration.duplicate-user', 'registration.loading-retry-browser', 'registration.e2e-member-creation', 'auth.expired-token', 'auth.session-persistence-browser', 'auth.login-e2e'].includes(unit));
const supabaseUrl = process.env.SUPABASE_URL;
assert.equal(new URL(supabaseUrl).hostname, '127.0.0.1', 'Acceptance must never mutate a hosted Supabase project');
const anon = process.env.SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(anon && service);
const admin = createClient(supabaseUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
const { handleMemberRegister, handleMemberLogin, handleGetMemberProfile, handleRegistrationStatusRequest } = await import('../backend/api/ivx-members.ts');
const routes = { '/api/members/register': handleMemberRegister, '/api/members/login': handleMemberLogin, '/api/members/me': handleGetMemberProfile, '/api/ivx/registration/status': handleRegistrationStatusRequest };
const fixtureBase = 'http://127.0.0.1:4174';
const root = path.resolve('expo/ivxholding-landing');
const server = Bun.serve({ hostname: '127.0.0.1', port: 4174, async fetch(request) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': fixtureBase, 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
  const handler = routes[url.pathname];
  if (handler) {
    const response = await handler(request);
    response.headers.set('access-control-allow-origin', fixtureBase);
    return response;
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) return new Response(null, { status: 404 });
  return await Bun.file(file).exists() ? new Response(Bun.file(file)) : new Response(null, { status: 404 });
} });
const password = 'Local-QA-' + randomUUID() + '!9a';
const payload = () => ({ email: `qa-${randomUUID()}@example.test`, password, firstName: 'QA', lastName: 'Fixture', phone: '+15555550100', country: 'US', zipCode: '33101', roles: ['investor'], acceptTerms: true, dateOfBirth: '1990-01-01', gender: 'prefer_not_to_say', registrationRequestId: randomUUID() });
const created = [], checks = [];
let browser, error;
async function request(route, body, token) {
  const response = await fetch(fixtureBase + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
async function register(input = payload()) {
  const result = await request('/api/members/register', input);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.ok, true);
  created.push(result.data.authUserId);
  const profile = await admin.from('profiles').select('id,email,picture_url').eq('id', result.data.authUserId).single();
  assert.equal(profile.error, null);
  assert.equal(profile.data.email, input.email);
  return { input, id: result.data.authUserId, profile: profile.data };
}
async function login(input) {
  const result = await request('/api/members/login', { email: input.email, password });
  assert.equal(result.status, 200, JSON.stringify({ ...result.data, accessToken: '[redacted]', refreshToken: '[redacted]' }));
  assert.equal(result.data.success, true);
  assert.ok(result.data.accessToken);
  return result.data;
}
async function openAuthPage(context, input, mode = 'login', expectSession = false) {
  const page = await context.newPage();
  await page.goto(fixtureBase, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ path: 'node_modules/@supabase/supabase-js/dist/umd/supabase.js' });
  await page.waitForFunction(() => typeof window.openInvestModal === 'function');
  await page.evaluate(({ anon, fixtureBase }) => {
    window.IVX_SUPABASE_URL = 'https://qa.supabase.co';
    window.IVX_SUPABASE_ANON_KEY = anon;
    window.IVX_API = fixtureBase;
    window.openInvestModal('');
  }, { anon, fixtureBase });
  await page.waitForFunction(() => Boolean(window.IVXInvest));
  // Mount the existing account step without creating an investment request.
  await page.evaluate(() => window.IVXInvest.showStep(3));
  if (expectSession) { await page.locator('#invest-authenticated-view').waitFor({ state: 'visible' }); return page; }
  await page.locator(mode === 'login' ? '#invest-tab-login' : '#invest-tab-signup').click();
  await page.locator('#invest-email').fill(input.email);
  await page.locator('#invest-password').fill(password);
  if (mode === 'signup') {
    await page.locator('#invest-first').fill(input.firstName);
    await page.locator('#invest-last').fill(input.lastName);
    await page.locator('#invest-birthday').fill(input.dateOfBirth);
    await page.locator('#invest-gender').selectOption('other');
  }
  return page;
}
async function authContext() {
  browser ||= await chromium.launch();
  const context = await browser.newContext();
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { ...req.headers(), apikey: anon };
      delete headers.host; delete headers.origin;
      const bearer = headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!bearer || jwt.decode(bearer)?.role === 'anon' || bearer.startsWith('sb_publishable_')) headers.authorization = `Bearer ${anon}`;
      const response = await context.request.fetch(supabaseUrl + url.pathname + url.search, { method: req.method(), headers, data: req.postDataBuffer() || undefined });
      return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': fixtureBase, 'access-control-allow-headers': '*' } });
    }
    // Isolate third-party mutation side effects; public GET assets remain real.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && url.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  return context;
}
async function closeAuthContext(context) {
  // Finish local Auth/Postgres forwarding before disposing its request client.
  // Waiting preserves handler failures; never silence them with ignoreErrors.
  await context.unrouteAll({ behavior: 'wait' });
  await context.close();
}
try {
  if (unit === 'registration.zip-code') {
    const before = await admin.auth.admin.listUsers();
    const result = await request('/api/members/register', { ...payload(), zipCode: 'invalid-zip!' });
    assert.equal(result.status, 400); assert.equal(result.data.code, 'INVALID_POSTAL_CODE');
    const after = await admin.auth.admin.listUsers();
    assert.equal(after.data.users.length, before.data.users.length);
    checks.push('invalid ZIP rejected before identity creation');
  } else if (unit === 'registration.loading-retry-browser') {
    const input = payload(), context = await authContext();
    let attempts = 0, release;
    const pending = new Promise((resolve) => { release = resolve; });
    await context.route('**/api/members/register', async (route) => {
      attempts++;
      if (attempts === 1) { await pending; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SERVICE_UNAVAILABLE', message: 'Fixture outage: retry available', retryable: true }) }); }
      return route.fallback();
    });
    const page = await openAuthPage(context, input, 'signup');
    await page.locator('#invest-auth-btn').click();
    await page.waitForFunction(() => document.querySelector('#invest-auth-btn').disabled);
    assert.equal(attempts, 1);
    release();
    await page.locator('#invest-auth-error').getByText(/retry available/).waitFor();
    assert.equal(await page.locator('#invest-email').inputValue(), input.email);
    assert.equal(await page.locator('#invest-auth-btn').isEnabled(), true);
    const retryResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/members/register' && response.request().method() === 'POST');
    await page.locator('#invest-auth-btn').click();
    const response = await retryResponse;
    assert.equal(new URL(response.url()).origin, fixtureBase);
    const retryResult = await response.json();
    assert.equal(response.status(), 200, JSON.stringify({ code: retryResult.code, message: retryResult.message }));
    assert.equal(retryResult.ok, true);
    await page.locator('#invest-authenticated-view').waitFor({ state: 'visible' });
    assert.equal(attempts, 2);
    const { data } = await admin.auth.admin.listUsers();
    created.push(...data.users.filter((u) => u.email === input.email).map((u) => u.id));
    assert.equal(created.length, 1);
    assert.equal(created[0], retryResult.authUserId);
    const profile = await admin.from('profiles').select('id,email').eq('id', retryResult.authUserId).single();
    assert.equal(profile.error, null);
    assert.equal(profile.data.email, input.email);
    checks.push('loading disables submission; outage preserves inputs; retry creates exactly one real Auth identity');
    await closeAuthContext(context);
  } else {
    const member = await register();
    if (unit === 'registration.optional-picture') {
      assert.equal('pictureUrl' in member.input, false); assert.equal(member.profile.picture_url, '');
      checks.push('registration without picture creates persisted Auth identity and profile');
    } else if (unit === 'registration.duplicate-user') {
      const duplicate = await request('/api/members/register', { ...member.input, registrationRequestId: randomUUID() });
      assert.equal(duplicate.status, 409); assert.equal(duplicate.data.code, 'EMAIL_EXISTS');
      checks.push('controlled existing QA identity rejected as duplicate');
    } else if (unit === 'auth.expired-token') {
      const signedIn = await login(member.input);
      assert.equal((await request('/api/members/me', null, signedIn.accessToken)).status, 200);
      // Keep the actual GoTrue-issued token unchanged. Let it expire naturally
      // so this acceptance is independent of HS256/ES256 signing configuration.
      const claims = jwt.decode(signedIn.accessToken);
      assert.equal(claims.sub, member.id);
      const expiresIn = claims.exp * 1000 - Date.now();
      assert.ok(expiresIn > 0 && expiresIn <= 65_000, 'Local QA issuer must use a 60-second token lifetime');
      await new Promise((resolve) => setTimeout(resolve, expiresIn + 1000));
      const deadline = Date.now() + 65_000;
      let expiredStatus;
      do {
        expiredStatus = (await request('/api/members/me', null, signedIn.accessToken)).status;
        assert.ok([200, 401].includes(expiredStatus), `Unexpected expiry response ${expiredStatus}`);
        if (expiredStatus === 401) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } while (Date.now() < deadline);
      assert.equal(expiredStatus, 401, 'The unchanged real session must be rejected after expiry and issuer clock tolerance');
      checks.push('unchanged real issuer token: protected profile returns 200 before expiry and 401 after natural expiration');
    } else if (unit === 'registration.e2e-member-creation') {
      const signedIn = await login(member.input);
      const profile = await request('/api/members/me', null, signedIn.accessToken);
      assert.equal(profile.status, 200); assert.equal(profile.data.profile.id, member.id);
      for (const [table, field] of [['members','auth_user_id'], ['wallets','user_id']]) {
        const row = await admin.from(table).select('*').eq(field, member.id).single();
        assert.equal(row.error, null, `${table} must be persisted`);
      }
      checks.push('HTTP registration → real Auth identity → Postgres profile/member/wallet → password login → protected profile');
    } else {
      if (unit === 'auth.login-e2e') {
        const owner = await admin.auth.admin.createUser({ email: `qa-owner-${randomUUID()}@example.test`, password, email_confirm: true, app_metadata: { role: 'owner' } });
        assert.equal(owner.error, null); created.push(owner.data.user.id);
        const ownerLogin = await login({ email: owner.data.user.email });
        const verified = await admin.auth.getUser(ownerLogin.accessToken);
        assert.equal(verified.data.user.id, owner.data.user.id); assert.equal(verified.data.user.app_metadata.role, 'owner');
      }
      const context = await authContext(), page = await openAuthPage(context, member.input);
      await page.locator('#invest-auth-btn').click();
      await page.locator('#invest-authenticated-view').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#invest-user-email').textContent(), member.input.email);
      if (unit === 'auth.session-persistence-browser') {
        await page.close();
        const reloaded = await openAuthPage(context, member.input, 'login', true);
        await reloaded.locator('#invest-authenticated-view').waitFor({ state: 'visible' });
        await reloaded.locator('#invest-signout').click();
        await reloaded.locator('#invest-authenticated-view').waitFor({ state: 'hidden' });
        await reloaded.close();
        const signedOut = await openAuthPage(context, member.input);
        await signedOut.locator('#invest-auth-box').waitFor({ state: 'visible' });
        assert.equal(await signedOut.locator('#invest-authenticated-view').isVisible(), false);
      }
      checks.push('real password session accepted in existing account UI; persistence/logout checked when assigned');
      await closeAuthContext(context);
    }
  }
} catch (e) { error = e.message; process.exitCode = 1; }
finally {
  try {
    for (const context of browser?.contexts() || []) await closeAuthContext(context);
  } catch (e) { error ||= e.message; process.exitCode = 1; }
  await browser?.close();
  for (const id of created) { await admin.auth.admin.deleteUser(id); }
  server.stop(true);
  await mkdir('evidence/landing-19', { recursive: true });
  const result = { unit, sourceSha: process.env.GITHUB_SHA, environment: 'isolated real Supabase Auth/Postgres', passed: !error, checks, error };
  await writeFile(`evidence/landing-19/${unit}.json`, JSON.stringify(result));
  console.log(JSON.stringify(result));
}
