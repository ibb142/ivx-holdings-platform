#!/usr/bin/env node
/**
 * Live owner-control authorization contract test.
 *
 * Proves against the production API:
 *   1. missing credential          -> HTTP 401
 *   2. invalid credential          -> HTTP 401
 *   3. valid credential (optional) -> HTTP 200 ok=true
 *
 * The valid case requires IVX_AI_SYSTEM_SECRET (or IVX_OIDC_TOKEN) in the
 * environment; when neither is present the script fails closed with exit 2
 * instead of pretending the valid path passed.
 *
 * Usage: node qa/ivx-owner-auth-contract.mjs   (env: API_BASE, IVX_AI_SYSTEM_SECRET | IVX_OIDC_TOKEN)
 */
const API_BASE = process.env.API_BASE || 'https://api.ivxholding.com';
const CONTROL_URL = `${API_BASE}/api/ivx/agents/app-completion/control`;

async function probe(label, headers, body = '{"action":"resume_all"}') {
  const res = await fetch(CONTROL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  let payload = {};
  try { payload = await res.json(); } catch { payload = {}; }
  return { label, status: res.status, ok: payload.ok === true, error: payload.error || null };
}

const results = [];
results.push(await probe('missing-credential', {}));
results.push(await probe('invalid-credential', { 'x-ivx-owner-key': 'definitely-not-a-valid-owner-key' }));

const secret = (process.env.IVX_AI_SYSTEM_SECRET || '').trim();
const oidcToken = (process.env.IVX_OIDC_TOKEN || '').trim();
if (oidcToken) {
  results.push(await probe('valid-oidc', { 'X-IVX-GitHub-OIDC': oidcToken }));
} else if (secret) {
  results.push(await probe('valid-owner-key', { 'x-ivx-owner-key': secret }));
} else {
  console.error('VALID PATH NOT TESTED: IVX_AI_SYSTEM_SECRET / IVX_OIDC_TOKEN not set (fail-closed, not a silent pass).');
  results.push({ label: 'valid-credential', status: 0, ok: false, error: 'no credential available in environment' });
}

let failed = false;
for (const r of results) {
  let verdict;
  if (r.label === 'missing-credential' || r.label === 'invalid-credential') {
    verdict = r.status === 401 && !r.ok ? 'PASS' : 'FAIL';
  } else {
    verdict = r.status === 200 && r.ok ? 'PASS' : 'FAIL';
  }
  if (verdict === 'FAIL') failed = true;
  console.log(`${r.label}: http=${r.status} ok=${r.ok} ${verdict}${r.error ? ` error=${r.error}` : ''}`);
}
process.exit(failed ? 1 : 0);
