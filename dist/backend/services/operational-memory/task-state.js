/**
 * IVX Operational Memory — agent task state persistence.
 * Backed by public.ivx_agent_tasks via Supabase REST.
 */
import { ensureOperationalMemorySchema } from './vector-memory';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
function getSupabaseRestBaseUrl() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    if (!url)
        throw new Error('EXPO_PUBLIC_SUPABASE_URL is required for IVX agent tasks.');
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
        throw new Error('A backend-only Supabase service-role key is required for IVX agent tasks.');
    }
    return key;
}
function headers(prefer) {
    const k = getServiceRoleKey();
    return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) };
}
async function rest(path, init = {}, prefer) {
    const r = await fetch(`${getSupabaseRestBaseUrl()}${path}`, { ...init, headers: { ...headers(prefer), ...(init.headers ?? {}) } });
    const text = await r.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        }
        catch {
            payload = { message: text.slice(0, 200) };
        }
    }
    if (!r.ok) {
        const rec = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
        throw new Error(readTrimmed(rec.message) || readTrimmed(rec.error) || `HTTP ${r.status}`);
    }
    return payload;
}
function toRow(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const r = value;
    const id = readTrimmed(r.id);
    if (!id)
        return null;
    const steps = Array.isArray(r.steps) ? r.steps : [];
    return {
        id,
        goal: readTrimmed(r.goal),
        status: (readTrimmed(r.status) || 'queued'),
        steps,
        rollback_token: r.rollback_token != null ? String(r.rollback_token) : null,
        rollback_applied: r.rollback_applied === true,
        result: (r.result && typeof r.result === 'object' && !Array.isArray(r.result)) ? r.result : null,
        error: r.error != null ? String(r.error) : null,
        created_at: readTrimmed(r.created_at) || nowIso(),
        updated_at: readTrimmed(r.updated_at) || nowIso(),
    };
}
export async function createAgentTask(goal) {
    await ensureOperationalMemorySchema();
    const rows = await rest('/ivx_agent_tasks?select=*', {
        method: 'POST',
        body: JSON.stringify({ goal: goal.slice(0, 4000), status: 'queued', steps: [] }),
    }, 'return=representation');
    const row = Array.isArray(rows) ? toRow(rows[0]) : null;
    if (!row)
        throw new Error('Failed to create agent task.');
    return row;
}
export async function updateAgentTask(id, patch) {
    await ensureOperationalMemorySchema();
    const rows = await rest(`/ivx_agent_tasks?id=eq.${encodeURIComponent(id)}&select=*`, {
        method: 'PATCH',
        body: JSON.stringify({ ...patch, updated_at: nowIso() }),
    }, 'return=representation');
    return Array.isArray(rows) ? toRow(rows[0]) : null;
}
export async function getAgentTask(id) {
    await ensureOperationalMemorySchema();
    const rows = await rest(`/ivx_agent_tasks?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return Array.isArray(rows) ? toRow(rows[0]) : null;
}
export async function listAgentTasks(limit = 25) {
    await ensureOperationalMemorySchema();
    const safe = Math.min(Math.max(Math.floor(limit), 1), 200);
    const rows = await rest(`/ivx_agent_tasks?select=*&order=created_at.desc&limit=${safe}`);
    return Array.isArray(rows) ? rows.map(toRow).filter((r) => r !== null) : [];
}
