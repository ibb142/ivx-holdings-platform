import { createHash } from 'node:crypto';
import type { IVXOwnerRequestContext } from '../api/owner-only';

export interface OwnerRequestRecord {
  traceId: string; requestId: string; conversationId: string | null; messageId: string;
  idempotencyKey: string;
  status: 'pending' | 'in_flight' | 'completed' | 'failed' | 'cancelled';
  retryCount: number; providerRequestId: string | null; startedAt: string; completedAt: string | null;
  terminalResult: { answer: string | null; error: string | null; httpStatus: number | null } | null;
  structuredError: { code: string; message: string; checkpoint: string | null } | null;
}
export interface OwnerRequestDocument {
  version: 1; ownerId: string; fingerprint: string; revision: string; record: OwnerRequestRecord;
}
export interface OwnerRequestControlStore {
  insert(key: string, document: OwnerRequestDocument): Promise<boolean>;
  read(key: string): Promise<OwnerRequestDocument | null>;
  replace(key: string, previousRevision: string, document: OwnerRequestDocument): Promise<boolean>;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ownerRequestTraceId = (ownerId: string, idempotencyKey: string) => `ivx-req-${digest([ownerId, idempotencyKey])}`;
export const ownerRequestDocumentKey = (ownerId: string, traceId: string) => `owner-request-control/${digest(ownerId)}/${traceId}`;
export const ownerRequestFingerprint = (message: string, conversationId: string | null, senderLabel: string | null) =>
  digest([message, conversationId, senderLabel]);

/** Existing service-role document table: indexed point reads, unique INSERT,
 * revision-fenced updates. No volatile fallback, new table or permission change. */
export function ownerRequestControlStore(client: IVXOwnerRequestContext['client']): OwnerRequestControlStore {
  const table = 'ivx_durable_documents';
  return {
    async insert(key, document) {
      const result = await client.from(table).insert({ doc_key: key, value: document })
        .select('doc_key').abortSignal(AbortSignal.timeout(8_000));
      if (result.error?.code === '23505') return false;
      if (result.error) throw new Error('Owner request storage unavailable.');
      return result.data?.length === 1;
    },
    async read(key) {
      const result = await client.from(table).select('value').eq('doc_key', key).limit(1)
        .abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
      if (result.error) throw new Error('Owner request lookup unavailable.');
      return (result.data?.value as OwnerRequestDocument | undefined) ?? null;
    },
    async replace(key, previousRevision, document) {
      const result = await client.from(table).update({ value: document, updated_at: new Date().toISOString() })
        .eq('doc_key', key).eq('value->>revision', previousRevision).eq('value->>ownerId', document.ownerId)
        .select('doc_key').abortSignal(AbortSignal.timeout(8_000));
      if (result.error) throw new Error('Owner request update unavailable.');
      return result.data?.length === 1;
    },
  };
}

/** A committed write with a lost ACK is reconciled at the same key. Never
 * generate another request identity, or overwrite a competing transition. */
export async function admitOwnerRequest(store: OwnerRequestControlStore, key: string, proposed: OwnerRequestDocument) {
  try { if (await store.insert(key, proposed)) return { document: proposed, duplicate: false }; } catch { /* Read back below. */ }
  const document = await store.read(key);
  if (!document || document.version !== 1 || document.ownerId !== proposed.ownerId) throw new Error('Request admission unconfirmed.');
  return { document, duplicate: document.record.requestId !== proposed.record.requestId };
}

export async function replaceOwnerRequest(store: OwnerRequestControlStore, key: string, previous: OwnerRequestDocument, next: OwnerRequestDocument): Promise<boolean> {
  try { if (await store.replace(key, previous.revision, next)) return true; } catch { /* Reconcile a lost acknowledgement. */ }
  const current = await store.read(key);
  if (!current) throw new Error('Request transition unconfirmed.');
  return current.version === 1 && current.ownerId === next.ownerId && current.revision === next.revision;
}
