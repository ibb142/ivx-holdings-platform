import { pathToFileURL } from 'node:url';

export const SERVICE = 'srv-d7t9ivreo5us73ftose0';
const OWNER = 'tea-d7plj9beo5us73ch3ukg';
export async function decodeRenderResponse(response) {
  const body = await response.text();
  return body.trim() ? JSON.parse(body) : {};
}
function validate(service) {
  if (service.id !== SERVICE || service.ownerId !== OWNER || service.type !== 'web_service' ||
      service.repo !== 'https://github.com/ibb142/ivx-holdings-platform' || service.branch !== 'main' ||
      service.serviceDetails?.numInstances !== 2 || !['starter', 'standard'].includes(service.serviceDetails?.plan)) {
    throw new Error('Unexpected API service configuration; no further changes permitted');
  }
}

// Applying this change costs an additional $36/month at September 2026 rates.
// Merge/execute only after the owner approves that recurring cost.
export async function upgradeAPI({ request, approved, commit, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (approved !== true) throw new Error('Recurring cost approval required');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Exact deployment commit required');
  const path = `/services/${SERVICE}`;
  const before = await request('GET', path);
  validate(before);
  const env = await request('GET', `${path}/env-vars/NODE_OPTIONS`);
  if (!['--max-old-space-size=320', '--max-old-space-size=1024'].includes(env.value)) {
    throw new Error('NODE_OPTIONS changed; review before overwriting');
  }
  if (before.serviceDetails.plan !== 'standard') {
    await request('PATCH', path, { serviceDetails: { plan: 'standard' } });
  }
  const after = await request('GET', path);
  validate(after);
  if (after.serviceDetails.plan !== 'standard') throw new Error('Memory plan readback failed');
  await request('PUT', `${path}/env-vars/NODE_OPTIONS`, { value: '--max-old-space-size=1024' });
  const verified = await request('GET', `${path}/env-vars/NODE_OPTIONS`);
  if (verified.value !== '--max-old-space-size=1024') throw new Error('Node heap readback failed');
  const requestedAt = Date.now();
  let deploy = await request('POST', `${path}/deploys`, { clearCache: 'do_not_clear', commitId: commit });
  for (let attempt = 0; !deploy.id && attempt < 15; attempt++) {
    // A successful empty response must be reconciled, never blindly POSTed again.
    // Render may accept the request before the deploy exists in its list API.
    await wait(2000);
    const recent = await request('GET', `${path}/deploys?limit=5`);
    deploy = (Array.isArray(recent) ? recent : []).map(row => row.deploy ?? row).find(row =>
      row.commit?.id === commit && Date.parse(row.createdAt) >= requestedAt &&
      ['queued', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress', 'live'].includes(row.status)) ?? {};
  }
  if (typeof deploy.id !== 'string' || !deploy.id.startsWith('dep-')) throw new Error('Deployment ID missing');
  return { serviceId: SERVICE, plan: 'standard', instances: 2, heapMB: 1024, deployId: deploy.id,
    status: 'deployment_requested', productionRecoveryVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const token = process.env.RENDER_API_KEY || process.env.IVX_RENDER_API_KEY;
    if (!token) throw new Error('Render API credential unavailable');
    const request = async (method, path, body) => {
      const response = await fetch(`https://api.render.com/v1${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
      });
      // Never print provider responses, environment values, or credentials.
      if (!response.ok) throw new Error(`Render ${method} request failed: HTTP ${response.status}`);
      return decodeRenderResponse(response);
    };
    console.log(JSON.stringify(await upgradeAPI({ request,
      approved: process.env.IVX_APPROVED_MEMORY_COST === '36_USD_PER_MONTH', commit: process.env.GITHUB_SHA })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
