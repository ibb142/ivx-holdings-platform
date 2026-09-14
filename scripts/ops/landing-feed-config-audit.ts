import { pathToFileURL } from 'node:url';
import { getDatabasePoolBudget } from '../../backend/services/ivx-database-pools';
import { emergencyStopPostgresConfig } from '../../backend/services/ivx-emergency-stop-postgres';

/** Only fixed categories and numeric ceilings may leave the runner. */
export function auditFeedEnvironment(env: NodeJS.ProcessEnv) {
  let projectBinding = 'valid', poolBudget = 'valid';
  let ceilings: ReturnType<typeof getDatabasePoolBudget> | null = null;
  try { emergencyStopPostgresConfig(env); }
  catch (error) {
    projectBinding = error instanceof TypeError ? 'invalid_url'
      : error instanceof Error && error.message === 'owner_control_direct_postgres_project_mismatch' ? 'project_mismatch'
      : 'not_configured';
  }
  try { ceilings = getDatabasePoolBudget(env); }
  catch (error) {
    poolBudget = error instanceof Error && error.message === 'postgres_pool_budget_exceeded' ? 'budget_exceeded' : 'invalid_limit';
  }
  return { scope: 'direct-service-environment', projectBinding, poolBudget, ceilings };
}

export async function auditRenderFeedConfig(fetchImpl = fetch, token = process.env.RENDER_API_KEY) {
  if (!token?.trim()) throw new Error('render_audit_credential_unavailable');
  const targets = [['api', 'srv-d7t9ivreo5us73ftose0'], ['worker', 'srv-d9i15fg4n6ts73bn00j0']];
  const allowed = new Set(['NODE_ENV', 'CI', 'SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL',
    'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'IVX_PG_API_MAX_CONNECTIONS', 'IVX_PG_TASKS_MAX_CONNECTIONS', 'IVX_PG_PROCESS_CONNECTION_LIMIT']);
  async function read(path: string) {
    const response = await fetchImpl('https://api.render.com/v1' + path, {
      headers: { Authorization: 'Bearer ' + token!.trim(), Accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('render_audit_http_' + response.status);
    return response.json();
  }
  const results = [];
  for (const [role, id] of targets) {
    const service = await read('/services/' + id);
    if (service.ownerId !== 'tea-d7plj9beo5us73ch3ukg' || service.repo !== 'https://github.com/ibb142/ivx-holdings-platform') {
      throw new Error('render_audit_identity_mismatch');
    }
    const env: NodeJS.ProcessEnv = {};
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const rows = await read('/services/' + id + '/env-vars?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(rows)) throw new Error('render_audit_response_invalid');
      for (const item of rows) {
        const entry = item.envVar ?? item;
        if (allowed.has(entry.key) && typeof entry.value === 'string') env[entry.key] = entry.value;
      }
      if (rows.length < 100) { cursor = ''; break; }
      const next = rows.at(-1)?.cursor;
      if (!next || next === cursor) throw new Error('render_audit_pagination_invalid');
      cursor = next;
    }
    if (cursor) throw new Error('render_audit_pagination_incomplete');
    results.push({ role, ...auditFeedEnvironment(env) });
  }
  // Inherited env groups are outside this read. A valid configuration is not
  // proof of a successful database query or of the running process's binding.
  return { readOnly: true, inheritedGroupsAudited: false, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditRenderFeedConfig().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(/^render_audit_[a-z0-9_]+$/.test(error?.message) ? error.message : 'render_audit_failed');
    process.exitCode = 1;
  });
}
