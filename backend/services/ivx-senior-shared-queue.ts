import { autonomousWorkerInstanceId, preferDirectTransport, seniorQueuePostgresRpc, readSeniorQueuePostgresDocument, readSeniorQueuePostgresJob, appendSeniorProofPostgresEvent } from './ivx-postgres-autonomous-task-store';
import { appendDurableEvent, durableKeyForFile, readDurableJson } from './ivx-durable-store';

export function sharedSeniorQueueEnabled(): boolean { return process.env.IVX_WORKER_QUEUE_ATOMIC === 'true'; }
type Job = { jobId: string };
type Queue = { jobs: Job[] };
const baselines = new WeakMap<object, Map<string, Job>>();
const readsInFlight = new Map<string, Promise<unknown>>();

// Share only overlapping reads. Every caller owns its snapshot, and no result
// survives completion. A local write fences reads on both sides of the RPC.
async function sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  let pending = readsInFlight.get(key);
  if (!pending) { pending = read(); readsInFlight.set(key, pending); }
  try { return structuredClone(await pending) as T; }
  finally { if (readsInFlight.get(key) === pending) readsInFlight.delete(key); }
}

async function requestRpc(name: string, body: Record<string, unknown>): Promise<Response> {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Shared senior queue requires Supabase');
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Shared senior queue ${name}: ${response.status === 409 ? 'concurrent edit' : 'operation rejected'} (HTTP ${response.status})`);
  return response;
}
async function rpc<T>(name: 'ivx_senior_queue_claim' | 'ivx_senior_queue_patch', body: Record<string, unknown>): Promise<T> {
  // Select the configured same-project transport BEFORE execution. A timeout
  // never triggers a second mutation through another transport.
  readsInFlight.clear();
  try {
    if (preferDirectTransport()) return await seniorQueuePostgresRpc<T>(name, body);
    const response = await requestRpc(name, body);
    try { return await response.json() as T; }
    catch { throw new Error(`Shared senior queue ${name}: invalid JSON response (HTTP ${response.status}); mutation not replayed`); }
  } finally { readsInFlight.clear(); }
}
export function rememberSeniorQueue<T extends Queue>(queue: T): T {
  baselines.set(queue, new Map(queue.jobs.map(j => [j.jobId, structuredClone(j)])));
  return queue;
}
export async function patchSharedSeniorQueue<T extends Queue>(queue: T, claimed: ReadonlySet<string>): Promise<T> {
  const baseline = baselines.get(queue);
  if (!baseline) throw new Error('Queue snapshot missing; refusing blind overwrite');
  const changes = queue.jobs.filter(j => JSON.stringify(j) !== JSON.stringify(baseline.get(j.jobId))).map(next => ({
    next, expected: baseline.get(next.jobId) ?? null, workerInstanceId: claimed.has(next.jobId) ? autonomousWorkerInstanceId() : null,
  }));
  if (!changes.length) return queue;
  const saved = await rpc<T>('ivx_senior_queue_patch', { p_changes: changes });
  if (!saved || !Array.isArray(saved.jobs)) throw new Error('Shared senior queue patch returned an invalid snapshot; mutation not replayed');
  return rememberSeniorQueue(saved);
}
export function claimSharedSeniorJob<T>(jobId: string, resume = false): Promise<T | null> {
  return rpc('ivx_senior_queue_claim', { p_job_id: jobId, p_worker_instance_id: autonomousWorkerInstanceId(), p_resume: resume });
}
export async function putSharedSeniorResult(result: unknown): Promise<void> {
  readsInFlight.clear();
  try {
    if (preferDirectTransport()) { await seniorQueuePostgresRpc('ivx_senior_ledger_put', { p_result: result }); return; }
    // This PostgreSQL function RETURNS void: PostgREST may acknowledge it with
    // HTTP 204 and no body. Parsing JSON here turned persisted proofs into failures.
    const response = await requestRpc('ivx_senior_ledger_put', { p_result: result });
    await response.body?.cancel().catch(() => {});
  } finally { readsInFlight.clear(); }
}

export async function readSharedSeniorDocument<T>(file: string, fallback: T): Promise<T> {
  const key = durableKeyForFile(file);
  if (key !== 'senior-developer-worker/queue.json' && key !== 'senior-developer-worker/proof-ledger.json') throw new Error('Repair document not allowed');
  const direct = preferDirectTransport();
  return sharedRead(`document:${direct}:${key}`, async () => direct
    ? (await readSeniorQueuePostgresDocument<T>(key)) ?? fallback
    : await readDurableJson(file, fallback));
}

export async function readSharedSeniorJob<T extends Job>(file: string, jobId: string): Promise<T | null> {
  if (durableKeyForFile(file) !== 'senior-developer-worker/queue.json') throw new Error('Repair document not allowed');
  if (!jobId.trim()) throw new Error('Repair job identity is required');
  const direct = preferDirectTransport();
  return sharedRead(`job:${direct}:${jobId}`, async () => {
    if (direct) return readSeniorQueuePostgresJob<T>(jobId);
    const queue = await readSharedSeniorDocument(file, { jobs: [] as T[] });
    const matches = queue.jobs.filter(job => job.jobId === jobId);
    if (matches.length > 1) throw new Error('Duplicate repair job identity');
    return matches[0] ?? null;
  });
}

export async function appendSharedSeniorProofEvent(file: string, event: Record<string, unknown>): Promise<void> {
  // The canonical proof has already committed. A supplemental audit-event
  // outage must not overwrite that proof with a false execution failure.
  try {
    if (preferDirectTransport()) await appendSeniorProofPostgresEvent(event);
    else await appendDurableEvent(file, event);
  } catch {
    console.warn('[IVX repair queue] Supplemental proof event unavailable; canonical result retained');
  }
}
