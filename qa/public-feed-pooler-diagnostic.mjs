import { pathToFileURL } from 'node:url';

const PROJECT = 'kvclcdjmjghndxsngfzb';
const SERVICES = ['srv-d7t9ivreo5us73ftose0', 'srv-d9i15fg4n6ts73bn00j0'];
const DATABASE_KEYS = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'];
const numericKeys = ['default_pool_size', 'max_client_conn', 'server_idle_timeout', 'query_wait_timeout', 'db_pool', 'db_pool_acquisition_timeout'];

export function summarizeCompute(data) {
  const variant = row => {
    if (!/^ci_(nano|micro|small|medium|large|xl|2xl|4xl|8xl|12xl|16xl)$/.test(row?.id || '')) return [];
    const result = { id: row.id };
    if (Number.isFinite(row.price?.amount) && row.price.amount >= 0) result.amount = row.price.amount;
    if (['hourly', 'monthly', 'yearly'].includes(row.price?.interval)) result.interval = row.price.interval;
    if (['fixed', 'usage'].includes(row.price?.type)) result.priceType = row.price.type;
    return [result];
  };
  return {
    selected: (Array.isArray(data?.selected_addons) ? data.selected_addons : []).flatMap(row => variant(row.variant)),
    available: (Array.isArray(data?.available_addons) ? data.available_addons : [])
      .flatMap(row => (Array.isArray(row.variants) ? row.variants : []).flatMap(variant)),
  };
}

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

async function readJson(fetchImpl, url, token, textOnly = false) {
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
  const text = Buffer.concat(parts).toString('utf8');
  return textOnly ? text : JSON.parse(text);
}

export function summarizeMetrics(text) {
  const totals = {};
  const exact = new Set(['node_load1', 'node_load5', 'node_load15', 'node_memory_MemTotal_bytes',
    'node_memory_MemAvailable_bytes', 'node_memory_SwapTotal_bytes', 'node_memory_SwapFree_bytes',
    'pgbouncer_pools_cl_active', 'pgbouncer_pools_cl_waiting', 'pgbouncer_pools_sv_active',
    'pgbouncer_pools_sv_idle', 'pgbouncer_pools_maxwait', 'pg_stat_activity_count',
    'node_vmstat_pswpin', 'node_vmstat_pswpout']);
  for (const line of text.split('\n')) {
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?)(?:\s+\d+)?$/i.exec(line);
    if (!match) continue;
    const [, name, labels = '', raw] = match, value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    if (exact.has(name)) totals[name] = (totals[name] || 0) + value;
    if (name === 'node_cpu_seconds_total') {
      const mode = /(?:^|,)mode="(user|system|idle|iowait|steal|irq|softirq|nice)"(?:,|$)/.exec(labels)?.[1];
      if (mode) totals['cpu_seconds_' + mode] = (totals['cpu_seconds_' + mode] || 0) + value;
    }
    if (['node_disk_reads_completed_total', 'node_disk_writes_completed_total',
      'node_disk_read_bytes_total', 'node_disk_written_bytes_total', 'node_disk_io_time_seconds_total',
      'node_disk_io_now'].includes(name)) {
      const device = /(?:^|,)device="(nvme0n1|nvme1n1)"(?:,|$)/.exec(labels)?.[1];
      if (device) totals[device + '_' + name] = value;
    }
  }
  return totals;
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
      const route = setting === 'postgrest' ? 'postgrest' : `config/database/${setting}`;
      const data = await readJson(fetchImpl, `https://api.supabase.com/v1/projects/${PROJECT}/${route}`, managementToken);
      evidence.configuration.push({ setting, values: summarizePool(data) });
    } catch (error) { evidence.configuration.push({ setting, error: safeError(error) }); }
  }
  if (managementToken) {
    try {
      const data = await readJson(fetchImpl, `https://api.supabase.com/v1/projects/${PROJECT}/billing/addons`, managementToken);
      evidence.compute = summarizeCompute(data);
    } catch (error) { evidence.compute = { error: safeError(error) }; }
    try {
      const data = await readJson(fetchImpl, `https://api.supabase.com/v1/projects/${PROJECT}/analytics/endpoints/metrics`, managementToken, true);
      evidence.databaseMetrics = summarizeMetrics(data);
    } catch (error) { evidence.databaseMetrics = { error: safeError(error) }; }
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await inspect();
  console.log(JSON.stringify(evidence));
  if (evidence.bindings.some(row => row.error || row.targetMatches !== true)
      || evidence.configuration.filter(row => !row.error).length === 0) process.exitCode = 1;
}
