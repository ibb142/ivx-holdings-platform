import { createHash, createDecipheriv } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
export const JOBS = Object.freeze([
  'ivx-worker-a8dfe88b-e594-4e8d-8301-838d41398d1e',
  'ivx-worker-db23d65e-e36e-40d1-affa-5c4c8b679e5b',
]);
export const WINDOWS = Object.freeze([
  ['2026-09-11T00:56:00Z', '2026-09-11T00:57:00Z'],
  ['2026-09-11T00:57:00Z', '2026-09-11T00:58:00Z'],
  ['2026-09-11T03:07:00Z', '2026-09-11T03:08:00Z'],
]);
const SQL = 'select cast(timestamp as datetime) as event_time, event_message, metadata from postgres_logs order by timestamp asc limit 1000';
const LOG_PATH = `/v1/projects/${PROJECT}/analytics/endpoints/logs.all`;
const STORE_URL = `https://${PROJECT}.supabase.co/rest/v1/ivx_owner_variables?select=encrypted_value,value_iv,value_tag,value_hash&name=eq.SUPABASE_ACCESS_TOKEN&limit=2`;
const hash = value => createHash('sha256').update(value).digest('hex');
const mask = value => {
  if (value && process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}\n`);
  }
};

export function logUrl(index) {
  const window = WINDOWS[index];
  if (!window) throw new Error('invalid_window');
  const url = new URL(`https://api.supabase.com${LOG_PATH}`);
  url.searchParams.set('sql', SQL);
  url.searchParams.set('iso_timestamp_start', window[0]);
  url.searchParams.set('iso_timestamp_end', window[1]);
  return url.href;
}

// No arbitrary SQL, host, date range, HTTP method, restart or configuration API.
export async function scopedGet(url, token, fetchImpl = fetch) {
  if (![...WINDOWS.map((_, index) => logUrl(index)), STORE_URL].includes(url)) {
    throw new Error('request_out_of_scope');
  }
  if (!token || /[\r\n]/.test(token)) throw new Error('credential_unavailable');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (url === STORE_URL) headers.apikey = token;
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(25000) });
  } catch { throw new Error('read_request_failed'); }
  // Never include remote response bodies, URLs containing secrets or exception text in logs.
  if (!response.ok) throw new Error(`read_http_${response.status}`);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('invalid_json_response'); }
  return payload;
}

export function decryptOwnerToken(row, env) {
  if (!row?.value_iv || !row?.value_tag || !row?.encrypted_value || !row?.value_hash) {
    throw new Error('owner_token_record_invalid');
  }
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const configured = [env.IVX_OWNER_VARIABLES_ENCRYPTION_KEY, env.APP_SECRET, env.JWT_SECRET,
    service ? hash(`https://${PROJECT}.supabase.co:${service}`) : null].filter(Boolean);
  for (const secret of configured) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), Buffer.from(row.value_iv, 'base64'));
      decipher.setAAD(Buffer.from('ivx_owner_variables:v1'));
      decipher.setAuthTag(Buffer.from(row.value_tag, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(row.encrypted_value, 'base64')), decipher.final()]).toString('utf8');
      if (hash(plaintext) === row.value_hash && plaintext.trim()) return plaintext.trim();
    } catch { /* Use only already configured keys; no changes or password guessing. */ }
  }
  throw new Error('owner_token_decryption_unavailable');
}

export function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload?.error) throw new Error('analytics_query_error');
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data)) return payload.data;
  throw new Error('analytics_shape_unrecognized');
}

