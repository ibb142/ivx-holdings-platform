import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const ENDPOINT = 'https://kvclcdjmjghndxsngfzb.supabase.co/customer/v1/privileged/metrics';
const allowed = /^(node_cpu_seconds_total|node_load(?:1|5|15)|node_memory_(?:MemTotal|MemFree|MemAvailable|Cached|Buffers|SwapTotal|SwapFree)_bytes|node_disk_(?:io_time_seconds_total|io_time_weighted_seconds_total|read_bytes_total|written_bytes_total)|pg_stat_database_(?:numbackends|deadlocks|temp_bytes|blks_read|blks_hit|xact_commit|xact_rollback)|pg_stat_activity_count|pg_settings_max_connections|pg_up)$/;

// Retain only numeric infrastructure series and allowlisted categorical labels.
// In particular, SQL, owner identities, arbitrary label values and raw metrics
// never leave the runner. Hashes identify the inspected response, not a saved file.
export function summarizeMetrics(body) {
  const rows = [];
  for (const line of body.split('\n')) {
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+0-9.eE]+)(?:\s+\d+)?\s*$/.exec(line);
    if (!match || !allowed.test(match[1]) || !Number.isFinite(Number(match[3]))) continue;
    const labels = {};
    for (const label of (match[2] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"\\]*)"/g)) {
      const [, name, value] = label;
      if (name === 'cpu' && /^\d{1,3}$/.test(value)) labels.cpu = value;
      if (name === 'mode' && ['idle','user','system','nice','iowait','irq','softirq','steal','guest','guest_nice'].includes(value)) labels.mode = value;
      if (name === 'state' && ['active','idle','idle in transaction','idle in transaction (aborted)','disabled','fastpath function call'].includes(value)) labels.state = value;
      if (name === 'device' && /^(nvme\d+n\d+(?:p\d+)?|[vsxh]d[a-z]\d*)$/.test(value)) labels.device = value;
    }
    rows.push({ name: match[1], labels, value: Number(match[3]) });
  }
  if (!rows.length) throw new Error('recognized_metrics_unavailable');
  return { responseSha256: createHash('sha256').update(body).digest('hex'), series: rows };
}

export async function sample(key, fetchImpl = fetch) {
  if (!key?.trim() || /[\r\n]/.test(key)) throw new Error('credential_unavailable');
  const startedAt = new Date().toISOString();
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: { Authorization: 'Basic ' + Buffer.from('service_role:' + key.trim()).toString('base64'), Accept: 'text/plain' },
    });
  } catch { throw new Error('metrics_request_failed'); }
  if (!response.ok) throw new Error('metrics_http_' + response.status);
  // Bound the read while preserving the same request deadline.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('metrics_body_unavailable');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('metrics_body_limit'); }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error.message === 'metrics_body_limit') throw error;
    throw new Error('metrics_body_failed');
  }
  return { startedAt, receivedAt: new Date().toISOString(), ...summarizeMetrics(Buffer.concat(chunks).toString('utf8')) };
}

async function main() {
  const proof = { item: '5.4', acceptance: 'NOT_CERTIFIED_BY_METRICS', project: 'kvclcdjmjghndxsngfzb',
    sourceSha: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : null,
    readOnly: true, rawMetricsPublished: false, samples: [] };
  try {
    proof.samples.push(await sample(process.env.SUPABASE_SERVICE_ROLE_KEY));
    await new Promise(resolve => setTimeout(resolve, 60000));
    proof.samples.push(await sample(process.env.SUPABASE_SERVICE_ROLE_KEY));
    proof.retrieval = 'COMPLETE';
  } catch (error) {
    proof.retrieval = 'UNAVAILABLE';
    proof.reason = /^(credential_unavailable|recognized_metrics_unavailable|metrics_(?:http_\d{3}|request_failed|body_unavailable|body_failed|body_limit))$/.test(error.message) ? error.message : 'diagnostic_failed';
    process.exitCode = 1;
  }
  await mkdir('qa/evidence/phase2-item54', { recursive: true });
  await writeFile('qa/evidence/phase2-item54/db-metrics.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
