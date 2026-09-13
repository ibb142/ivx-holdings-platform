import { mkdir, writeFile } from 'node:fs/promises';
import { fetchLiveFleet } from '../expo/shared/ivx/live-fleet-dashboard';

const endpoint = 'https://api.ivxholding.com/api/ivx/live-work/agents?enterpriseDashboard=1&view=live';

/** Read-only production proof through the same authenticated transport as the APK. */
export async function verifyLiveFleetDeployment(options: {
  token: string; sha: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>;
}) {
  if (!options.token || !/^[a-f0-9]{40}$/.test(options.sha)) throw new Error('FLEET_PROOF_CONFIGURATION_INVALID');
  const fetchImpl = options.fetchImpl ?? fetch;
  const anonymous = await fetchImpl(endpoint, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (anonymous.status !== 401 && anonymous.status !== 403) throw new Error('FLEET_ANONYMOUS_ACCESS_NOT_REJECTED');
  await anonymous.body?.cancel();
  const samples = [];
  let previousObservation = 0;
  for (let sample = 0; sample < 3; sample++) {
    if (sample) await (options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(5_000);
    const startedAt = Date.now();
    const payload = await fetchLiveFleet({ url: endpoint, getToken: async () => options.token,
      signal: new AbortController().signal, fetch: fetchImpl });
    const { dashboard } = payload;
    if (dashboard.fleetSignals.commitSha !== options.sha) throw new Error('FLEET_DEPLOYMENT_SHA_MISMATCH');
    const observedAt = Date.parse(dashboard.generatedAt);
    if (observedAt <= previousObservation) throw new Error('FLEET_OBSERVATION_DID_NOT_ADVANCE');
    previousObservation = observedAt;
    samples.push({ observedAt: dashboard.generatedAt, responseMs: Date.now() - startedAt,
      registryCount: dashboard.registryCount, counts: dashboard.fleetSignals.counts });
  }
  return { status: 'PASS', sourceSha: options.sha, endpoint, anonymousStatus: anonymous.status,
    verifiedAt: new Date().toISOString(), samples,
    scope: 'Owner API transport, 112 identities, fresh advancing observations and deployed SHA. Does not certify 112 concurrent workers or 24/7 availability.' };
}

if (import.meta.main) {
  const output = 'qa/evidence/fleet-live-production.json';
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'push') {
      throw new Error('PROTECTED_MAIN_PUSH_REQUIRED');
    }
    const evidence = await verifyLiveFleetDeployment({ token: process.env.IVX_OWNER_TOKEN ?? '', sha: process.env.GITHUB_SHA ?? '' });
    await mkdir('qa/evidence', { recursive: true });
    await writeFile(output, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } catch (error) {
    const evidence = { status: 'FAIL', verifiedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'FLEET_PROOF_FAILED' };
    await mkdir('qa/evidence', { recursive: true });
    await writeFile(output, JSON.stringify(evidence, null, 2));
    console.error(JSON.stringify(evidence));
    process.exitCode = 1;
  }
}
