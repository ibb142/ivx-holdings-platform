import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PHASE1_ITEMS = Object.freeze([
  '12.1', '12.2', '12.3', '12.4', '12.5',
  '15.1', '15.2', '15.3', '15.4', '15.5', '15.6', '15.7', '15.8',
  '1.1', '1.2', '1.3', '1.4', '1.5',
  '2.1', '2.2', '2.3', '2.4', '2.5',
  '7.1', '7.2', '7.3', '7.4', '7.5',
]);

// This workflow observes only code checks and API probes. Neither source text,
// an old certificate file nor HTTP liveness proves the 28 operational checks.
export async function collectDeploymentEvidence({ env = process.env, fetchImpl = fetch,
  now = () => new Date().toISOString(), timeoutMs = 10_000 } = {}) {
  const sha = env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw Error('A full source SHA is required');
  if (!/^\d+$/.test(env.GITHUB_RUN_ID || '')) throw Error('A workflow run ID is required');
  const startedAt = now();
  async function probe(path, select) {
    const started = performance.now();
    const controller = new AbortController();
    let timer;
    const work = (async () => {
      const response = await fetchImpl(`https://api.ivxholding.com${path}`, {
        method: 'GET', redirect: 'error', signal: controller.signal,
      });
      const body = await response.json();
      return { status: response.status, ...select(body) };
    })();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('deadline')); }, timeoutMs);
    });
    try { return { ...await Promise.race([work, deadline]), observedAt: now(), elapsedMs: Math.round(performance.now() - started) }; }
    catch { return { status: 0, ok: false, error: 'request_failed_or_invalid_or_timed_out', observedAt: now(), elapsedMs: Math.round(performance.now() - started) }; }
    finally { clearTimeout(timer); }
  }
  const validSha = value => /^[a-f0-9]{40}$/.test(value || '') ? value : null;
  const health = await probe('/health', b => ({ ok: b?.ok === true, commit: validSha(b?.commit) }));
  const version = await probe('/version', b => ({ commit: validSha(b?.commit ?? b?.version?.commit) }));
  const readiness = await probe('/health/ready', b => ({ ok: b?.ok === true,
    databaseOk: b?.checks?.database?.ok === true, authOk: b?.checks?.auth?.ok === true,
    queueOk: b?.checks?.queue?.ok === true, aiOk: b?.checks?.ai?.ok === true }));
  const apiExactSha = health.status === 200 && health.ok && health.commit === sha && version.status === 200 && version.commit === sha;
  const dependenciesReady = readiness.status === 200 && readiness.ok && readiness.databaseOk && readiness.authOk && readiness.queueOk && readiness.aiOk;
  return {
    evidenceType: 'IVX_CODE_AND_DEPLOYMENT_OBSERVATIONS', schemaVersion: 1,
    certified: false, certificationStatus: 'NOT_CERTIFIED',
    startedAt, observedAt: now(), githubSha: sha, workflowRunId: env.GITHUB_RUN_ID,
    probeGatePassed: apiExactSha && dependenciesReady,
    observations: { apiExactSha, dependenciesReady, health, version, readiness },
    phases: { phase1: 'NOT_CERTIFIED', phase2: 'NOT_CERTIFIED', phase3: 'NOT_CERTIFIED', phase4: 'NOT_CERTIFIED' },
    phase1Checklist: PHASE1_ITEMS.map(item => ({ item, result: 'NOT_CERTIFIED', reason: 'Full item acceptance is not executed by this workflow' })),
    claim: 'Partial evidence only. This workflow does not certify frontend, worker continuity, owner authorization, emergency control or the complete phase checklist.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await collectDeploymentEvidence();
  mkdirSync('certification', { recursive: true });
  writeFileSync('certification/IVX-DEPLOYMENT-OBSERVATIONS.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.probeGatePassed) process.exitCode = 1;
}
