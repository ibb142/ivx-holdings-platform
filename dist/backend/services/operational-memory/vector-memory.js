/**
 * IVX Operational Memory — vector store backed by Supabase pgvector.
 * Uses the existing service-role REST + ivx_exec_sql RPC patterns.
 */
import { embedText } from './embeddings';
import { MEMORY_EMBEDDING_DIM, } from './memory-types';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
function getSupabaseRestBaseUrl() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    if (!url)
        throw new Error('EXPO_PUBLIC_SUPABASE_URL is required for IVX operational memory.');
    return `${url}/rest/v1`;
}
function decodeJwtRole(token) {
    const seg = token.split('.')[1];
    if (!seg)
        return null;
    try {
        const padded = seg.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(seg.length / 4) * 4, '=');
        const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        return typeof parsed.role === 'string' ? parsed.role : null;
    }
    catch {
        return null;
    }
}
function getServiceRoleKey() {
    const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
    const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const role = decodeJwtRole(key);
    if (!key || key === anonKey || (role !== 'service_role' && role !== 'supabase_admin')) {
        throw new Error('A backend-only Supabase service-role key is required for IVX operational memory.');
    }
    return key;
}
function restHeaders(prefer) {
    const key = getServiceRoleKey();
    return {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
    };
}
async function rest(path, init = {}, prefer) {
    const response = await fetch(`${getSupabaseRestBaseUrl()}${path}`, {
        ...init,
        headers: { ...restHeaders(prefer), ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        }
        catch {
            payload = { message: text.slice(0, 280) };
        }
    }
    if (!response.ok) {
        const rec = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
        throw new Error(readTrimmed(rec.message) || readTrimmed(rec.error) || `Supabase REST returned HTTP ${response.status}.`);
    }
    return payload;
}
async function execSql(sql) {
    const payload = await rest('/rpc/ivx_exec_sql', {
        method: 'POST',
        body: JSON.stringify({ sql_text: sql }),
    });
    return payload && typeof payload === 'object' ? payload : {};
}
let schemaReady = null;
export async function ensureOperationalMemorySchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            const stmts = [
                `create extension if not exists vector`,
                `create table if not exists public.ivx_operational_memory (
          id text primary key default gen_random_uuid()::text,
          category text not null check (category in ('architecture','deployment','incident','fix','roadmap','repo_index','task_state','note')),
          title text not null,
          content text not null,
          metadata jsonb not null default '{}'::jsonb,
          source text,
          ref_id text,
          embedding vector(${MEMORY_EMBEDDING_DIM}),
          embedding_dim integer not null default ${MEMORY_EMBEDDING_DIM},
          embedding_model text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )`,
                `create index if not exists ivx_op_memory_category_idx on public.ivx_operational_memory (category, created_at desc)`,
                `create index if not exists ivx_op_memory_ref_idx on public.ivx_operational_memory (source, ref_id)`,
                `do $$ begin
          if not exists (select 1 from pg_indexes where schemaname='public' and indexname='ivx_op_memory_embedding_idx') then
            execute 'create index ivx_op_memory_embedding_idx on public.ivx_operational_memory using ivfflat (embedding vector_cosine_ops) with (lists = 100)';
          end if;
        end $$`,
                `alter table public.ivx_operational_memory enable row level security`,
                `create table if not exists public.ivx_agent_tasks (
          id text primary key default gen_random_uuid()::text,
          goal text not null,
          status text not null default 'queued' check (status in ('queued','analyzing','planning','patching','testing','validating','deploying','verifying','completed','failed','rolled_back','canceled')),
          steps jsonb not null default '[]'::jsonb,
          rollback_token text,
          rollback_applied boolean not null default false,
          result jsonb,
          error text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )`,
                `create index if not exists ivx_agent_tasks_status_idx on public.ivx_agent_tasks (status, created_at desc)`,
                `alter table public.ivx_agent_tasks enable row level security`,
                `select pg_notify('pgrst','reload schema')`,
            ];
            for (const sql of stmts) {
                const r = await execSql(sql);
                if (r.ok === false) {
                    throw new Error(`Operational memory schema setup failed: ${readTrimmed(r.error) || 'unknown'}`);
                }
            }
        })().catch((error) => {
            schemaReady = null;
            throw error;
        });
    }
    await schemaReady;
}
function vectorLiteral(vec) {
    // Postgres vector literal: '[0.1,0.2,...]'
    return `[${vec.map((v) => Number.isFinite(v) ? v.toFixed(6) : '0').join(',')}]`;
}
function escapeSql(value) {
    return value.replace(/'/g, "''");
}
/** Insert or update a memory entry with its embedding. */
export async function upsertMemory(input) {
    await ensureOperationalMemorySchema();
    const embedding = await embedText(`${input.title}\n${input.content}`);
    const metaJson = escapeSql(JSON.stringify(input.metadata ?? {}));
    const source = input.source ? `'${escapeSql(input.source)}'` : 'null';
    const refId = input.refId ? `'${escapeSql(input.refId)}'` : 'null';
    const sql = `
    with up as (
      insert into public.ivx_operational_memory
        (category, title, content, metadata, source, ref_id, embedding, embedding_dim, embedding_model)
      values (
        '${escapeSql(input.category)}',
        '${escapeSql(input.title)}',
        '${escapeSql(input.content)}',
        '${metaJson}'::jsonb,
        ${source},
        ${refId},
        '${vectorLiteral(embedding.vector)}'::vector,
        ${embedding.dim},
        '${escapeSql(embedding.model)}'
      )
      returning id, category, title, content, metadata, source, ref_id, embedding_dim, embedding_model, created_at, updated_at
    )
    select * from up;
  `;
    const result = await execSql(sql);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const row = rows[0];
    if (!row)
        throw new Error('Failed to upsert operational memory row.');
    return rowToMemory(row);
}
function rowToMemory(row) {
    return {
        id: String(row.id ?? ''),
        category: String(row.category ?? 'note'),
        title: String(row.title ?? ''),
        content: String(row.content ?? ''),
        metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)) ? row.metadata : {},
        source: row.source != null ? String(row.source) : null,
        ref_id: row.ref_id != null ? String(row.ref_id) : null,
        embedding_dim: Number(row.embedding_dim ?? MEMORY_EMBEDDING_DIM),
        embedding_model: row.embedding_model != null ? String(row.embedding_model) : null,
        created_at: String(row.created_at ?? nowIso()),
        updated_at: String(row.updated_at ?? nowIso()),
    };
}
/** Cosine-distance search over operational memory. */
export async function searchMemory(query, options = {}) {
    await ensureOperationalMemorySchema();
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 8), 1), 50);
    const embedding = await embedText(query);
    const where = options.category ? `where category = '${escapeSql(options.category)}'` : '';
    const sql = `
    select id, category, title, content, metadata, source, ref_id, embedding_dim, embedding_model, created_at, updated_at,
           (embedding <=> '${vectorLiteral(embedding.vector)}'::vector) as distance
    from public.ivx_operational_memory
    ${where}
    order by embedding <=> '${vectorLiteral(embedding.vector)}'::vector asc
    limit ${limit};
  `;
    const result = await execSql(sql);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    return rows.map((r) => ({ ...rowToMemory(r), distance: Number(r.distance ?? 1) }));
}
export async function listMemoryByCategory(category, limit = 25) {
    await ensureOperationalMemorySchema();
    const safe = Math.min(Math.max(Math.floor(limit), 1), 200);
    const rows = await rest(`/ivx_operational_memory?category=eq.${encodeURIComponent(category)}&select=id,category,title,content,metadata,source,ref_id,embedding_dim,embedding_model,created_at,updated_at&order=created_at.desc&limit=${safe}`);
    return Array.isArray(rows) ? rows.map((r) => rowToMemory(r)) : [];
}
export async function memoryStats() {
    await ensureOperationalMemorySchema();
    const result = await execSql(`select category, count(*)::int as count from public.ivx_operational_memory group by category order by category asc;`);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const counts = {};
    let total = 0;
    for (const r of rows) {
        const c = String(r.category ?? 'unknown');
        const n = Number(r.count ?? 0);
        counts[c] = n;
        total += n;
    }
    return { total, counts };
}
