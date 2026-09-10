import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';

const REPOSITORY = 'ibb142/ivx-holdings-platform';
const REQUEST_PATH = 'qa/certification/item-9-recovery-request.json';
const SHA = /^[a-f0-9]{40}$/;
type RequestRef = { sha: string; context: string };

export function authorizedItem9Run(env: Record<string, string | undefined>): boolean {
  return env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF_NAME === 'main'
    && env.GITHUB_ACTOR === 'ibb142'
    && ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME ?? '');
}

export function item9RequestRef(raw: string): RequestRef {
  const request = JSON.parse(raw);
  assert.equal(request.schema_version, 1);
  assert.equal(request.item, 9);
  assert.equal(request.merge_marker, '[verify-fleet-ha-recovery]');
  assert(typeof request.requested_from_sha === 'string' && SHA.test(request.requested_from_sha), 'Invalid request source SHA');
  const fingerprint = createHash('sha256').update(raw).digest('hex').slice(0, 20);
  return { sha: request.requested_from_sha, context: `ivx/item9-request-${fingerprint}` };
}

/** GitHub returns commit statuses newest first. A failed attempt stays pending. */
export function item9RequestPending(ref: RequestRef, statuses: unknown): boolean {
  assert(Array.isArray(statuses), 'Invalid GitHub status response');
  const latest = statuses.find(row => row && row.context === ref.context);
  return latest?.state !== 'success';
}

export function item9CompletionStatus(ref: RequestRef, target: string, currentMain: string,
  runId: string, proof: Record<string, any>, stabilityPassed: boolean) {
  assert(SHA.test(target) && target === currentMain, 'Certification was superseded by another main revision');
  assert(/^\d+$/.test(runId), 'Invalid certification run ID');
  assert.equal(stabilityPassed, true, 'Five-minute stability must complete');
  assert.equal(proof.sourceSha, target);
  assert.equal(proof.verification, 'PASS');
  assert.equal(proof.rollingWorkerRestart, true, 'A topology-only run cannot close the recovery request');
  assert.equal(proof.workerProcessReplacement, 'PASS');
  assert.equal(proof.apiAvailabilityDuringRestart, 'PASS');
  assert.equal(proof.sharedStateObservation?.status, 'PASS');
  assert.equal(proof.sharedStateObservationAfterRestart?.status, 'PASS');
  return {
    state: 'success', context: ref.context,
    description: `Item 9 request completed by ${target}`,
    target_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}`,
  };
}

async function github(path: string, body?: unknown): Promise<any> {
  assert(process.env.GH_TOKEN, 'GitHub status credential is required');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `GitHub status request failed with HTTP ${response.status}`);
  return response.json();
}

async function run(mode: string | undefined) {
  assert(mode === 'resolve' || mode === 'complete', 'Expected resolve or complete');
  if (!authorizedItem9Run(process.env)) { console.log('item9_request=inactive'); return; }
  if (mode === 'complete' && !process.env.IVX_HA_REQUEST_CONTEXT) return;
  const raw = await readFile(REQUEST_PATH, 'utf8').catch(error => {
    if (error?.code === 'ENOENT' && mode === 'resolve') return null;
    throw error;
  });
  if (raw === null) return;
  const ref = item9RequestRef(raw);
  if (mode === 'resolve') {
    const statuses = await github(`commits/${ref.sha}/statuses?per_page=100`);
    if (!item9RequestPending(ref, statuses)) { console.log(`item9_request=completed context=${ref.context}`); return; }
    assert(process.env.GITHUB_ENV, 'GitHub environment file is required');
    await appendFile(process.env.GITHUB_ENV, [
      `IVX_HA_REQUEST_SHA=${ref.sha}`, `IVX_HA_REQUEST_CONTEXT=${ref.context}`,
      'IVX_HA_RESTART_WORKER=true', 'IVX_AUTHORIZED_SYSTEM_FALLBACK=true', '',
    ].join('\n'));
    console.log(`item9_request=pending context=${ref.context} full_recovery=true`);
    return;
  }
  assert.equal(process.env.IVX_HA_REQUEST_SHA, ref.sha);
  assert.equal(process.env.IVX_HA_REQUEST_CONTEXT, ref.context);
  const current = await github('branches/main');
  const proof = JSON.parse(await readFile('qa/evidence/fleet-ha/live.json', 'utf8'));
  const status = item9CompletionStatus(ref, process.env.IVX_TARGET_SHA ?? '', current.commit?.sha,
    process.env.GITHUB_RUN_ID ?? '', proof, process.env.IVX_ITEM9_STABILITY_VERIFIED === 'true');
  await github(`statuses/${ref.sha}`, status);
  console.log(`item9_request=completed certified_sha=${process.env.IVX_TARGET_SHA} context=${ref.context}`);
}

if (import.meta.main) await run(process.argv[2]);
