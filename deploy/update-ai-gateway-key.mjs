#!/usr/bin/env node
/**
 * Update AI_GATEWAY_API_KEY + IVX_AI_GATEWAY_KEY on Render and trigger a deploy.
 * Usage: RENDER_API_KEY=rnd_xxx node deploy/update-ai-gateway-key.mjs
 */
const RENDER_API_KEY = process.env.RENDER_API_KEY ?? '';
const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? 'srv-d7t9ivreo5us73ftose0';
const NEW_KEY = process.env.NEW_AI_GATEWAY_KEY ?? '';

if (!RENDER_API_KEY) {
  console.error('ERROR: RENDER_API_KEY env var is required.');
  process.exit(1);
}
if (!NEW_KEY) {
  console.error('ERROR: NEW_AI_GATEWAY_KEY env var is required (the new vck_ key).');
  process.exit(1);
}

const API_BASE = 'https://api.render.com/v1';

async function renderFetch(path, init = {}) {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${RENDER_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  return { ok: response.ok, status: response.status, payload: j, text };
}

async function listEnvVars() {
  const result = await renderFetch(`/services/${SERVICE_ID}/env-vars`);
  if (!result.ok) {
    console.error('Failed to list env vars:', result.status, result.text.slice(0, 300));
    process.exit(1);
  }
  return Array.isArray(result.payload) ? result.payload : [];
}

async function upsertEnvVar(name, value) {
  const existing = await listEnvVars();
  const match = existing.find((item) => item.envVar?.key === name || item.key === name);
  const id = match?.envVar?.id || match?.id;
  const body = { key: name, value };
  if (id) {
    const result = await renderFetch(`/services/${SERVICE_ID}/env-vars/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    console.log(`  Updated ${name}:`, result.ok ? 'OK' : `FAILED ${result.status}`, result.text.slice(0, 100));
    return result.ok;
  }
  const result = await renderFetch(`/services/${SERVICE_ID}/env-vars`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  console.log(`  Created ${name}:`, result.ok ? 'OK' : `FAILED ${result.status}`, result.text.slice(0, 100));
  return result.ok;
}

async function triggerDeploy() {
  const result = await renderFetch(`/services/${SERVICE_ID}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ clearCache: 'clear' }),
  });
  const deployId = result.payload?.id || result.payload?.deploy?.id || 'unknown';
  console.log(`Deploy triggered: ${result.ok ? 'OK' : 'FAILED'} (id: ${deployId})`);
  return { ok: result.ok, deployId };
}

async function waitForDeploy(deployId, maxWaitMs = 180000) {
  const start = Date.now();
  let lastStatus = '';
  while (Date.now() - start < maxWaitMs) {
    const result = await renderFetch(`/services/${SERVICE_ID}/deploys/${deployId}`);
    if (result.ok) {
      const status = result.payload?.status ?? 'unknown';
      if (status !== lastStatus) {
        console.log(`  Deploy status: ${status} (${Math.round((Date.now() - start) / 1000)}s)`);
        lastStatus = status;
      }
      if (status === 'live') return true;
      if (status === 'canceled' || status === 'failed') return false;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('  Timed out waiting for deploy.');
  return false;
}

async function verifyProduction() {
  console.log('\nVerifying production AI gateway...');
  await new Promise((r) => setTimeout(r, 3000));

  const healthRes = await fetch('https://api.ivxholding.com/health');
  const health = await healthRes.json().catch(() => ({}));
  console.log(`  /health: ok=${health.ok}, commit=${health.commit?.slice(0, 12)}`);

  const debugRes = await fetch('https://api.ivxholding.com/api/ivx/chat-debug');
  const debug = await debugRes.json().catch(() => ({}));
  const credValid = debug.providerHealth?.credentialValid;
  const httpStatus = debug.providerHealth?.lastHttpStatus;
  const state = debug.providerHealth?.state;
  console.log(`  chat-debug: credentialValid=${credValid}, lastHttpStatus=${httpStatus}, state=${state}`);

  if (credValid === true && httpStatus === 200) {
    console.log('\nAI gateway is LIVE. Running quick chat test...');
    const chatRes = await fetch('https://api.ivxholding.com/api/public/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is 15% of $240,000?' }),
    });
    const chat = await chatRes.json().catch(() => ({}));
    console.log(`  Chat response source: ${chat.source ?? 'unknown'}`);
    console.log(`  Chat answer preview: ${(chat.answer ?? '').slice(0, 200)}`);
    if (chat.source && chat.source !== 'fallback') {
      console.log('\nSUCCESS: AI gateway is producing real LLM responses.');
      return true;
    }
    console.log('\nWARNING: AI gateway credentials valid but chat still returning fallback. May need more time after redeploy.');
    return false;
  }

  console.log('\nFAILED: AI gateway credentials still invalid after redeploy.');
  return false;
}

async function main() {
  console.log(`Updating Render env vars for service ${SERVICE_ID}...`);
  console.log(`New key prefix: ${NEW_KEY.slice(0, 8)}***\n`);

  const results = {
    AI_GATEWAY_API_KEY: await upsertEnvVar('AI_GATEWAY_API_KEY', NEW_KEY),
    IVX_AI_GATEWAY_KEY: await upsertEnvVar('IVX_AI_GATEWAY_KEY', NEW_KEY),
  };

  console.log('\nEnv var update results:', results);
  if (!results.AI_GATEWAY_API_KEY || !results.IVX_AI_GATEWAY_KEY) {
    console.error('One or more env var updates failed.');
    process.exit(1);
  }

  console.log('\nTriggering deploy...');
  const deploy = await triggerDeploy();
  if (!deploy.ok) {
    console.error('Deploy trigger failed.');
    process.exit(1);
  }

  console.log('\nWaiting for deploy to complete...');
  const live = await waitForDeploy(deploy.deployId);
  if (!live) {
    console.log('Deploy did not reach live state, but may still be in progress.');
  }

  const verified = await verifyProduction();
  process.exit(verified ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
