const MAX_ATTEMPTS = 12;
const DEADLINE_MS = 180_000;
const RETRY_MS = 10_000;
const TERMINAL_DEPLOY_STATES = new Set(['build_failed', 'update_failed', 'canceled', 'deactivated']);

export class RuntimeVerificationError extends Error {}

export async function readVerifiedJson(response) {
  if (!response.ok) throw new RuntimeVerificationError(`Runtime diagnostic HTTP ${response.status}`);
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new RuntimeVerificationError('Runtime diagnostic JSON content type required');
  }
  try { return JSON.parse(await response.text()); }
  catch { throw new RuntimeVerificationError('Runtime diagnostic JSON body invalid'); }
}

// Only read requests may be retried. The authentication certificate POST stays
// in the caller and runs once after this deployment/runtime identity gate.
export async function waitForOwnerRuntime({
  apiBase, token, expectedSha, expectedService,
  fetchImpl = fetch, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  observe = () => {},
}) {
  if (apiBase !== 'https://api.ivxholding.com' || !token ||
      !/^[a-f0-9]{40}$/.test(expectedSha || '') ||
      expectedService !== 'srv-d7t9ivreo5us73ftose0') {
    throw new RuntimeVerificationError('Runtime diagnostic expected identity invalid');
  }
  const deadline = now() + DEADLINE_MS;
  let consecutive = 0;
  let lastReason = 'unavailable';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && now() < deadline; attempt++) {
    let response;
    try {
      response = await fetchImpl(`${apiBase}/api/ivx/render-diagnostic?limit=1`, {
        method: 'GET', cache: 'no-store', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(Math.max(1, Math.min(45_000, deadline - now()))),
      });
    } catch { lastReason = 'read_unavailable'; }
    if (now() >= deadline) break;
    if (response && !response.ok && response.status < 500 && response.status !== 429) {
      throw new RuntimeVerificationError(`Runtime diagnostic HTTP ${response.status}`);
    }
    if (response?.ok) {
      const diagnostic = await readVerifiedJson(response);
      if (now() >= deadline) break;
      if (!diagnostic || diagnostic.ok !== true) {
        lastReason = 'diagnostic_unavailable';
      } else {
        if (diagnostic.service?.id !== expectedService || diagnostic.runtime?.serviceId !== expectedService) {
          throw new RuntimeVerificationError('Runtime diagnostic service identity mismatch');
        }
        const deploy = diagnostic.latestDeploy;
        if (deploy?.commitSha === expectedSha && TERMINAL_DEPLOY_STATES.has(deploy.status)) {
          throw new RuntimeVerificationError('Runtime diagnostic target deployment failed');
        }
        const settled = deploy?.commitSha === expectedSha && deploy.status === 'live';
        const exactRuntime = diagnostic.runtime?.commitSha === expectedSha;
        if (settled && exactRuntime) {
          if (diagnostic.ownerAuthEnvPresence?.IVX_OWNER_PASSWORD_BASE64?.matchesRuntime !== true) {
            throw new RuntimeVerificationError('Runtime diagnostic owner password transport drift');
          }
          consecutive++;
          observe({ attempt, reason: 'exact_runtime_and_live_deployment', consecutive });
          // Two stable reads reduce rollout races. This does not certify every
          // replica: fleet/instance coverage remains the live-status proof's job.
          if (consecutive === 2) return diagnostic;
          lastReason = 'awaiting_second_stable_read';
        } else {
          consecutive = 0;
          lastReason = settled ? 'previous_runtime_draining' : 'deployment_not_settled';
        }
      }
    } else if (response) lastReason = `http_${response.status}`;
    if (lastReason !== 'awaiting_second_stable_read') consecutive = 0;
    observe({ attempt, reason: lastReason, consecutive });
    if (attempt < MAX_ATTEMPTS && now() < deadline) await wait(Math.min(RETRY_MS, deadline - now()));
  }
  throw new RuntimeVerificationError(`Runtime diagnostic did not settle before its bound: ${lastReason}`);
}
