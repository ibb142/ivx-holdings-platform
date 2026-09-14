import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { emergencyStopPostgresConfig } from '../../backend/services/ivx-emergency-stop-postgres';
import { connectionIssue } from './autonomous-db-sync.mjs';

const API = 'srv-d7t9ivreo5us73ftose0';
const WORKER = 'srv-d9i15fg4n6ts73bn00j0';
const OWNER = 'tea-d7plj9beo5us73ch3ukg';
const REPO = 'https://github.com/ibb142/ivx-holdings-platform';
const KEY = 'SUPABASE_DB_URL';
class RepairError extends Error {}

export async function probeFeedConnection(config: pg.ClientConfig, role: 'anon' | 'service_role') {
  const client = new pg.Client({ ...config, application_name: 'ivx_feed_binding_read_only_probe',
    connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  client.on('error', () => {}); // Errors are returned as fixed categories below.
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query(role === 'service_role' ? 'SET LOCAL ROLE service_role' : 'SET LOCAL ROLE anon');
    const result = await client.query('SELECT id FROM public.project_videos WHERE is_approved = true LIMIT 2');
    await client.query('ROLLBACK');
    if (result.rows.length === 0) throw new RepairError('feed_binding_catalog_empty');
    return { tlsVerified: true, approvedVideosObserved: result.rows.length };
  } catch (error) {
    if (error instanceof RepairError) throw error;
    throw new RepairError('feed_binding_database_probe_failed');
  } finally { await client.end().catch(() => {}); }
}

/** Stage one existing same-project credential. Never create a deployment. */
export async function repairApiFeedConnection({ token = process.env.RENDER_API_KEY,
  stage = false, expectedLiveSha = process.env.EXPECTED_LIVE_SHA,
  fetchImpl = fetch, probeImpl = probeFeedConnection } = {}) {
  if (!token?.trim() || !/^[a-f0-9]{40}$/.test(expectedLiveSha ?? '')) throw new RepairError('feed_binding_inputs_missing');
  const headers = { Authorization: 'Bearer ' + token.trim(), Accept: 'application/json', 'Content-Type': 'application/json' };
  async function read(path: string, missingAllowed = false): Promise<any> {
    const response = await fetchImpl('https://api.render.com/v1' + path, { headers, signal: AbortSignal.timeout(15000) });
    if (missingAllowed && response.status === 404) return null;
    if (!response.ok) throw new RepairError('feed_binding_read_failed');
    return response.json();
  }
  async function value(service: string, key: string) {
    const row = await read('/services/' + service + '/env-vars/' + key, true);
    const entry = row?.envVar ?? row;
    if (entry === null) return '';
    if (typeof entry?.value !== 'string') throw new RepairError('feed_binding_response_invalid');
    return entry.value;
  }
  for (const id of [API, WORKER]) {
    const service = await read('/services/' + id);
    if (service.ownerId !== OWNER || service.repo !== REPO) throw new RepairError('feed_binding_identity_mismatch');
  }
  const original = await value(API, KEY), candidate = await value(WORKER, KEY);
  if (original === candidate && connectionIssue(candidate) === 'valid') return { changed: false, reason: 'already_matches', secretValuesReturned: false };
  if (connectionIssue(original) !== 'malformed_uri' || connectionIssue(candidate) !== 'valid') throw new RepairError('feed_binding_not_observed_failure');
  const env = { EXPO_PUBLIC_SUPABASE_URL: await value(API, 'EXPO_PUBLIC_SUPABASE_URL'),
    SUPABASE_URL: await value(API, 'SUPABASE_URL'), SUPABASE_DB_URL: candidate };
  let config: pg.ClientConfig;
  try { config = emergencyStopPostgresConfig(env); } catch { throw new RepairError('feed_binding_project_mismatch'); }
  const serviceRole = (await value(API, 'SUPABASE_SERVICE_ROLE_KEY') || await value(API, 'SUPABASE_SERVICE_KEY')).trim();
  const proof = await probeImpl(config, serviceRole ? 'service_role' : 'anon');
  if (proof.tlsVerified !== true || proof.approvedVideosObserved < 1) throw new RepairError('feed_binding_probe_not_verified');
  const rows = await read('/services/' + API + '/deploys?limit=1');
  const latest = rows?.[0]?.deploy ?? rows?.[0];
  if (latest?.status !== 'live' || latest?.commit?.id !== expectedLiveSha) throw new RepairError('feed_binding_live_source_changed');
  if (!stage) return { changed: false, changeRequired: true, key: KEY, source: 'existing_worker_binding', ...proof, secretValuesReturned: false };
  // Recheck both values immediately before the sole mutation; never overwrite
  // a concurrent correction or switch to an unverified source credential.
  if (await value(API, KEY) !== original || await value(WORKER, KEY) !== candidate) throw new RepairError('feed_binding_concurrent_change');
  let response: Response | undefined;
  try {
    response = await fetchImpl('https://api.render.com/v1/services/' + API + '/env-vars/' + KEY,
      { method: 'PUT', headers, body: JSON.stringify({ value: candidate }), signal: AbortSignal.timeout(15000) });
  } catch { /* Reconcile an uncertain response by reading; never replay it. */ }
  if (response && !response.ok && response.status < 500) throw new RepairError('feed_binding_write_rejected');
  if (await value(API, KEY) !== candidate) throw new RepairError('feed_binding_write_unverified');
  return { changed: true, key: KEY, source: 'existing_worker_binding', ...proof,
    runtimeActivationRequired: true, deploymentRequested: false, secretValuesReturned: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  repairApiFeedConnection({ stage: process.env.STAGE_API_BINDING === 'true' })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error instanceof RepairError ? error.message : 'feed_binding_repair_failed'); process.exitCode = 1; });
}
