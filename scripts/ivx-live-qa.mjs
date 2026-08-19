#!/usr/bin/env node
/**
 * IVX LIVE PRODUCTION QA — run this yourself, trust the output, not anyone's word.
 *
 *   node scripts/ivx-live-qa.mjs
 *   node scripts/ivx-live-qa.mjs --json          # machine-readable
 *   node scripts/ivx-live-qa.mjs --base https://api.ivxholding.com
 *
 * It hits LIVE production over the public internet — the same endpoints a real
 * member uses. It creates one throwaway QA account (email `qa.probe.<ts>@ivx-qa.test`)
 * to prove registration and sign-in actually work end to end.
 *
 * Exit code 0 = every gate passed. Non-zero = something is broken, and the line
 * that failed tells you exactly what. No result is ever hard-coded: every PASS
 * below is computed from a live HTTP response in this run.
 *
 * The four areas audited, in the order a real member experiences them:
 *   1. LANDING     the public site loads and is well-formed
 *   2. REGISTER    a brand-new member can create an account
 *   3. SIGN IN     that member can sign in with the password they just set
 *   4. WIRE        bank/wire instructions are gated and never leak account numbers
 */

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const baseIdx = args.indexOf('--base');
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : 'https://api.ivxholding.com';
const SITE = 'https://ivxholding.com';

const results = [];
let failed = 0;

function record(area, name, ok, detail) {
  results.push({ area, name, ok, detail });
  if (!ok) failed++;
  if (!JSON_OUT) {
    const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${tag}  ${name}`);
    if (detail) console.log(`        ${detail}`);
  }
}

function section(title) {
  if (!JSON_OUT) console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/** Timed fetch that never throws — network faults become a measurable result. */
async function probe(url, options = {}, timeoutMs = 45_000) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: true, status: res.status, ms: Date.now() - started, text, json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      text: '',
      json: null,
      error: err?.name === 'AbortError' ? `no response within ${timeoutMs}ms` : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const ts = Date.now();
const QA_EMAIL = `qa.probe.${ts}@ivx-qa.test`;
const QA_PASSWORD = `QaProbe!${ts}aB`;

// ---------------------------------------------------------------- 1. LANDING
section('1. LANDING PAGE');
{
  const r = await probe(SITE, {}, 25_000);
  record('landing', 'site responds 200', r.status === 200, `http=${r.status} ${r.ms}ms ${r.error ?? ''}`);
  const html = r.text ?? '';
  record('landing', 'has a page title', /<title[^>]*>[^<]{3,}<\/title>/i.test(html));
  record('landing', 'has an <h1> heading', /<h1[\s>]/i.test(html));
  record('landing', 'mobile viewport meta present', /name=["']viewport/i.test(html));
  record('landing', 'meta description present (SEO)', /name=["']description/i.test(html));
  const insecure = (html.match(/(?:src|href)=["']http:\/\//g) ?? []).length;
  record('landing', 'no insecure http:// assets', insecure === 0, `found ${insecure}`);
  record('landing', 'offers a way to sign in', /sign.?in|log.?in/i.test(html));
  record('landing', 'offers a way to register', /register|sign.?up/i.test(html));
}

// --------------------------------------------------------------- 2. REGISTER
section('2. MEMBER REGISTRATION');
{
  // Validation must reject junk BEFORE any account is created.
  const bad = await probe(`${BASE}/api/members/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'x' }),
  }, 40_000);
  record('register', 'rejects invalid input with 4xx', bad.status >= 400 && bad.status < 500,
    `http=${bad.status} ${bad.ms}ms`);

  // The real thing: a brand-new member signs up.
  const payload = {
    email: QA_EMAIL,
    password: QA_PASSWORD,
    confirmPassword: QA_PASSWORD,
    firstName: 'QA',
    lastName: 'Probe',
    phone: '+13055551234',
    country: 'United States',
    zipCode: '33131',
    roles: ['investor'],
    acceptTerms: true,
    dateOfBirth: '1990-01-15',
    gender: 'male',
  };
  const reg = await probe(`${BASE}/api/members/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 60_000);

  // THE regression gate: registration used to hang forever with no response.
  record('register', 'always answers (never hangs)', reg.ok,
    reg.ok ? `http=${reg.status} ${reg.ms}ms` : `NO RESPONSE — ${reg.error}`);
  record('register', 'answers within 35s', reg.ok && reg.ms < 35_000, `${reg.ms}ms`);
  const created = reg.status === 200 || reg.status === 201;
  record('register', 'creates the account (2xx)', created,
    `http=${reg.status} ${(reg.json?.message ?? reg.text ?? '').slice(0, 120)}`);
  if (reg.status === 503) {
    record('register', 'timeout is retryable, not a hard error', reg.json?.retryable === true,
      'server correctly reported a retryable timeout instead of hanging');
  }
}

// ---------------------------------------------------------------- 3. SIGN IN
section('3. MEMBER SIGN IN');
{
  // A wrong password must be a clean, fast 401 — and must NOT be an infra timeout.
  const bad = await probe(`${BASE}/api/members/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `nobody.${ts}@ivx-qa.test`, password: 'definitely-wrong' }),
  }, 45_000);
  record('signin', 'wrong password answers', bad.ok, bad.ok ? `http=${bad.status} ${bad.ms}ms` : bad.error);
  record('signin', 'wrong password is 401 (not 5xx)', bad.status === 401, `http=${bad.status}`);

  // THE regression gate. An upstream timeout must never be dressed up as a
  // credential rejection, and the internal budget string must never leak.
  const msg = String(bad.json?.message ?? '');
  record('signin', 'no internal timeout string leaked to the member',
    !/timed out after \d+ms/i.test(msg), `message="${msg.slice(0, 90)}"`);
  record('signin', '401 is a real credential verdict, not a disguised timeout',
    !(bad.status === 401 && /tim(e|ed) out/i.test(msg)), `http=${bad.status} message="${msg.slice(0, 90)}"`);

  // The member registered above must be able to sign in with that password.
  const good = await probe(`${BASE}/api/members/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD }),
  }, 45_000);
  record('signin', 'newly registered member can sign in', good.status === 200,
    `http=${good.status} ${good.ms}ms ${(good.json?.message ?? '').slice(0, 90)}`);
  record('signin', 'sign-in returns a session token', Boolean(good.json?.accessToken),
    good.json?.accessToken ? 'accessToken present' : 'no accessToken returned');

  // Stability: auth must be consistent, not a coin flip. Flapping between 401
  // and 503 across identical calls is what locked people out.
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const r = await probe(`${BASE}/api/members/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `stability.${ts}.${i}@ivx-qa.test`, password: 'wrong-pw' }),
    }, 45_000);
    codes.push(r.status);
  }
  record('signin', 'auth is stable across repeats (no flapping)',
    new Set(codes).size === 1, `status codes: ${codes.join(', ')}`);
  record('signin', 'never returns 503 under normal load',
    !codes.includes(503), `status codes: ${codes.join(', ')}`);
}