export function summarizeRow(row) {
  const serialized = JSON.stringify(row);
  const message = String(row.event_message ?? '');
  const fields = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') visit(child);
      else fields.push([key, child]);
    }
  }
  visit(row.metadata);
  const applications = ['PostgREST', 'postgrest', 'ivx_tasks', 'ivx_repair', 'ivx_presence', 'ivx_telemetry', 'ivx_owner_variables'];
  const roles = ['service_role', 'authenticator', 'postgres', 'supabase_admin', 'supabase_auth_admin', 'anon', 'authenticated'];
  const statements = fields.filter(([key, value]) => ['query', 'statement', 'internal_query'].includes(key) && typeof value === 'string').map(([, value]) => value).join('\n');
  const errorClasses = [
    ['statement_timeout', /canceling statement due to statement timeout/i],
    ['user_request_cancel', /canceling statement due to user request/i],
    ['lock_timeout', /canceling statement due to lock timeout/i],
    ['deadlock', /deadlock detected/i],
    ['connection_termination', /terminating connection|connection reset|unexpected EOF/i],
    ['connection_exhaustion', /too many clients|remaining connection slots/i],
    ['permission_denied', /permission denied/i],
    ['serialization_failure', /could not serialize access/i],
  ].filter(([, pattern]) => pattern.test(message)).map(([name]) => name);
  const matchingJobIds = JOBS.filter(job => serialized.includes(job));
  const rawTime = row.event_time;
  const eventTime = typeof rawTime === 'string' && /^2026-09-11[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)?$/.test(rawTime) ? rawTime : null;
  return {
    recordSha256: hash(serialized), eventTime, errorClasses, matchingJobIds,
    mentionsWorkerQueue: serialized.includes('senior-developer-worker/queue.json'),
    mentionsDurableDocuments: serialized.includes('ivx_durable_documents'),
    matchingWorkerInstances: ['srv-d9i15fg4n6ts73bn00j0-9zjqc', 'srv-d9i15fg4n6ts73bn00j0-bsxzt'].filter(instance => serialized.includes(instance)),
    applicationClasses: [...new Set(fields.filter(([key, value]) => key === 'application_name' && applications.includes(value)).map(([, value]) => value))],
    databaseRoleClasses: [...new Set(fields.filter(([key, value]) => ['user_name', 'user'].includes(key) && roles.includes(value)).map(([, value]) => value))],
    postgresProcessIds: [...new Set(fields.filter(([key, value]) => ['process_id', 'pid'].includes(key) && /^[0-9]{1,10}$/.test(String(value))).map(([, value]) => Number(value)))],
    sessionHashes: [...new Set(fields.filter(([key, value]) => key === 'session_id' && typeof value === 'string' && value).map(([, value]) => hash(value)))],
    statementOperations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].filter(operation => new RegExp(`\\b${operation}\\b`, 'i').test(statements)),
    statementKnownObjects: ['ivx_durable_documents', 'ivx_durable_events', 'ivx_owner_variables', 'ivx_agent_leases', 'ivx_autonomous_tasks'].filter(name => statements.includes(name)),
    statementUsesParameters: /\$[1-9][0-9]*/.test(statements),
    // A shared queue snapshot can contain both IDs. A match is not causal attribution.
    causalAttribution: 'NOT_ESTABLISHED_BY_THIS_RECORD_MATCH',
  };
}

export async function collect(env = process.env, fetchImpl = fetch) {
  const proof = {
    schemaVersion: 1, item: '4.3', project: PROJECT, queriedAt: new Date().toISOString(),
    sourceSha: /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    historicalAcceptance: 'OPEN_PARTIAL', retrievalStatus: 'PENDING',
    readOnly: true, rawLogsPublished: false, secretValuesReturned: false,
    documentation: 'https://supabase.com/docs/reference/api/v1-get-project-logs-all',
    windows: [],
  };
  let token = env.SUPABASE_ACCESS_TOKEN?.trim();
  let first;
  if (token) {
    mask(token);
    try { first = await scopedGet(logUrl(0), token, fetchImpl); proof.credentialSource = 'repository_binding'; }
    catch (error) {
      if (error.message !== 'read_http_401') throw error;
      proof.repositoryBindingStatus = error.message;
    }
  }
  if (!first) {
    const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const rows = await scopedGet(STORE_URL, service, fetchImpl);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('owner_token_missing_or_ambiguous');
    token = decryptOwnerToken(rows[0], env); mask(token);
    first = await scopedGet(logUrl(0), token, fetchImpl);
    proof.credentialSource = 'existing_encrypted_owner_binding';
  }
  for (let index = 0; index < WINDOWS.length; index++) {
    const payload = index === 0 ? first : await scopedGet(logUrl(index), token, fetchImpl);
    const rows = extractRows(payload);
    const summaries = rows.map(summarizeRow);
    proof.windows.push({
      start: WINDOWS[index][0], end: WINDOWS[index][1], rowCount: rows.length,
      completeWithinLimit: rows.length < 1000, responseSha256: hash(JSON.stringify(payload)),
      classCounts: Object.fromEntries([...new Set(summaries.flatMap(row => row.errorClasses))].map(name => [name, summaries.filter(row => row.errorClasses.includes(name)).length])),
      relevantRecords: summaries.filter(row => row.matchingJobIds.length || row.mentionsWorkerQueue || row.mentionsDurableDocuments || row.errorClasses.length),
    });
  }
  proof.retrievalStatus = proof.windows.every(window => window.completeWithinLimit) ? 'COMPLETE_WITHIN_REQUESTED_WINDOWS' : 'ROW_LIMIT_REACHED';
  return proof;
}

async function main() {
  let proof;
  try { proof = await collect(); }
  catch (error) {
    proof = { item: '4.3', project: PROJECT, queriedAt: new Date().toISOString(), historicalAcceptance: 'OPEN_PARTIAL', retrievalStatus: 'UNAVAILABLE',
      reason: /^(read_http_[0-9]{3}|read_request_failed|credential_unavailable|invalid_json_response|analytics_query_error|analytics_shape_unrecognized|owner_token_(?:record_invalid|decryption_unavailable|missing_or_ambiguous))$/.test(error.message) ? error.message : 'diagnostic_failed',
      secretValuesReturned: false, rawLogsPublished: false, readOnly: true };
    process.exitCode = 1;
  }
  await mkdir('qa/evidence/phase2-item43', { recursive: true });
  await writeFile('qa/evidence/phase2-item43/native-logs.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
