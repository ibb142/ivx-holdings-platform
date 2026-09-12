import { createHash, randomUUID } from 'node:crypto';
import type { IVXOwnerRequestContext } from '../api/owner-only';

export interface ChatRequestRecord {
  version: 1;
  fingerprint: string;
  token: string;
  state: 'running' | 'completed';
  identity?: { ownerId: string; conversationId: string; requestId: string };
  startedAt: string;
  completedAt?: string;
  response?: { status: number; body: string };
}

export interface ChatRequestStore {
  insert(key: string, record: ChatRequestRecord): Promise<boolean>;
  read(key: string): Promise<ChatRequestRecord | null>;
  complete(key: string, token: string, record: ChatRequestRecord): Promise<boolean>;
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export function ownerChatRequestKey(ownerId: string, conversationId: string, requestId: string): string {
  if (![ownerId, conversationId, requestId].every(value => value.trim() && value.length <= 512)) {
    throw new Error('Invalid owner chat request identity.');
  }
  return `owner-chat-requests/${digest(JSON.stringify([ownerId, conversationId, requestId]))}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function ownerChatFingerprint(body: Record<string, unknown>): string {
  // Request/transport identifiers may differ on reconnect; semantic inputs may not.
  const { requestId, traceId, messageId, ...semantic } = body;
  return digest(JSON.stringify(canonical(semantic)));
}

/** Uses the existing service-role-only document table. No lazy DDL or fallback storage. */
export function ownerChatRequestStore(client: IVXOwnerRequestContext['client']): ChatRequestStore {
  const table = 'ivx_durable_documents';
  return {
    async insert(key, record) {
      const result = await client.from(table).insert({ doc_key: key, value: record })
        .select('doc_key').abortSignal(AbortSignal.timeout(8_000));
      if (result.error?.code === '23505') return false;
      if (result.error) throw new Error('Owner chat admission storage unavailable.');
      return result.data?.length === 1;
    },
    async read(key) {
      const result = await client.from(table).select('value').eq('doc_key', key).limit(1)
        .abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
      if (result.error) throw new Error('Owner chat request lookup unavailable.');
      return (result.data?.value as ChatRequestRecord | undefined) ?? null;
    },
    async complete(key, token, record) {
      const result = await client.from(table).update({ value: record, updated_at: record.completedAt })
        .eq('doc_key', key).eq('value->>token', token).eq('value->>state', 'running')
        .select('doc_key').abortSignal(AbortSignal.timeout(8_000));
      if (result.error) throw new Error('Owner chat result persistence unavailable.');
      return result.data?.length === 1;
    },
  };
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
}

function unavailable(requestId: string): Response {
  return json({ ok: false, status: 'error', code: 'OWNER_CHAT_RECONCILIATION_REQUIRED', requestId,
    error: 'No se pudo confirmar el resultado guardado. Conserva este mensaje y consulta de nuevo su estado.',
    retryable: true, executionOutcome: 'unknown' }, 503);
}

function pending(requestId: string): Response {
  return json({ ok: false, status: 'error', code: 'OWNER_CHAT_REQUEST_PENDING', requestId,
    error: 'Este mensaje ya fue admitido. Su resultado sigue pendiente de confirmación.',
    retryable: true, executionOutcome: 'pending' }, 409);
}

/** Atomic admission shared by JSON and SSE. A lost acknowledgement never grants a second executor. */
export async function runOwnerChatOnce(input: {
  key: string; requestId: string; fingerprint: string; store: ChatRequestStore;
  identity?: ChatRequestRecord['identity'];
  execute: () => Promise<Response>;
}): Promise<Response> {
  const { key, requestId, fingerprint, store } = input;
  const reservation: ChatRequestRecord = { version: 1, fingerprint, token: randomUUID(), state: 'running', identity: input.identity, startedAt: new Date().toISOString() };
  let admitted = false;
  try { admitted = await store.insert(key, reservation); } catch { /* Reconcile an ambiguous INSERT acknowledgement by identity. */ }
  if (!admitted) {
    let existing: ChatRequestRecord | null;
    try { existing = await store.read(key); } catch { return unavailable(requestId); }
    if (!existing || existing.version !== 1) return unavailable(requestId);
    if (existing.fingerprint !== fingerprint) {
      return json({ ok: false, status: 'error', code: 'OWNER_CHAT_IDENTITY_CONFLICT', requestId,
        error: 'El identificador pertenece a otro contenido. Conserva un identificador distinto para cada mensaje.' }, 409);
    }
    if (existing.state === 'completed' && existing.response) {
      return new Response(existing.response.body, { status: existing.response.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-IVX-Request-Replayed': 'true' } });
    }
    // Only this invocation's token proves ownership after a committed INSERT lost its response.
    // There is deliberately no age-based takeover: a provider may already have executed.
    if (existing.state !== 'running' || existing.token !== reservation.token) return pending(requestId);
  }

  let response: Response;
  try { response = await input.execute(); } catch { return unavailable(requestId); }
  let body: string;
  try { body = await response.text(); JSON.parse(body); } catch { return unavailable(requestId); }
  const completed: ChatRequestRecord = { ...reservation, state: 'completed', completedAt: new Date().toISOString(), response: { status: response.status, body } };
  let saved = false;
  try { saved = await store.complete(key, reservation.token, completed); } catch { /* Read the same row; never rerun the provider. */ }
  if (!saved) {
    try {
      const existing = await store.read(key);
      saved = existing?.state === 'completed' && existing.token === reservation.token
        && existing.response?.status === response.status && existing.response?.body === body;
    } catch { /* Unknown persistence remains an explicit error. */ }
  }
  if (!saved) return unavailable(requestId);
  return new Response(body, { status: response.status, headers: response.headers });
}

/** Poll the original request after a lost response. This path never calls a provider or creates a replacement task. */
export async function reconcileOwnerChatRequest(store: ChatRequestStore, key: string, taskId: string): Promise<Record<string, unknown> | null> {
  const record = await store.read(key);
  if (!record || record.version !== 1) return null;
  let payload: Record<string, unknown> = {};
  try { if (record.response) payload = JSON.parse(record.response.body); } catch { /* Invalid data is never a success. */ }
  const completed = record.state === 'completed';
  const succeeded = completed && !!record.response && record.response.status >= 200 && record.response.status < 300
    && payload.status !== 'error' && payload.ok !== false && typeof payload.answer === 'string' && !!payload.answer.trim();
  return { taskId, traceId: taskId, status: completed ? (succeeded ? 'COMPLETED' : 'FAILED') : 'RUNNING',
    terminal: completed, checkpoint: completed ? 'ORIGINAL_RESPONSE_RECONCILED' : 'ORIGINAL_REQUEST_PENDING',
    retryCount: 0, answer: succeeded ? payload.answer : null,
    assistantMessageId: payload.assistantMessageId ?? null, assistantPersisted: payload.assistantPersisted === true,
    errorCode: completed && !succeeded ? 'ORIGINAL_REQUEST_FAILED' : null,
    errorMessage: completed && !succeeded ? (payload.error ?? payload.detail ?? 'La solicitud original terminó con error.') : null,
    deadLetter: false, source: 'original_owner_chat_request' };
}
