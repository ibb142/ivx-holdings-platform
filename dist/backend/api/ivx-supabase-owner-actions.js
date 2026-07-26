import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const MAX_ROWS = 25;
const WRITE_CONFIRM_TEXT = 'CONFIRM_OWNER_SUPABASE_WRITE';
const DESTRUCTIVE_CONFIRM_TEXT = 'CONFIRM_OWNER_SUPABASE_DELETE';
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function nowIso() {
    return new Date().toISOString();
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function assertIdentifier(value, fallback, label) {
    const candidate = readTrimmed(value) || fallback || '';
    if (!IDENTIFIER_PATTERN.test(candidate)) {
        throw new Error(`Invalid ${label}.`);
    }
    return candidate;
}
function getSupabaseRestBaseUrl() {
    const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    if (!supabaseUrl) {
        throw new Error('Supabase URL is not configured on the backend.');
    }
    return `${supabaseUrl}/rest/v1`;
}
function decodeJwtRole(token) {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) {
        return null;
    }
    try {
        const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
        const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        return typeof parsed.role === 'string' ? parsed.role : null;
    }
    catch {
        return null;
    }
}
function getServiceRoleKey() {
    const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
    const serviceKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const role = decodeJwtRole(serviceKey);
    if (!serviceKey || serviceKey === anonKey || (role !== 'service_role' && role !== 'supabase_admin')) {
        throw new Error('A real backend-only Supabase service-role key is required for owner write actions.');
    }
    return serviceKey;
}
function getToolName(action) {
    if (action === 'insert') {
        return 'create_supabase_record';
    }
    if (action === 'update') {
        return 'update_supabase_record';
    }
    if (action === 'delete') {
        return 'delete_supabase_record';
    }
    return 'run_owner_approved_action';
}
function normalizeAction(value) {
    const action = readTrimmed(value).toLowerCase();
    if (action === 'create' || action === 'insert') {
        return 'insert';
    }
    if (action === 'update') {
        return 'update';
    }
    if (action === 'delete' || action === 'remove') {
        return 'delete';
    }
    if (action === 'owner_approved_action' || action === 'run_owner_approved_action') {
        return 'owner_approved_action';
    }
    throw new Error('Unsupported owner Supabase action.');
}
function buildMatchQuery(match) {
    const entries = Object.entries(match).filter(([, value]) => value !== undefined && value !== null && String(value).length > 0);
    if (entries.length === 0) {
        throw new Error('A match filter is required for update/delete owner actions.');
    }
    return entries.map(([key, value]) => {
        if (!IDENTIFIER_PATTERN.test(key)) {
            throw new Error('Invalid match filter column.');
        }
        return `${encodeURIComponent(key)}=eq.${encodeURIComponent(String(value))}`;
    }).join('&');
}
function buildRestUrl(schema, table, match) {
    const query = match ? buildMatchQuery(match) : '';
    const selectQuery = query ? `${query}&select=*` : 'select=*';
    const schemaPrefix = schema === 'public' ? '' : `${encodeURIComponent(schema)}.`;
    return `${getSupabaseRestBaseUrl()}/${schemaPrefix}${encodeURIComponent(table)}?${selectQuery}`;
}
async function logOwnerAction(ownerContext, input) {
    console.log('[IVXSupabaseOwnerActions] Owner action audit:', {
        userId: ownerContext.userId,
        email: ownerContext.email,
        role: ownerContext.role,
        guardMode: ownerContext.guardMode,
        action: input.action,
        schema: input.schema,
        table: input.table,
        affectedRows: input.affectedRows,
        reason: input.reason,
        timestamp: nowIso(),
    });
    try {
        const key = getServiceRoleKey();
        const response = await fetch(`${getSupabaseRestBaseUrl()}/audit_trail`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({
                action: `owner_supabase_${input.action}`,
                actor_id: ownerContext.userId,
                actor_email: ownerContext.email,
                entity_type: `${input.schema}.${input.table}`,
                entity_id: `${input.action}-${Date.now()}`,
                metadata: {
                    ownerOnly: true,
                    guardMode: ownerContext.guardMode,
                    affectedRows: input.affectedRows,
                    reason: input.reason,
                },
                created_at: nowIso(),
            }),
        });
        if (!response.ok) {
            console.log('[IVXSupabaseOwnerActions] audit_trail insert skipped:', response.status);
        }
    }
    catch (error) {
        console.log('[IVXSupabaseOwnerActions] audit_trail insert unavailable:', error instanceof Error ? error.message : 'unknown');
    }
}
export function OPTIONS() {
    return ownerOnlyOptions();
}
export async function runIVXSupabaseOwnerAction(ownerContext, body) {
    const action = normalizeAction(body.action);
    const schema = assertIdentifier(body.schema, 'public', 'schema');
    const table = assertIdentifier(body.table, null, 'table');
    const values = readRecord(body.values);
    const match = readRecord(body.match);
    const reason = readTrimmed(body.reason) || null;
    const requiredConfirmText = action === 'delete' ? DESTRUCTIVE_CONFIRM_TEXT : WRITE_CONFIRM_TEXT;
    if (body.confirm !== true || readTrimmed(body.confirmText) !== requiredConfirmText) {
        throw new Error(`Owner approval required. Resubmit with confirm=true and confirmText="${requiredConfirmText}".`);
    }
    if ((action === 'insert' || action === 'owner_approved_action') && Object.keys(values).length === 0) {
        throw new Error('Values are required for insert owner actions.');
    }
    if (action === 'update' && Object.keys(values).length === 0) {
        throw new Error('Values are required for update owner actions.');
    }
    const key = getServiceRoleKey();
    const method = action === 'insert' || action === 'owner_approved_action' ? 'POST' : action === 'update' ? 'PATCH' : 'DELETE';
    const url = buildRestUrl(schema, table, action === 'insert' || action === 'owner_approved_action' ? null : match);
    const response = await fetch(url, {
        method,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: `return=representation,count=exact,max-affected=${MAX_ROWS}`,
        },
        body: method === 'DELETE' ? undefined : JSON.stringify(values),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(text || `Supabase owner action failed with HTTP ${response.status}.`);
    }
    const data = text ? JSON.parse(text) : [];
    const affectedRows = Array.isArray(data) ? data.length : 0;
    await logOwnerAction(ownerContext, { action, schema, table, affectedRows, reason });
    return {
        ok: true,
        ownerOnly: true,
        writeEnabled: true,
        action,
        tool: getToolName(action),
        schema,
        table,
        affectedRows,
        destructiveConfirmationRequired: action === 'delete',
        timestamp: nowIso(),
        data: Array.isArray(data) ? data : [],
    };
}
export async function handleIVXSupabaseOwnerActionRequest(request) {
    try {
        if (request.method !== 'POST') {
            return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
        }
        const ownerContext = await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const action = normalizeAction(body.action);
        const schema = assertIdentifier(body.schema, 'public', 'schema');
        const table = assertIdentifier(body.table, null, 'table');
        const requiredConfirmText = action === 'delete' ? DESTRUCTIVE_CONFIRM_TEXT : WRITE_CONFIRM_TEXT;
        if (body.confirm !== true || readTrimmed(body.confirmText) !== requiredConfirmText) {
            return ownerOnlyJson({
                ok: false,
                ownerOnly: true,
                action,
                schema,
                table,
                writeConfirmationRequired: true,
                destructiveConfirmationRequired: action === 'delete',
                confirmTextRequired: requiredConfirmText,
                message: `Confirm this ${action} by resubmitting with confirm=true and confirmText="${requiredConfirmText}".`,
                timestamp: nowIso(),
            }, 409);
        }
        return ownerOnlyJson(await runIVXSupabaseOwnerAction(ownerContext, body));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Owner Supabase action failed.';
        console.log('[IVXSupabaseOwnerActions] Owner action failed:', { message });
        const isAuthError = message.includes('owner') || message.includes('Authorization') || message.includes('auth guard') || message.includes('bearer') || message.includes('session') || message.includes('token');
        return ownerOnlyJson({ error: message, ownerOnly: true, writeEnabled: true, timestamp: nowIso() }, isAuthError ? 401 : 400);
    }
}
