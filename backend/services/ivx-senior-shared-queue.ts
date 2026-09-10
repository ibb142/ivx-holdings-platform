import { autonomousWorkerInstanceId } from './ivx-postgres-autonomous-task-store';

export function sharedSeniorQueueEnabled(): boolean { return process.env.IVX_WORKER_QUEUE_ATOMIC === 'true'; }
type Job = { jobId: string };
type Queue = { jobs: Job[] };
const baselines = new WeakMap<object, Map<string, Job>>();

async function requestRpc(name: string, body: Record<string, unknown>): Promise<Response> {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Shared senior queue requires Supabase');
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Shared senior queue ${name}: ${response.status === 409 ? 'concurrent edit' : 'operation rejected'} (HTTP ${response.status})`);
  return response;
}
async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await requestRpc(name, body);
  try { return await response.json() as T; }
  catch { throw new Error(`Shared senior queue ${name}: invalid JSON response (HTTP ${response.status}); mutation not replayed`); }
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
  // This PostgreSQL function RETURNS void: PostgREST may acknowledge it with
  // HTTP 204 and no body. Parsing JSON here turned persisted proofs into failures.
  const response = await requestRpc('ivx_senior_ledger_put', { p_result: result });
  await response.body?.cancel().catch(() => {});
}
