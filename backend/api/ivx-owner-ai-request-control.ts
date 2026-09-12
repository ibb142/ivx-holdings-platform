/** Owner request-control receipts. The primary JSON/SSE chat uses its own
 * durable admission; persisting this receipt does not dispatch an AI provider. */
import { randomUUID } from 'node:crypto';
import { ownerOnlyJson, ownerOnlyOptions, assertIVXOwnerOnly, type IVXOwnerRequestContext } from './owner-only';
import {
  admitOwnerRequest, ownerRequestControlStore, ownerRequestDocumentKey,
  ownerRequestFingerprint, ownerRequestTraceId, replaceOwnerRequest,
  type OwnerRequestDocument,
} from '../services/ivx-owner-request-control-store';

export function handleIVXOwnerAIRequestControlOptions(): Response { return ownerOnlyOptions(); }
function authError(error: unknown): Response {
  const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 401;
  return ownerOnlyJson({ error: 'Authentication required' }, status);
}
function unavailable(): Response {
  return ownerOnlyJson({ error: 'Request persistence could not be confirmed. Retry with the same idempotencyKey.',
    code: 'OWNER_REQUEST_RECONCILIATION_REQUIRED', executionOutcome: 'unknown' }, 503);
}
function validKey(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 512; }
function optionalString(value: unknown): boolean { return value == null || typeof value === 'string'; }

/** POST /api/ivx/owner-ai/request. The caller must retain one explicit key per
 * order. Pending, failed and cancelled receipts are replayed as well as success. */
export async function handleIVXOwnerAIRequestCreate(request: Request): Promise<Response> {
  let owner: IVXOwnerRequestContext;
  try { owner = await assertIVXOwnerOnly(request); } catch (error) { return authError(error); }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    body = parsed as Record<string, unknown>;
  } catch { return ownerOnlyJson({ error: 'Invalid JSON body' }, 400); }
  if (typeof body.message !== 'string' || !body.message.trim()) return ownerOnlyJson({ error: 'message is required' }, 400);
  if (!validKey(body.idempotencyKey)) return ownerOnlyJson({ error: 'A non-empty idempotencyKey of at most 512 characters is required.' }, 400);
  if (![body.conversationId, body.messageId, body.traceId, body.senderLabel].every(optionalString)) {
    return ownerOnlyJson({ error: 'Request identifiers and senderLabel must be strings.' }, 400);
  }
  const conversationId = (body.conversationId as string | null | undefined) ?? null;
  const traceId = ownerRequestTraceId(owner.userId, body.idempotencyKey);
  const fingerprint = ownerRequestFingerprint(body.message, conversationId, (body.senderLabel as string | null | undefined) ?? null);
  const proposed: OwnerRequestDocument = { version: 1, ownerId: owner.userId, fingerprint, revision: randomUUID(), record: {
    traceId, requestId: `req-${randomUUID()}`, idempotencyKey: body.idempotencyKey,
    conversationId, messageId: (body.messageId as string | null | undefined) ?? `msg-${randomUUID()}`,
    status: 'pending', retryCount: 0, providerRequestId: null, startedAt: new Date().toISOString(), completedAt: null,
    terminalResult: null, structuredError: null,
  } };
  try {
    const { document, duplicate } = await admitOwnerRequest(ownerRequestControlStore(owner.client), ownerRequestDocumentKey(owner.userId, traceId), proposed);
    if (document.fingerprint !== fingerprint) return ownerOnlyJson({ traceId, code: 'OWNER_REQUEST_IDENTITY_CONFLICT',
      error: 'This idempotencyKey already belongs to different content.' }, 409);
    const record = document.record;
    return ownerOnlyJson({ traceId: record.traceId, requestId: record.requestId, status: record.status,
      idempotencyKey: record.idempotencyKey, duplicate, result: record.terminalResult,
      message: duplicate ? 'Returning the persisted request receipt.' : 'Request control receipt persisted. Poll its traceId for status.',
    }, duplicate ? 200 : 202);
  } catch { return unavailable(); }
}

