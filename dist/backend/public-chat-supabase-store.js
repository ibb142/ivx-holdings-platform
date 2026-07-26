import { createHash } from 'node:crypto';
const MAX_SQL_LENGTH = 16_000;
const SCHEMA_MARKER = 'ivx-public-chat-supabase-history-2026-05-16-block17';
const SERVICE_ROLE_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
function sanitizeExternalError(value) {
    return readTrimmed(value).replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]').slice(0, 320) || 'unknown';
}
function hashClientId(clientId) {
    return createHash('sha256').update(`ivx-public-chat:${clientId}`).digest('hex');
}
function getSupabaseUrl() {
    return readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
}
function getServiceRoleKey() {
    for (const name of SERVICE_ROLE_NAMES) {
        const value = readTrimmed(process.env[name]);
        if (value)
            return value;
    }
    return '';
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function buildHeaders(prefer) {
    const key = getServiceRoleKey();
    return {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
    };
}
async function parseResponsePayload(response) {
    const text = await response.text().catch(() => '');
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return { message: text.slice(0, 320) };
    }
}
function extractErrorMessage(payload, fallback) {
    if (payload && typeof payload === 'object') {
        const record = payload;
        return sanitizeExternalError(record.message ?? record.error ?? record.details ?? fallback);
    }
    return sanitizeExternalError(fallback);
}
function encodeFilterValue(value) {
    return encodeURIComponent(value);
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
export class PublicChatSupabaseStore {
    schemaReady = null;
    isConfigured() {
        return Boolean(getSupabaseUrl() && getServiceRoleKey());
    }
    get marker() {
        return SCHEMA_MARKER;
    }
    restBaseUrl() {
        const url = getSupabaseUrl();
        if (!url || !getServiceRoleKey()) {
            throw new Error('Supabase public-chat persistence is not configured.');
        }
        return `${url}/rest/v1`;
    }
    async restRequest(path, init = {}, prefer, retrySchemaCache = true) {
        const response = await fetch(`${this.restBaseUrl()}${path}`, {
            ...init,
            headers: {
                ...buildHeaders(prefer),
                ...(init.headers ?? {}),
            },
        });
        const payload = await parseResponsePayload(response);
        if (!response.ok) {
            const message = extractErrorMessage(payload, `Supabase REST returned HTTP ${response.status}.`);
            const schemaCacheMiss = retrySchemaCache && (message.includes('schema cache') || message.includes('PGRST205') || message.includes('Could not find the table'));
            if (schemaCacheMiss) {
                await this.reloadSchemaCache();
                await sleep(750);
                return await this.restRequest(path, init, prefer, false);
            }
            throw new Error(message);
        }
        return payload;
    }
    async executeSql(sql) {
        const statement = sql.trim();
        if (!statement || statement.length > MAX_SQL_LENGTH) {
            throw new Error('Supabase schema statement is invalid.');
        }
        const response = await fetch(`${this.restBaseUrl()}/rpc/ivx_exec_sql`, {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({ sql_text: statement }),
        });
        const payload = await parseResponsePayload(response);
        if (!response.ok) {
            throw new Error(extractErrorMessage(payload, `Supabase SQL RPC returned HTTP ${response.status}.`));
        }
        if (payload && typeof payload === 'object' && payload.ok === false) {
            throw new Error(extractErrorMessage(payload, 'Supabase SQL RPC reported failure.'));
        }
    }
    async reloadSchemaCache() {
        await this.executeSql("select pg_notify('pgrst','reload schema')");
    }
    async ensureSchema() {
        if (!this.isConfigured()) {
            throw new Error('Supabase public-chat persistence is not configured.');
        }
        if (!this.schemaReady) {
            this.schemaReady = this.ensureSchemaInternal().catch((error) => {
                this.schemaReady = null;
                throw error;
            });
        }
        await this.schemaReady;
    }
    async ensureSchemaInternal() {
        const statements = [
            `create table if not exists public.public_chat_sessions (
        id text primary key,
        client_id_hash text not null,
        message_count integer not null default 0,
        last_message_preview text not null default '',
        last_source text,
        last_model text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
            `create table if not exists public.public_chat_messages (
        id text primary key default gen_random_uuid()::text,
        session_id text not null references public.public_chat_sessions(id) on delete cascade,
        role text not null check (role in ('user', 'assistant', 'system')),
        content text not null,
        source text not null,
        model text,
        created_at timestamptz not null default now()
      )`,
            'alter table public.public_chat_sessions enable row level security',
            'alter table public.public_chat_messages enable row level security',
            'create index if not exists public_chat_sessions_client_updated_idx on public.public_chat_sessions (client_id_hash, updated_at desc)',
            'create index if not exists public_chat_messages_session_created_idx on public.public_chat_messages (session_id, created_at asc)',
            `create or replace function public.ivx_public_chat_touch_session()
       returns trigger
       language plpgsql
       security definer
       set search_path = public
       as $$
       begin
         update public.public_chat_sessions
         set updated_at = new.created_at,
             message_count = (select count(*) from public.public_chat_messages where session_id = new.session_id),
             last_message_preview = left(new.content, 160),
             last_source = new.source,
             last_model = new.model
         where id = new.session_id;
         return new;
       end;
       $$`,
            'drop trigger if exists public_chat_messages_touch_session on public.public_chat_messages',
            `create trigger public_chat_messages_touch_session
       after insert on public.public_chat_messages
       for each row execute function public.ivx_public_chat_touch_session()`,
            "comment on table public.public_chat_sessions is 'IVX Block 17 public chat sessions. Backend service-role only; direct public access is intentionally not granted.'",
            "comment on table public.public_chat_messages is 'IVX Block 17 public chat message history with role/content/source/model/session_id fields.'",
            "select pg_notify('pgrst','reload schema')",
        ];
        for (const statement of statements) {
            await this.executeSql(statement);
        }
        await sleep(500);
        console.log('[PublicChatSupabaseStore] Schema ready', { marker: SCHEMA_MARKER });
    }
    async getSession(sessionId) {
        const rows = await this.restRequest(`/public_chat_sessions?id=eq.${encodeFilterValue(sessionId)}&select=id,client_id_hash,message_count,updated_at,last_message_preview,last_source,last_model&limit=1`, { method: 'GET' });
        return Array.isArray(rows) ? rows[0] ?? null : null;
    }
    async ensureSession(sessionId, clientId) {
        await this.ensureSchema();
        const clientHash = hashClientId(clientId);
        const existing = await this.getSession(sessionId);
        if (existing) {
            // The sessionId is a high-entropy, client-generated token persisted on the
            // device, so it — not the volatile request IP — is the access credential.
            // Never throw on a client_id_hash mismatch: the client IP legitimately
            // changes between requests (cellular/Wi-Fi/VPN/carrier NAT), and throwing
            // here silently dropped messages and made the chat "disappear" on reload.
            if (existing.client_id_hash !== clientHash) {
                console.log('[PublicChatSupabaseStore] Session client changed; keeping original owner', {
                    sessionId,
                    marker: SCHEMA_MARKER,
                });
            }
            await this.restRequest(`/public_chat_sessions?id=eq.${encodeFilterValue(sessionId)}`, {
                method: 'PATCH',
                body: JSON.stringify({ updated_at: nowIso() }),
            }, 'return=minimal');
            return existing.client_id_hash || clientHash;
        }
        await this.restRequest('/public_chat_sessions', {
            method: 'POST',
            body: JSON.stringify({
                id: sessionId,
                client_id_hash: clientHash,
                metadata: { block17Marker: SCHEMA_MARKER },
                created_at: nowIso(),
                updated_at: nowIso(),
            }),
        }, 'return=minimal');
        return clientHash;
    }
    async appendMessage(input) {
        await this.ensureSession(input.sessionId, input.clientId);
        const row = {
            id: createId('public-chat-message'),
            session_id: input.sessionId,
            role: input.role,
            content: input.content,
            source: input.source,
            model: input.model ?? null,
            created_at: input.createdAt ?? nowIso(),
        };
        const rows = await this.restRequest('/public_chat_messages?select=id,session_id,role,content,source,model,created_at', {
            method: 'POST',
            body: JSON.stringify(row),
        }, 'return=representation');
        return Array.isArray(rows) ? rows[0] ?? row : row;
    }
    async listMessages(input) {
        await this.ensureSchema();
        const session = await this.getSession(input.sessionId);
        // Authorize by possession of the unguessable sessionId, not by request IP.
        // Tying reads to the IP hash made history vanish whenever the client IP
        // changed between sending a message and reloading the chat.
        if (!session) {
            return [];
        }
        const limit = Math.min(Math.max(Math.floor(input.limit), 1), 100);
        const rows = await this.restRequest(`/public_chat_messages?session_id=eq.${encodeFilterValue(input.sessionId)}&select=id,session_id,role,content,source,model,created_at&order=created_at.asc&limit=${encodeURIComponent(String(limit))}`, { method: 'GET' });
        return Array.isArray(rows) ? rows : [];
    }
    async listSessions(input) {
        await this.ensureSchema();
        const clientHash = hashClientId(input.clientId);
        const limit = Math.min(Math.max(Math.floor(input.limit), 1), 25);
        const rows = await this.restRequest(`/public_chat_sessions?client_id_hash=eq.${encodeFilterValue(clientHash)}&select=id,message_count,updated_at,last_message_preview,last_source,last_model&order=updated_at.desc&limit=${encodeURIComponent(String(limit))}`, { method: 'GET' });
        return (Array.isArray(rows) ? rows : []).map((row) => ({
            sessionId: row.id,
            messageCount: Math.max(Math.floor(row.message_count ?? 0), 0),
            lastUpdatedAt: row.updated_at ?? nowIso(),
            lastMessagePreview: row.last_message_preview ?? '',
            lastSource: row.last_source ?? null,
            lastModel: row.last_model ?? null,
        }));
    }
}
let singleton = null;
export function getPublicChatSupabaseStore() {
    if (!singleton) {
        singleton = new PublicChatSupabaseStore();
    }
    return singleton;
}
