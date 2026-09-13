import { pathToFileURL } from 'node:url';

const PROJECT = 'kvclcdjmjghndxsngfzb';
const SERVICES = ['srv-d7t9ivreo5us73ftose0', 'srv-d9i15fg4n6ts73bn00j0'];
const DATABASE_KEYS = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'];
const numericKeys = ['default_pool_size', 'max_client_conn', 'server_idle_timeout', 'query_wait_timeout', 'db_pool'];

export function summarizePool(value) {
  return (Array.isArray(value) ? value : [value]).slice(0, 10).map(row => {
    const result = {};
    for (const key of numericKeys) if (Number.isSafeInteger(row?.[key]) && row[key] >= 0) result[key] = row[key];
    if (['transaction', 'session'].includes(row?.pool_mode)) result.pool_mode = row.pool_mode;
    if (['PRIMARY', 'READ_REPLICA'].includes(row?.database_type)) result.database_type = row.database_type;
    return result;
  });
}

export function summarizeBinding(values) {
  const selectedKey = DATABASE_KEYS.find(key => values[key]?.trim());
  if (!selectedKey) return { configured: false };
  try {
    const url = new URL(values[selectedKey].trim());
    const pooled = url.hostname.endsWith('.pooler.supabase.com');
    const direct = url.hostname === `db.${PROJECT}.supabase.co`;
    const port = Number(url.port || 5432);
    return { configured: true, selectedKey, port,
      targetMatches: ['postgres:', 'postgresql:'].includes(url.protocol) && url.pathname === '/postgres'
        && Boolean(url.password) && (direct || (pooled && decodeURIComponent(url.username) === `postgres.${PROJECT}`)),
      mode: pooled ? (port === 6543 ? 'transaction' : port === 5432 ? 'session' : 'unknown') : direct ? 'direct' : 'unknown',
      poolerRegionMatches: pooled ? /-us-west-2\.pooler\.supabase\.com$/.test(url.hostname) : null,
    };
  } catch { return { configured: true, validUrl: false }; }
}

async function readJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP_${response.status}`); }
  const reader = response.body.getReader(), parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2_000_000) throw new Error('RESPONSE_TOO_LARGE');
      parts.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

const safeError = error => /^HTTP_\d{3}$|^RESPONSE_TOO_LARGE$|^PAGINATION_LIMIT$/.test(error?.message || '')
  ? error.message : 'READ_UNAVAILABLE';

export async function inspect({ fetchImpl = fetch, env = process.env } = {}) {
  const evidence = { observedAt: new Date().toISOString(), readOnly: true, bindings: [], configuration: [] };
  let managementToken = env.SUPABASE_ACCESS_TOKEN?.trim();
  const renderToken = env.RENDER_API_KEY?.trim();
  for (const service of SERVICES) {
    if (!renderToken) { evidence.bindings.push({ service, error: 'RENDER_CREDENTIAL_MISSING' }); continue; }
    try {
      const values = {};
      let cursor = '';
      for (let page = 0; page < 8; page++) {
        const rows = await readJson(fetchImpl, `https://api.render.com/v1/services/${service}/env-vars?limit=100`
          + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''), renderToken);
        if (!Array.isArray(rows)) throw new Error('INVALID_ENV_RESPONSE');
        for (const row of rows) {
          const item = row.envVar;
          if ([...DATABASE_KEYS, 'SUPABASE_ACCESS_TOKEN'].includes(item?.key) && typeof item.value === 'string') values[item.key] = item.value;
        }
        if (rows.length < 100) break;
        const next = rows.at(-1)?.cursor;
        if (typeof next !== 'string' || !next || next === cursor || page === 7) throw new Error('PAGINATION_LIMIT');
        cursor = next;
      }
      evidence.bindings.push({ service, ...summarizeBinding(values) });
      managementToken ||= values.SUPABASE_ACCESS_TOKEN?.trim();
    } catch (error) { evidence.bindings.push({ service, error: safeError(error) }); }
  }
  for (const setting of ['pgbouncer', 'pooler', 'postgrest']) {
    if (!managementToken) { evidence.configuration.push({ setting, error: 'MANAGEMENT_CREDENTIAL_MISSING' }); continue; }
    try {
      const data = await readJson(fetchImpl, `https://api.supabase.com/v1/projects/${PROJECT}/config/database/${setting}`, managementToken);
      evidence.configuration.push({ setting, values: summarizePool(data) });
    } catch (error) { evidence.configuration.push({ setting, error: safeError(error) }); }
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await inspect();
  console.log(JSON.stringify(evidence));
  if (evidence.bindings.some(row => row.error || row.targetMatches !== true)
      || evidence.configuration.filter(row => !row.error).length === 0) process.exitCode = 1;
}
