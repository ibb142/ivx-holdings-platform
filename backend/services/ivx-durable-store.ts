/**
 * IVX durable document store (Supabase-backed) — THE PERMANENT DATA-LOSS FIX (2026-06-07).
 *
 * Why this exists:
 *   The Render web service runs on a tier WITHOUT a persistent disk, so every IVX
 *   business store (leads, CRM, deals, outreach, capital pipeline) that wrote JSON
 *   files to the local filesystem was wiped on every deploy/restart — deals 3 → 0,
 *   CRM → 0, leads reset. A mounted disk requires a paid Render plan + payment method
 *   that isn't available, so the filesystem can never be durable here.
 *
 *   This module persists each store's JSON state into Supabase Postgres (the same
 *   database the public chat already uses durably), keyed by the store's file path.
 *   Data now survives restarts, deploys, and tier changes regardless of disk.
 *
 * Design:
 *   - One table `ivx_durable_documents(doc_key text pk, value jsonb, updated_at)`
 *     holds the materialised state for each store (one row per JSON file).
 *   - One table `ivx_durable_events(id bigserial, doc_key, event jsonb, created_at)`
 *     holds the append-only forensic event log (replaces the *.jsonl files).
 *   - Schema is created lazily and idempotently via the existing `ivx_exec_sql` RPC.
 *   - When Supabase is NOT configured (local dev / tests), callers fall back to the
 *     filesystem — see `isDurableStoreConfigured()`.
 */
import path from 'node:path';

const SCHEMA_MARKER = 'ivx-durable-store-2026-08-07';
export const REST_TIMEOUT_MS = 30000;
const SERVICE_ROLE_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'] as const;
const SUPABASE_URL_NAMES = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

function getSupabaseUrl(): string {
  for (const name of SUPABASE_URL_NAMES) {
    const value = readTrimmed(process.env[name]).replace(/\/+$/, '');
    if (value) return value;
  }
  return '';
}

function getServiceRoleKey(): string {
  for (const name of SERVICE_ROLE_NAMES) {
    const value = readTrimmed(process.env[name]);
    if (value) return value;
  }
  return '';
}

/** True when Supabase credentials are present so durable persistence can be used. */
export function isDurableStoreConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getServiceRoleKey());
}

/**
 * Derive a stable document key from a store's absolute file path. We key on the
 * path AFTER `logs/audit/` so the key is stable across machines and roots, e.g.
 * `/app/data/logs/audit/lead-capture/leads.json` → `lead-capture/leads.json`.
 */
export function durableKeyForFile(file: string): string {
  const normalized = file.split(path.sep).join('/');
  const marker = 'logs/audit/';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) return normalized.slice(idx + marker.length);
  // Fallback: last two segments keep it readable and unique enough per store.
  const parts = normalized.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || normalized;
}

function buildHeaders(prefer?: string): Record<string, string> {
  const key = getServiceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function sanitizeExternalError(value: unknown): string {
  return readTrimmed(value).replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]').slice(0, 320) || 'unknown';
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 320) };
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    return sanitizeExternalError(record.message ?? record.error ?? record.details ?? fallback);
  }
  return sanitizeExternalError(fallback);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry transient 5xx/timeout errors with exponential backoff. HTTP 522 = Cloudflare origin timeout. */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 2000,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      // Retry on 5xx, 522, timeout, or connection refused — NOT on 4xx auth errors
      const isTransient = /5\d\d|522|timeout|timed out|ECONNREFUSED|fetch failed|HTTP 000/i.test(msg);
      if (!isTransient || attempt === maxAttempts) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
      console.warn(`[IvxDurableStore] Retry ${attempt}/${maxAttempts} after ${delay}ms: ${msg.slice(0, 120)}`);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('retry exhausted');
}

class DurableStore {
  private schemaReady: Promise<void> | null = null;

  private restBaseUrl(): string {
    const url = getSupabaseUrl();
    if (!url || !getServiceRoleKey()) {
      throw new Error('IVX durable store is not configured (missing Supabase credentials).');
    }
    return `${url}/rest/v1`;
  }

