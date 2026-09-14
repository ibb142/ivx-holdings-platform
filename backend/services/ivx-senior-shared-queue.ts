import { assertLedgerPageRequest, type SeniorLedgerPage } from './ivx-senior-ledger-page';
import { readSeniorQueuePostgresJobs, readSeniorActiveOwnerJobPostgres, autonomousWorkerInstanceId, preferDirectTransport, seniorQueuePostgresRpc, readSeniorQueuePostgresDocument, readSeniorQueuePostgresJob, readSeniorWorkQueuePostgres, appendSeniorProofPostgresEvent } from './ivx-postgres-autonomous-task-store';
import { appendDurableEvent, durableKeyForFile, readDurableJson } from './ivx-durable-store';
import { seniorJobBatchIds, verifiedSeniorJobBatch, SENIOR_QUEUE_ACTIVE_STATUSES, isSeniorQueueWorkItem } from './ivx-senior-work-queue';

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
async function rpc<T>(name: 'ivx_senior_queue_claim' | 'ivx_senior_queue_patch_receipt', body: Record<string, unknown>): Promise<T> {
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
  const snapshot = structuredClone(queue);
  const saved = await rpc<{ kind: string; updatedAt: string; jobs: Job[]; removedJobIds: string[] }>(
    'ivx_senior_queue_patch_receipt', { p_changes: changes });
  const invalid = () => new Error('Shared senior queue patch returned an invalid snapshot receipt; mutation not replayed');
  if (!saved || saved.kind !== 'ivx-senior-patch-receipt-v1' || !Array.isArray(saved.jobs)
    || !Array.isArray(saved.removedJobIds) || !Number.isFinite(Date.parse(saved.updatedAt))) throw invalid();
  const expected = new Set(changes.map(change => change.next.jobId));
  const acknowledged = new Set<string>();
  for (const id of [...saved.jobs.map(job => job?.jobId), ...saved.removedJobIds]) {
    if (typeof id !== 'string' || !expected.has(id) || acknowledged.has(id)) throw invalid();
    acknowledged.add(id);
  }
  if (acknowledged.size !== expected.size) throw invalid();
  const updates = new Map(saved.jobs.map(job => [job.jobId, job]));
  const removed = new Set(saved.removedJobIds);
  // This remains the caller's snapshot, with authoritative mutation receipts.
  // Unrelated jobs are neither refreshed nor dropped; their old CAS baselines
  // still reject concurrent changes. Scheduling always obtains a fresh read.
  return rememberSeniorQueue({ ...snapshot, updatedAt: saved.updatedAt,
    jobs: snapshot.jobs.filter(job => !removed.has(job.jobId)).map(job => updates.get(job.jobId) ?? job) });
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

/** Commit a fenced post-merge observation to the queue and proof ledger atomically. */
export async function commitSharedSeniorPostMergeResult(expected: unknown, next: unknown): Promise<void> {
  readsInFlight.clear();
  try {
    const body = { p_expected: expected, p_next: next };
    if (preferDirectTransport()) { await seniorQueuePostgresRpc('ivx_senior_post_merge_commit', body); return; }
    const response = await requestRpc('ivx_senior_post_merge_commit', body);
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

export async function readSharedSeniorWorkQueue<T extends { jobs: Array<{ status: string }> }>(file: string, fallback: T): Promise<T> {
  const key = durableKeyForFile(file);
  if (key !== 'senior-developer-worker/queue.json') throw new Error('Repair work queue not allowed');
  const direct = preferDirectTransport();
  return sharedRead(`work:${direct}:${key}`, async () => {
    if (direct) return (await readSeniorWorkQueuePostgres<T>()) ?? fallback;
    const queue = await readSharedSeniorDocument(file, fallback);
    return { ...queue, jobs: queue.jobs.filter(isSeniorQueueWorkItem) };
  });
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

export async function readSharedSeniorJobs<T extends Job>(file: string, jobIds: readonly string[]): Promise<T[]> {
  if (durableKeyForFile(file) !== 'senior-developer-worker/queue.json') throw new Error('Repair document not allowed');
  const ids = seniorJobBatchIds(jobIds);
  if (!ids.length) return [];
  const direct = preferDirectTransport();
  return sharedRead(`jobs:${direct}:${JSON.stringify(ids)}`, async () => {
    if (direct) return readSeniorQueuePostgresJobs<T>(ids);
    const queue = await readSharedSeniorDocument(file, { jobs: [] as T[] });
    const requested = new Set(ids);
    return verifiedSeniorJobBatch(queue.jobs.filter(job => requested.has(job.jobId)), ids);
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

export async function readSharedSeniorActiveOwnerJob<T extends Job & { ownerId: string; status: string }>(file: string, ownerId: string): Promise<T | null> {
  if (durableKeyForFile(file) !== 'senior-developer-worker/queue.json') throw new Error('Repair document not allowed');
  if (!ownerId.trim()) throw new Error('Repair owner identity is required');
  const direct = preferDirectTransport();
  return sharedRead(`active-owner:${direct}:${ownerId}`, async () => {
    if (direct) return readSeniorActiveOwnerJobPostgres<T>(ownerId);
    const queue = await readSharedSeniorWorkQueue(file, { jobs: [] as T[] });
    for (let i = queue.jobs.length - 1; i >= 0; i -= 1) {
      const job = queue.jobs[i];
      if (job.ownerId === ownerId && (SENIOR_QUEUE_ACTIVE_STATUSES as readonly string[]).includes(job.status)) return job;
    }
    return null;
  });
}

/** Read one revision-fenced page without transferring the retained proof history. */
export async function readSharedSeniorLedgerPage<T extends { jobId: string }>(limit = 25, offset = 0, version: string | null = null): Promise<SeniorLedgerPage<T>> {
  assertLedgerPageRequest(limit, offset, version);
  const direct = preferDirectTransport();
  return sharedRead(`ledger-page:${direct}:${limit}:${offset}:${version ?? ''}`, async () => {
    const body = { p_limit: limit, p_offset: offset, p_version: version };
    const page = direct
      ? await seniorQueuePostgresRpc<SeniorLedgerPage<T>>('ivx_senior_ledger_page', body)
      : await (await requestRpc('ivx_senior_ledger_page', body)).json() as SeniorLedgerPage<T>;
    if (!page || !Array.isArray(page.entries) || page.entries.length > limit || page.offset !== offset
      || !Number.isSafeInteger(page.total) || page.total < 0
      || page.entries.some(entry => !entry || typeof entry.jobId !== 'string' || !entry.jobId)
      || new Set(page.entries.map(entry => entry.jobId)).size !== page.entries.length
      || (page.updatedAt === null ? page.total !== 0 : !Number.isFinite(Date.parse(page.updatedAt)))
      || (version !== null && page.updatedAt !== version)
      || page.entries.length !== Math.max(0, Math.min(limit, page.total - offset))
      || page.nextOffset !== (offset + page.entries.length < page.total ? offset + page.entries.length : null)) {
      throw new Error('Invalid or changed ledger page; no partial proof returned');
    }
    return page;
  });
}