// ------------------------------------------------------------------- 4. WIRE
section('4. BANK / WIRE PAYMENTS');
{
  const anon = await probe(`${BASE}/api/ivx/wire-instructions`, {}, 30_000);
  record('wire', 'endpoint responds', anon.status === 200, `http=${anon.status} ${anon.ms}ms`);
  record('wire', 'anonymous caller is NOT authenticated', anon.json?.authenticated === false,
    `authenticated=${anon.json?.authenticated}`);

  // The one that actually matters: no banking secrets to an anonymous caller.
  const body = anon.text ?? '';
  const accountish = body.match(/\b\d{7,17}\b/g) ?? [];
  record('wire', 'no account number exposed to anonymous', accountish.length === 0,
    accountish.length ? `exposed digit runs: ${accountish.join(', ')}` : 'none');
  const routing = body.match(/\b\d{9}\b/g) ?? [];
  record('wire', 'no routing number exposed to anonymous', routing.length === 0,
    routing.length ? `exposed: ${routing.join(', ')}` : 'none');
  record('wire', 'prompts the member to sign in', /sign in/i.test(body));

  const forged = await probe(`${BASE}/api/ivx/wire-instructions`, {
    headers: { Authorization: 'Bearer forged-token-not-valid' },
  }, 30_000);
  const forgedDigits = (forged.text ?? '').match(/\b\d{7,17}\b/g) ?? [];
  record('wire', 'forged token cannot unlock instructions', forgedDigits.length === 0,
    forgedDigits.length ? `LEAKED: ${forgedDigits.join(', ')}` : 'no banking digits returned');
}

// ----------------------------------------------------------------- SUMMARY
const summary = {
  base: BASE,
  site: SITE,
  ranAt: new Date().toISOString(),
  qaEmail: QA_EMAIL,
  total: results.length,
  passed: results.length - failed,
  failed,
  certified: failed === 0,
  results,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\n${'='.repeat(58)}`);
  console.log(`  ${summary.passed}/${summary.total} passed` + (failed ? `  \x1b[31m${failed} FAILED\x1b[0m` : '  \x1b[32mALL PASS\x1b[0m'));
  console.log(`  certified: ${summary.certified ? '\x1b[32mYES\x1b[0m' : '\x1b[31mNO\x1b[0m'}`);
  console.log(`  ran at ${summary.ranAt} against ${BASE}`);
  console.log('='.repeat(58));
  if (failed) {
    console.log('\nFailed gates:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - [${r.area}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }
}

process.exit(failed === 0 ? 0 : 1);