  private async executeSql(sql: string): Promise<void> {
    const statement = sql.trim();
    if (!statement) return;
    await retryWithBackoff(async () => {
      const response = await fetch(`${this.restBaseUrl()}/rpc/ivx_exec_sql`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ sql_text: statement }),
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
      const payload = await parseResponsePayload(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Supabase SQL RPC returned HTTP ${response.status}.`));
      }
      if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).ok === false) {
        throw new Error(extractErrorMessage(payload, 'Supabase SQL RPC reported failure.'));
      }
    });
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.ensureSchemaInternal().catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }
    await this.schemaReady;
  }

  private async ensureSchemaInternal(): Promise<void> {
    const statements = [
      `create table if not exists public.ivx_durable_documents (
        doc_key text primary key,
        value jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists public.ivx_durable_events (
        id bigserial primary key,
        doc_key text not null,
        event jsonb not null,
        created_at timestamptz not null default now()
      )`,
      'alter table public.ivx_durable_documents enable row level security',
      'alter table public.ivx_durable_events enable row level security',
      'create index if not exists ivx_durable_events_key_created_idx on public.ivx_durable_events (doc_key, created_at asc)',
      "comment on table public.ivx_durable_documents is 'IVX durable business state (leads/CRM/deals/outreach/pipeline). Backend service-role only.'",
      "select pg_notify('pgrst','reload schema')",
    ];
    for (const statement of statements) {
      await this.executeSql(statement);
    }
    await sleep(400);
    console.log('[IvxDurableStore] Schema ready', { marker: SCHEMA_MARKER });
  }

  private async restRequest<T>(
    pathName: string,
    init: RequestInit = {},
    prefer?: string,
    retrySchemaCache: boolean = true,
  ): Promise<T> {
    return retryWithBackoff(async () => {
      const response = await fetch(`${this.restBaseUrl()}${pathName}`, {
        ...init,
        headers: { ...buildHeaders(prefer), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
      const payload = await parseResponsePayload(response);
      if (!response.ok) {
        const message = extractErrorMessage(payload, `Supabase REST returned HTTP ${response.status}.`);
        const schemaCacheMiss = retrySchemaCache
          && (message.includes('schema cache') || message.includes('PGRST205') || message.includes('Could not find the table'));
        if (schemaCacheMiss) {
          await this.executeSql("select pg_notify('pgrst','reload schema')");
          await sleep(750);
          // Retry once after schema reload (bypass retryWithBackoff for this specific case)
          const retryResponse = await fetch(`${this.restBaseUrl()}${pathName}`, {
            ...init,
            headers: { ...buildHeaders(prefer), ...(init.headers ?? {}) },
            signal: AbortSignal.timeout(REST_TIMEOUT_MS),
          });
          const retryPayload = await parseResponsePayload(retryResponse);
          if (!retryResponse.ok) {
            throw new Error(extractErrorMessage(retryPayload, `Supabase REST returned HTTP ${retryResponse.status}.`));
          }
          return retryPayload as T;
        }
        throw new Error(message);
      }
      return payload as T;
    });
  }

  async readJson<T>(docKey: string, fallback: T): Promise<T> {
    await this.ensureSchema();
    const rows = await this.restRequest<{ value: T }[]>(
      `/ivx_durable_documents?doc_key=eq.${encodeURIComponent(docKey)}&select=value&limit=1`,
      { method: 'GET' },
    );
    if (Array.isArray(rows) && rows.length > 0 && rows[0] && rows[0].value !== undefined && rows[0].value !== null) {
      return rows[0].value;
    }
    return fallback;
  }

  async writeJson(docKey: string, value: unknown): Promise<void> {
    await this.ensureSchema();
    await this.restRequest<unknown>(
      '/ivx_durable_documents?on_conflict=doc_key',
      {
        method: 'POST',
        body: JSON.stringify({ doc_key: docKey, value, updated_at: nowIso() }),
      },
      'resolution=merge-duplicates,return=minimal',
    );
  }

  async appendEvent(docKey: string, event: Record<string, unknown>): Promise<void> {
    await this.ensureSchema();
    await this.restRequest<unknown>(
      '/ivx_durable_events',
      {
        method: 'POST',
        body: JSON.stringify({ doc_key: docKey, event, created_at: nowIso() }),
      },
      'return=minimal',
    );
  }

  async readEvents(docKey: string, limit: number): Promise<DurableEvent[]> {
    await this.ensureSchema();
    const capped = Math.max(1, Math.min(1000, limit));
    const rows = await this.restRequest<{ event: Record<string, unknown>; created_at: string }[]>(
      `/ivx_durable_events?doc_key=eq.${encodeURIComponent(docKey)}&select=event,created_at&order=created_at.desc&limit=${capped}`,
      { method: 'GET' },
    );
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({ event: r.event ?? {}, createdAt: r.created_at }));
  }
}

let singleton: DurableStore | null = null;

function store(): DurableStore {
  if (!singleton) singleton = new DurableStore();
  return singleton;
}

/** Read a store's JSON state from durable Supabase storage (by file path). */
export async function readDurableJson<T>(file: string, fallback: T): Promise<T> {
  return store().readJson<T>(durableKeyForFile(file), fallback);
}

/** Write a store's JSON state to durable Supabase storage (by file path). */
export async function writeDurableJson(file: string, value: unknown): Promise<void> {
  await store().writeJson(durableKeyForFile(file), value);
}

/** Append a forensic event to durable Supabase storage (by file path). */
export async function appendDurableEvent(file: string, event: Record<string, unknown>): Promise<void> {
  await store().appendEvent(durableKeyForFile(file), event);
}

/** A durable forensic event with its server-recorded timestamp. */
export type DurableEvent = { event: Record<string, unknown>; createdAt: string };

/** Read forensic events (newest first) from durable Supabase storage (by file path). */
export async function readDurableEvents(file: string, limit: number = 200): Promise<DurableEvent[]> {
  return store().readEvents(durableKeyForFile(file), limit);
}
