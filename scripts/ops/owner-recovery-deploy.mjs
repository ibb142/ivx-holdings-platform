import { pathToFileURL } from 'node:url';

class RecoveryDeployError extends Error {}

export async function requestOwnerRecoveryDeploy({ env = process.env, fetchImpl = fetch, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (env.BINDINGS_CHANGED === 'false') return { requested: false, reason: 'bindings_unchanged', secretValuesReturned: false };
  if (env.BINDINGS_CHANGED !== 'true') throw new RecoveryDeployError('Verified binding-change result required');
  const serviceId = env.SERVICE_ID;
  const commitSha = env.GITHUB_SHA;
  if (serviceId !== 'srv-d7t9ivreo5us73ftose0' || !/^[a-f0-9]{40}$/.test(commitSha || '')) throw new RecoveryDeployError('Recovery deployment identity mismatch');
  if (!env.RENDER_API_KEY_RECOVERED) throw new RecoveryDeployError('Render recovery credential unavailable');
  const url = `https://api.render.com/v1/services/${serviceId}/deploys`;
  const headers = { Authorization: `Bearer ${env.RENDER_API_KEY_RECOVERED}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const requestedAt = now();
  let response;
  try {
    // This is the only mutation. A lost response is never replayed.
    response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ clearCache: 'do_not_clear', commitId: commitSha }), signal: AbortSignal.timeout(20000) });
  } catch { /* Reconcile the uncertain result through bounded reads below. */ }
  if (response && !response.ok && response.status < 500) throw new RecoveryDeployError(`Render recovery deployment rejected: HTTP ${response.status}`);
  let payload;
  try { payload = await response?.json(); } catch { /* HTTP 202 may have no deployment body yet. */ }
  const deployId = payload?.id || payload?.deploy?.id;
  if (response?.ok && typeof deployId === 'string' && deployId.startsWith('dep-')) {
    return { requested: true, deployId, commitSha, identityRecoveredByRead: false, secretValuesReturned: false };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await wait(1000);
    let rows;
    try {
      const read = await fetchImpl(`${url}?limit=20`, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });
      if (!read.ok) continue;
      rows = await read.json();
    } catch { continue; }
    const matches = (Array.isArray(rows) ? rows : []).map(row => row?.deploy || row).filter(row =>
      typeof row?.id === 'string' && row.id.startsWith('dep-') && row.commit?.id === commitSha
      && row.trigger === 'api' && Date.parse(row.createdAt) >= requestedAt - 1000);
    if (matches.length > 1) break;
    if (matches.length === 1) return { requested: true, deployId: matches[0].id, commitSha, identityRecoveredByRead: true, secretValuesReturned: false };
  }
  throw new RecoveryDeployError('Render recovery deployment identity remains uncertain; request was not replayed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await requestOwnerRecoveryDeploy())); }
  catch (error) { console.error(error instanceof RecoveryDeployError ? error.message : 'Recovery deployment unavailable'); process.exitCode = 1; }
}
