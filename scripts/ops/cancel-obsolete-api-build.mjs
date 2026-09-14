import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const serviceId = 'srv-d7t9ivreo5us73ftose0';
const deployId = 'dep-dak532dckfvc73ab4gd0';
const obsoleteSha = 'b8778a5052ab5dab1502c5b22611d663e52e2a38';

export async function cancelObsoleteApiBuild({ token, expectedMain, fetcher = fetch, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  assert.ok(token, 'RENDER_BINDING_UNAVAILABLE');
  assert.match(expectedMain ?? '', /^[a-f0-9]{40}$/);
  const origin = 'https://api.render.com/v1';
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const read = async path => {
    const response = await fetcher(origin + path, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.ok(response.ok, `RENDER_READ_HTTP_${response.status}`);
    return response.json();
  };
  const service = await read(`/services/${serviceId}`);
  assert.equal(service.repo?.replace(/\.git$/, ''), 'https://github.com/ibb142/ivx-holdings-platform');
  assert.equal(service.branch, 'main');
  const deploy = await read(`/services/${serviceId}/deploys/${deployId}`);
  assert.equal(deploy.id, deployId);
  assert.equal(deploy.commit?.id, obsoleteSha);
  if (['canceled', 'cancelled', 'build_failed', 'deactivated'].includes(deploy.status)) {
    return { changed: false, deployId, status: deploy.status, observedAt: new Date(now()).toISOString() };
  }
  assert.equal(deploy.status, 'build_in_progress', 'REFUSE_TO_CANCEL_LIVE_OR_DEPLOYING_RELEASE');
  assert.ok(now() - Date.parse(deploy.startedAt) > 10 * 60_000, 'BUILD_NOT_STALE');
  const rows = await read(`/services/${serviceId}/deploys?limit=20`);
  assert.ok(Array.isArray(rows), 'SUCCESSOR_LIST_UNAVAILABLE');
  const successor = rows.map(row => row.deploy ?? row).find(row => row.id !== deployId && row.commit?.id === expectedMain && row.status === 'queued');
  assert.ok(successor, 'VERIFIED_SOURCE_SUCCESSOR_NOT_QUEUED');
  // Cancel one obsolete build, not the serving release. Do not replay an
  // uncertain POST. A read of the same deployment reconciles acceptance.
  let response;
  try { response = await fetcher(`${origin}/services/${serviceId}/deploys/${deployId}/cancel`, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
  }); } catch { /* Reconcile below. */ }
  if (response && !response.ok && response.status < 500) throw new Error(`CANCEL_REJECTED_HTTP_${response.status}`);
  await response?.body?.cancel().catch(() => {});
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait(500 * attempt);
    const after = await read(`/services/${serviceId}/deploys/${deployId}`);
    if (['canceled', 'cancelled'].includes(after.status)) {
      return { changed: true, deployId, status: after.status, successorId: successor.id, successorSha: expectedMain,
        servingReleaseCancelled: false, deploymentCreated: false, observedAt: new Date(now()).toISOString() };
    }
  }
  throw new Error('CANCEL_UNCONFIRMED_DO_NOT_REPLAY');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { renderKey } = await import('./autonomous-db-sync.mjs');
    console.log(JSON.stringify(await cancelObsoleteApiBuild({ token: await renderKey(), expectedMain: process.env.EXPECTED_MAIN_SHA })));
  } catch (error) {
    const message = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error?.message;
    console.error(/^[A-Z_]+(?:_HTTP_\d+)?$/.test(message ?? '') ? message : 'API_BUILD_RECOVERY_UNCONFIRMED');
    process.exitCode = 1;
  }
}
