import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
export const EXPECTED_BOOT = '2026-09-11T16:42:14.546215Z';
export const CONFIRMED_INCIDENT = 'qa-103469136770-and-cleanup-members-lock-55P03';
const BASE = `https://api.supabase.com/v1/projects/${PROJECT}`;
const EXPIRES = Date.parse('2026-09-12T01:45:00Z');

// One owner-authorized incident. This is not a scheduled restart policy.
export async function recoverAuth({ token, runAttempt, confirmedIncident, fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = Date.now,
  checkpoint = () => {} } = {}) {
  const receipt = { project: PROJECT, authorization: 'owner-2026-09-12-0049-single-restart',
    precedingQaJob: 103469136770, expectedBoot: EXPECTED_BOOT, startedAt: new Date(clock()).toISOString(),
    restartRequests: 0, restartAcknowledged: false, probes: [], result: 'UNVERIFIED',
    confirmedIncident: confirmedIncident === CONFIRMED_INCIDENT ? CONFIRMED_INCIDENT : null };
  const save = () => checkpoint(structuredClone(receipt));
  const request = async (path, { method = 'GET', body, timeout = 30000 } = {}) => {
    try {
      const response = await fetchImpl(BASE + path, { method, redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      return { status: response.status, data };
    } catch { return { status: 0, data: null }; }
  };
  const probe = async () => {
    const r = await request('/health?services=auth');
    const rows = Array.isArray(r.data) ? r.data : r.data?.services;
    const matches = Array.isArray(rows) ? rows.filter(row => row.name === 'auth') : [];
    const healthy = r.status === 200 && matches.length === 1 && typeof matches[0].healthy === 'boolean'
      ? matches[0].healthy : null;
    receipt.probes.push({ at: new Date(clock()).toISOString(), http: r.status, healthy }); save();
    return healthy;
  };
  try {
    if (runAttempt !== '1' || clock() > EXPIRES || clock() < Date.parse('2026-09-12T00:49:00Z'))
      throw new Error('authorization_window_or_attempt_invalid');
    if (!token?.trim()) throw new Error('management_credential_missing');
    const project = await request('');
    if (project.status !== 200 || project.data?.id !== PROJECT ||
      !['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'ACTIVE', 'RESTARTING', 'COMING_UP'].includes(project.data.status))
      throw new Error('project_identity_or_lifecycle_unverified');
    receipt.initialProjectStatus = project.data.status;
    const first = await probe(); await wait(2000); const second = await probe();
    // Service health alone does not cover the owner-authorized incident: the
    // actual hosted QA failed and its exact temporary member cleanup hit 55P03.
    // That confirmed database lock is independent of the Auth liveness probe.
    const knownLockIncident = confirmedIncident === CONFIRMED_INCIDENT;
    if (!knownLockIncident && first === true && second === true) { receipt.result = 'AUTH_ALREADY_HEALTHY'; return receipt; }
    if (!knownLockIncident && (first === null || second === null)) throw new Error('two_explicit_unhealthy_auth_probes_required');
    // Flapping was observed in the first incident sample. Keep the same two
    // consecutive unhealthy requirement, with at most six total observations.
    let unhealthy = second === false ? (first === false ? 2 : 1) : 0;
    for (let extra = 0; !knownLockIncident && unhealthy < 2 && extra < 4; extra++) {
      await wait(2000);
      const next = await probe();
      if (next === null) throw new Error('auth_health_unverified');
      unhealthy = next === false ? unhealthy + 1 : 0;
    }
    if (!knownLockIncident && unhealthy < 2) throw new Error('two_explicit_unhealthy_auth_probes_required');
    const boot = await request('/database/query/read-only', { method: 'POST', timeout: 60000,
      body: { query: 'select pg_catalog.pg_postmaster_start_time() as boot_at' } });
    const rows = Array.isArray(boot.data) ? boot.data : boot.data?.result;
    receipt.bootQueryHttp = boot.status;
    if (![200, 201].includes(boot.status) || !Array.isArray(rows) || rows.length !== 1 || !Number.isFinite(Date.parse(rows[0].boot_at)))
      throw new Error('database_boot_unverified');
    receipt.observedBoot = rows[0].boot_at;
    if (Date.parse(rows[0].boot_at) !== Date.parse(EXPECTED_BOOT)) {
      receipt.result = 'BOOT_CHANGED_NO_ADDITIONAL_RESTART'; return receipt;
    }
    const current = await request('');
    if (current.status !== 200 || current.data?.id !== PROJECT) throw new Error('project_recheck_failed');
    if (['RESTARTING', 'COMING_UP'].includes(current.data.status)) receipt.observingExistingRestart = true;
    else {
      if (!['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'ACTIVE'].includes(current.data.status) || clock() > EXPIRES)
        throw new Error('lifecycle_or_authorization_changed');
      receipt.restartRequests = 1; receipt.restartRequestedAt = new Date(clock()).toISOString(); save();
      const restart = await request('/restart', { method: 'POST', timeout: 45000 });
      receipt.restartHttp = restart.status;
      receipt.restartAcknowledged = [200, 201, 202].includes(restart.status);
      if (!receipt.restartAcknowledged && restart.status !== 0) throw new Error('restart_rejected');
      receipt.restartUncertain = restart.status === 0; save();
    }
    let consecutive = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      await wait(10000);
      consecutive = await probe() === true ? consecutive + 1 : 0;
      if (consecutive === 3) { receipt.result = 'AUTH_RECOVERED'; return receipt; }
    }
    throw new Error('auth_recovery_not_verified_no_restart_retry');
  } catch (error) { receipt.error = error.message; return receipt; }
  finally { receipt.finishedAt = new Date(clock()).toISOString(); save(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync('qa-results', { recursive: true });
  const receipt = await recoverAuth({ token: process.env.SUPABASE_ACCESS_TOKEN,
    confirmedIncident: CONFIRMED_INCIDENT,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    checkpoint: value => writeFileSync('qa-results/auth-recovery.json', JSON.stringify(value, null, 2) + '\n') });
  console.log(JSON.stringify(receipt));
  if (!['AUTH_RECOVERED', 'AUTH_ALREADY_HEALTHY'].includes(receipt.result)) process.exitCode = 1;
}
