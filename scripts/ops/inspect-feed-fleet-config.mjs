import { pathToFileURL } from 'node:url';

const services = ['srv-d7t9ivreo5us73ftose0', 'srv-d9i15fg4n6ts73bn00j0'];
const keys = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'];
export function summarizeConfig(env) {
  const selected = keys.find(key => env[key]?.trim());
  let project = null, binding = 'not_configured', target = 'none';
  try { project = /^([a-z0-9]+)\.supabase\.co$/.exec(new URL(env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').hostname)?.[1] || null; } catch {}
  if (selected) {
    try {
      const db = new URL(env[selected]);
      target = db.hostname.endsWith('.pooler.supabase.com') ? 'supabase_pooler'
        : db.hostname.endsWith('.supabase.co') ? 'supabase_direct' : 'other_database';
      const user = decodeURIComponent(db.username);
      binding = project && (db.hostname === `db.${project}.supabase.co`
        || (target === 'supabase_pooler' && user === `postgres.${project}`))
        && ['postgres:', 'postgresql:'].includes(db.protocol) && db.password && user && db.pathname === '/postgres'
        ? 'valid' : 'project_or_connection_mismatch';
    } catch { binding = 'invalid_url'; }
  }
  const controls = {};
  for (const key of ['IVX_AUTONOMOUS_QUEUE_BACKEND', 'IVX_SUPABASE_RECOVERY_MODE', 'IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED', 'IVX_PG_API_MAX_CONNECTIONS', 'IVX_PG_TASKS_MAX_CONNECTIONS', 'IVX_PG_PROCESS_CONNECTION_LIMIT']) {
    const value = env[key];
    controls[key] = value === undefined ? 'unset' : /^(?:true|false|postgres_atomic|[0-9]{1,5})$/.test(value) ? value : 'unrecognized';
  }
  return { projectConfigured: Boolean(project), selectedDatabaseKey: selected || null, target, binding,
    presence: Object.fromEntries([...keys, 'SUPABASE_SERVICE_ROLE_KEY', 'APP_SECRET', 'IVX_OWNER_VARIABLES_ENCRYPTION_KEY'].map(key => [key, Boolean(env[key]?.trim())])), controls };
}

export function apiRepairCandidate(apiEnv, workerEnv) {
  const api = summarizeConfig(apiEnv), worker = summarizeConfig(workerEnv);
  const replacement = summarizeConfig({ ...apiEnv, SUPABASE_DB_URL: workerEnv.SUPABASE_DB_URL });
  return { sourceServiceId: services[1], targetServiceId: services[0], key: 'SUPABASE_DB_URL',
    sameProjectBinding: worker.binding === 'valid' && replacement.binding === 'valid',
    eligible: api.selectedDatabaseKey === 'SUPABASE_DB_URL' && api.binding === 'invalid_url'
      && worker.selectedDatabaseKey === 'SUPABASE_DB_URL' && worker.binding === 'valid' && replacement.binding === 'valid',
    applied: false, unresolved: 'database_authentication_and_deployment_approval' };
}

export async function inspect({ token = process.env.RENDER_API_KEY, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('RENDER_API_KEY_MISSING');
  const output = [];
  const environments = [];
  for (const serviceId of services) {
    const env = {};
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const url = new URL(`https://api.render.com/v1/services/${serviceId}/env-vars`);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`RENDER_CONFIG_HTTP_${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('RENDER_CONFIG_INVALID_RESPONSE');
      for (const row of rows) if (row.envVar && typeof row.envVar.key === 'string' && typeof row.envVar.value === 'string') env[row.envVar.key] = row.envVar.value;
      if (rows.length < 100) break;
      const next = rows.at(-1)?.cursor;
      if (!next || next === cursor || page === 19) throw new Error('RENDER_CONFIG_PAGINATION_INCOMPLETE');
      cursor = next;
    }
    output.push({ serviceId, scope: 'service_environment_api_response',
      unresolved: 'linked_group_inheritance_and_runtime_overrides', ...summarizeConfig(env) });
    environments.push(env);
  }
  output[0].repairCandidate = apiRepairCandidate(environments[0], environments[1]);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify({ observedAt: new Date().toISOString(), services: await inspect() }, null, 2)); }
  catch (error) { console.error(error instanceof Error && /^RENDER_[A-Z_0-9]+$/.test(error.message) ? error.message : 'RENDER_CONFIG_INSPECTION_FAILED'); process.exitCode = 1; }
}