async function withOwnerRecord(request: Request, traceId: string, action: (owner: IVXOwnerRequestContext, key: string, document: OwnerRequestDocument) => Promise<Response>): Promise<Response> {
  let owner: IVXOwnerRequestContext;
  try { owner = await assertIVXOwnerOnly(request); } catch (error) { return authError(error); }
  if (!validKey(traceId)) return ownerOnlyJson({ error: 'Invalid traceId' }, 400);
  const key = ownerRequestDocumentKey(owner.userId, traceId);
  try {
    const document = await ownerRequestControlStore(owner.client).read(key);
    if (!document || document.ownerId !== owner.userId) return ownerOnlyJson({ traceId, status: 'not_found', error: 'Request not found.' }, 404);
    if (document.version !== 1 || document.record.traceId !== traceId) return unavailable();
    return await action(owner, key, document);
  } catch { return unavailable(); }
}

export async function handleIVXOwnerAIRequestStatus(request: Request, traceId: string): Promise<Response> {
  return withOwnerRecord(request, traceId, async (_owner, _key, document) => ownerOnlyJson({ ...document.record }, 200));
}

export async function handleIVXOwnerAIRequestRetry(request: Request, traceId: string): Promise<Response> {
  return withOwnerRecord(request, traceId, async (owner, key, document) => {
    const record = document.record;
    if (record.status === 'pending' || record.status === 'in_flight') return ownerOnlyJson({ traceId, status: record.status, error: 'Request already pending or in flight.' }, 409);
    if (record.status === 'completed') return ownerOnlyJson({ traceId, status: record.status, terminalResult: record.terminalResult }, 200);
    // A provider receipt requires authoritative reconciliation, not a new dispatch.
    if (record.providerRequestId) return ownerOnlyJson({ traceId, error: 'Provider outcome must be reconciled before retry.', code: 'OWNER_REQUEST_RECONCILIATION_REQUIRED' }, 409);
    const next: OwnerRequestDocument = { ...document, revision: randomUUID(), record: { ...record,
      status: 'pending', retryCount: record.retryCount + 1, startedAt: new Date().toISOString(), completedAt: null,
      terminalResult: null, structuredError: null,
    } };
    if (!await replaceOwnerRequest(ownerRequestControlStore(owner.client), key, document, next)) {
      return ownerOnlyJson({ traceId, error: 'Request changed concurrently. Refresh its status.' }, 409);
    }
    return ownerOnlyJson({ traceId, requestId: record.requestId, status: 'pending', retryCount: next.record.retryCount }, 202);
  });
}

export async function handleIVXOwnerAIRequestCancel(request: Request, traceId: string): Promise<Response> {
  return withOwnerRecord(request, traceId, async (owner, key, document) => {
    const record = document.record;
    if (record.status === 'completed' || record.status === 'cancelled') return ownerOnlyJson({ traceId, status: record.status }, 200);
    // Recording a flag is not proof that an external provider stopped.
    if (record.status === 'in_flight' || record.providerRequestId) return ownerOnlyJson({ traceId, error: 'An in-flight provider outcome must be reconciled.', code: 'OWNER_REQUEST_RECONCILIATION_REQUIRED' }, 409);
    const next: OwnerRequestDocument = { ...document, revision: randomUUID(), record: { ...record, status: 'cancelled',
      completedAt: new Date().toISOString(), structuredError: { code: 'CANCELLED', message: 'Request cancelled by owner.', checkpoint: null },
    } };
    if (!await replaceOwnerRequest(ownerRequestControlStore(owner.client), key, document, next)) {
      return ownerOnlyJson({ traceId, error: 'Request changed concurrently. Refresh its status.' }, 409);
    }
    return ownerOnlyJson({ traceId, requestId: record.requestId, status: 'cancelled' }, 200);
  });
}
