// Update Render environment variables for the IVX backend service.
// Run: node expo/scripts/update-render-env.mjs
import { readFileSync } from 'node:fs';

const ENV_PATH = new URL('../.env', import.meta.url).pathname;
const rawEnv = readFileSync(ENV_PATH, 'utf8');
const env = {};
for (const line of rawEnv.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const RENDER_KEY = env.RENDER_API_KEY || '';
const SERVICE_ID = env.RENDER_SERVICE_ID || '';
const GITHUB_REPO_URL = env.GITHUB_REPO_URL || '';
const APP_SECRET = env.APP_SECRET || env.IVX_OWNER_VARIABLES_ENCRYPTION_KEY || crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

if (!RENDER_KEY || !SERVICE_ID) {
  console.error('Missing RENDER_API_KEY or RENDER_SERVICE_ID');
  process.exit(1);
}

async function renderFetch(path, init = {}) {
  const url = `https://api.render.com/v1${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${RENDER_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  return { ok: response.ok, status: response.status, payload: j, text };
}

// List existing env vars to find IDs for update
async function listEnvVars() {
  const result = await renderFetch(`/services/${SERVICE_ID}/env-vars?limit=100`);
  if (!result.ok) {
    console.error('Failed to list env vars:', result.status, result.text.slice(0, 200));
    return [];
  }
  return Array.isArray(result.payload) ? result.payload : [];
}

// Update or create an env var
async function upsertEnvVar(name, value) {
  const existing = await listEnvVars();
  const match = existing.find((item) => item.envVar?.key === name || item.key === name);
  const id = match?.envVar?.id || match?.id;
  const body = { key: name, value };
  if (id) {
    const result = await renderFetch(`/services/${SERVICE_ID}/env-vars/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    console.log(`Updated ${name}:`, result.ok ? 'OK' : `FAILED ${result.status}`, result.text.slice(0, 100));
    return result.ok;
  }
  const result = await renderFetch(`/services/${SERVICE_ID}/env-vars`, { method: 'POST', body: JSON.stringify(body) });
  console.log(`Created ${name}:`, result.ok ? 'OK' : `FAILED ${result.status}`, result.text.slice(0, 100));
  return result.ok;
}

async function main() {
  console.log('Updating Render env vars for', SERVICE_ID);
  const results = {
    GITHUB_REPO_URL: await upsertEnvVar('GITHUB_REPO_URL', GITHUB_REPO_URL),
    APP_SECRET: await upsertEnvVar('APP_SECRET', APP_SECRET),
  };
  console.log('\nResults:', results);
  if (!results.GITHUB_REPO_URL || !results.APP_SECRET) {
    console.error('One or more env var updates failed.');
    process.exit(1);
  }
  console.log('Done. A Render redeploy will pick up the new env vars.');
}

main().catch((e) => { console.error(e); process.exit(1); });
