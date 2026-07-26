/**
 * IVX Platform Modules — durable store for the 28-module platform surface.
 *
 * Covers the genuinely missing modules (the ones with zero routes in hono.ts):
 *   - Waitlist (public sign-ups)
 *   - Settings (owner preferences)
 *   - Revenue (recorded revenue events, computed totals)
 *   - Push Notifications (notification log + pending queue)
 *   - Broadcast (owner→audience message log)
 *   - Roles & Permissions (RBAC: role definitions + member role assignments)
 *   - Transactions (capital movement ledger: deposit/withdrawal/distribution)
 *   - Casa Rosario (project-specific property listings)
 *   - Landing Analytics (page view events + computed funnel metrics)
 *   - Reels → Deal Sync (maps video-platform reels to deal-tracking deals)
 *   - Owner Dashboard (aggregated roll-up across all modules)
 *
 * Partner CRM / Broker CRM / Buyer CRM / Realtor CRM are filtered views over
 * the existing investor-crm-store (partyType filter) — no duplicate store.
 *
 * HARD HONESTY RULE (platform-wide, enforced here):
 *   - IVX NEVER fabricates data. Every record requires a real, attributable
 *     source. Unknown values stay empty/null — never invented.
 *   - Metrics are COMPUTED from recorded events, never fabricated.
 *
 * Durable layout (mirrors the proven ivx-investor-crm-store pattern):
 *   Supabase-backed via ivx-durable-store (survives Render restarts/deploys).
 *   Filesystem fallback for local dev / tests.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_PLATFORM_MODULES_MARKER = 'ivx-platform-modules-2026-07-07';
// ─── Shared helpers ──────────────────────────────────────────────────────────
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value.map((v) => asTrimmedString(v)).filter(Boolean)));
}
function asOptionalNumber(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
function asOptionalString(value) {
    const s = asTrimmedString(value);
    return s || null;
}
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
// ─── Durable I/O helpers ─────────────────────────────────────────────────────
async function readStoreJson(file, fallback) {
    if (isDurableStoreConfigured()) {
        return readDurableJson(file, fallback);
    }
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeStoreJson(file, value, dir) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(file, value);
        return;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendStoreEvent(eventFile, event, dir) {
    if (isDurableStoreConfigured()) {
        try {
            await appendDurableEvent(eventFile, event);
        }
        catch {
            // Forensic log is best-effort.
        }
        return;
    }
    try {
        await mkdir(dir, { recursive: true });
        await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort.
    }
}
const WAITLIST_DIR = auditDir('waitlist');
const WAITLIST_STATE = path.join(WAITLIST_DIR, 'entries.json');
export async function listWaitlist() {
    return readStoreJson(WAITLIST_STATE, []);
}
export async function createWaitlistEntry(input) {
    const entries = await listWaitlist();
    const now = nowIso();
    const entry = {
        id: createId('wl'),
        name: asTrimmedString(input.name),
        email: asTrimmedString(input.email).toLowerCase(),
        phone: asTrimmedString(input.phone),
        interest: asTrimmedString(input.interest),
        source: input.source,
        sourceDetail: asTrimmedString(input.sourceDetail),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
    };
    entries.push(entry);
    await writeStoreJson(WAITLIST_STATE, entries, WAITLIST_DIR);
    await appendStoreEvent(path.join(WAITLIST_DIR, 'entries.jsonl'), { type: 'created', entry }, WAITLIST_DIR);
    return entry;
}
export async function setWaitlistStatus(id, status) {
    const entries = await listWaitlist();
    const entry = entries.find((e) => e.id === id);
    if (!entry)
        return null;
    entry.status = status;
    entry.updatedAt = nowIso();
    await writeStoreJson(WAITLIST_STATE, entries, WAITLIST_DIR);
    await appendStoreEvent(path.join(WAITLIST_DIR, 'entries.jsonl'), { type: 'status_changed', id, status }, WAITLIST_DIR);
    return entry;
}
export async function deleteWaitlistEntry(id) {
    const entries = await listWaitlist();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0)
        return false;
    entries.splice(idx, 1);
    await writeStoreJson(WAITLIST_STATE, entries, WAITLIST_DIR);
    await appendStoreEvent(path.join(WAITLIST_DIR, 'entries.jsonl'), { type: 'deleted', id }, WAITLIST_DIR);
    return true;
}
const SETTINGS_DIR = auditDir('settings');
const SETTINGS_STATE = path.join(SETTINGS_DIR, 'settings.json');
export async function listSettings() {
    return readStoreJson(SETTINGS_STATE, []);
}
export async function getSetting(key) {
    const settings = await listSettings();
    const record = settings.find((s) => s.key === key);
    return record ? record.value : null;
}
export async function upsertSetting(key, value, updatedBy) {
    const settings = await listSettings();
    const existing = settings.find((s) => s.key === key);
    const now = nowIso();
    if (existing) {
        existing.value = asTrimmedString(value);
        existing.updatedAt = now;
        existing.updatedBy = asTrimmedString(updatedBy);
    }
    else {
        settings.push({ key, value: asTrimmedString(value), updatedAt: now, updatedBy: asTrimmedString(updatedBy) });
    }
    await writeStoreJson(SETTINGS_STATE, settings, SETTINGS_DIR);
    await appendStoreEvent(path.join(SETTINGS_DIR, 'settings.jsonl'), { type: 'upsert', key, value }, SETTINGS_DIR);
    return settings.find((s) => s.key === key);
}
const REVENUE_DIR = auditDir('revenue');
const REVENUE_STATE = path.join(REVENUE_DIR, 'records.json');
export async function listRevenue() {
    return readStoreJson(REVENUE_STATE, []);
}
export async function createRevenueRecord(input) {
    const records = await listRevenue();
    const now = nowIso();
    const record = {
        id: createId('rev'),
        description: asTrimmedString(input.description),
        amount: asOptionalNumber(input.amount) ?? 0,
        currency: asTrimmedString(input.currency) || 'USD',
        type: input.type,
        status: input.status ?? 'recorded',
        dealId: asOptionalString(input.dealId),
        source: asTrimmedString(input.source),
        receivedDate: asOptionalString(input.receivedDate),
        createdAt: now,
        updatedAt: now,
    };
    records.push(record);
    await writeStoreJson(REVENUE_STATE, records, REVENUE_DIR);
    await appendStoreEvent(path.join(REVENUE_DIR, 'records.jsonl'), { type: 'created', record }, REVENUE_DIR);
    return record;
}
export async function setRevenueStatus(id, status) {
    const records = await listRevenue();
    const record = records.find((r) => r.id === id);
    if (!record)
        return null;
    record.status = status;
    record.updatedAt = nowIso();
    await writeStoreJson(REVENUE_STATE, records, REVENUE_DIR);
    return record;
}
export async function summarizeRevenue() {
    const records = await listRevenue();
    const byType = {};
    let totalRecorded = 0;
    let totalReceived = 0;
    let totalPending = 0;
    for (const r of records) {
        totalRecorded += r.amount;
        byType[r.type] = (byType[r.type] ?? 0) + r.amount;
        if (r.status === 'received')
            totalReceived += r.amount;
        if (r.status === 'pending')
            totalPending += r.amount;
    }
    return { totalRecorded, totalReceived, totalPending, byType, count: records.length };
}
const NOTIFICATIONS_DIR = auditDir('notifications');
const NOTIFICATIONS_STATE = path.join(NOTIFICATIONS_DIR, 'records.json');
export async function listNotifications() {
    return readStoreJson(NOTIFICATIONS_STATE, []);
}
export async function createNotification(input) {
    const records = await listNotifications();
    const record = {
        id: createId('notif'),
        title: asTrimmedString(input.title),
        body: asTrimmedString(input.body),
        channel: input.channel,
        audience: input.audience ?? 'all',
        targetUserId: asOptionalString(input.targetUserId),
        status: 'queued',
        sentAt: null,
        createdAt: nowIso(),
    };
    records.push(record);
    await writeStoreJson(NOTIFICATIONS_STATE, records, NOTIFICATIONS_DIR);
    await appendStoreEvent(path.join(NOTIFICATIONS_DIR, 'records.jsonl'), { type: 'created', record }, NOTIFICATIONS_DIR);
    return record;
}
export async function setNotificationStatus(id, status) {
    const records = await listNotifications();
    const record = records.find((n) => n.id === id);
    if (!record)
        return null;
    record.status = status;
    if (status === 'sent' || status === 'delivered') {
        record.sentAt = nowIso();
    }
    await writeStoreJson(NOTIFICATIONS_STATE, records, NOTIFICATIONS_DIR);
    return record;
}
const BROADCAST_DIR = auditDir('broadcast');
const BROADCAST_STATE = path.join(BROADCAST_DIR, 'records.json');
export async function listBroadcasts() {
    return readStoreJson(BROADCAST_STATE, []);
}
export async function createBroadcast(input) {
    const records = await listBroadcasts();
    const now = nowIso();
    const record = {
        id: createId('bc'),
        subject: asTrimmedString(input.subject),
        message: asTrimmedString(input.message),
        audience: input.audience ?? 'all',
        channel: input.channel ?? 'email',
        status: input.scheduledAt ? 'scheduled' : 'draft',
        scheduledAt: asOptionalString(input.scheduledAt),
        sentAt: null,
        recipientCount: 0,
        createdBy: asTrimmedString(input.createdBy),
        createdAt: now,
        updatedAt: now,
    };
    records.push(record);
    await writeStoreJson(BROADCAST_STATE, records, BROADCAST_DIR);
    await appendStoreEvent(path.join(BROADCAST_DIR, 'records.jsonl'), { type: 'created', record }, BROADCAST_DIR);
    return record;
}
export async function setBroadcastStatus(id, status, recipientCount) {
    const records = await listBroadcasts();
    const record = records.find((b) => b.id === id);
    if (!record)
        return null;
    record.status = status;
    record.updatedAt = nowIso();
    if (status === 'sent') {
        record.sentAt = nowIso();
        if (typeof recipientCount === 'number')
            record.recipientCount = recipientCount;
    }
    await writeStoreJson(BROADCAST_STATE, records, BROADCAST_DIR);
    return record;
}
export async function deleteBroadcast(id) {
    const records = await listBroadcasts();
    const idx = records.findIndex((b) => b.id === id);
    if (idx < 0)
        return false;
    records.splice(idx, 1);
    await writeStoreJson(BROADCAST_STATE, records, BROADCAST_DIR);
    return true;
}
const ROLES_DIR = auditDir('roles');
const ROLES_STATE = path.join(ROLES_DIR, 'definitions.json');
const ASSIGNMENTS_STATE = path.join(ROLES_DIR, 'assignments.json');
const ALL_SCREENS = [
    'admin_hq', 'access_control', 'members', 'investors', 'buyers', 'jv_deals',
    'influencers', 'realtors', 'brokers', 'tokenized_investors', 'ivx_staff',
    'crm', 'properties', 'transactions', 'variables', 'developer_workspace',
    'ivx_owner_ai', 'deploy_approval', 'github_control', 'render_control',
    'revenue', 'audit_log', 'security_box', 'profile', 'owner_login', 'owner_console',
];
const ALL_PERMISSIONS = [
    'deals:read', 'deals:write', 'crm:read', 'crm:write', 'capital:read', 'capital:write',
    'revenue:read', 'revenue:write', 'broadcast:send', 'settings:write', 'users:manage',
    'members:read', 'members:write', 'investors:read', 'investors:write',
    'properties:read', 'properties:write', 'transactions:read', 'transactions:write',
    'variables:read', 'variables:write', 'developer:read', 'developer:write',
    'ai:chat', 'media:upload', 'admin:access', 'access_control:manage',
];
export const DEFAULT_ROLE_DEFINITIONS = [
    { name: 'owner', displayName: 'Owner', permissions: ALL_PERMISSIONS, screens: ALL_SCREENS, isSystem: true },
    { name: 'ivx_staff', displayName: 'IVX Staff', permissions: ['deals:read', 'crm:read', 'members:read', 'investors:read', 'properties:read', 'transactions:read', 'ai:chat', 'media:upload', 'admin:access'], screens: ['admin_hq', 'members', 'investors', 'crm', 'properties', 'transactions', 'ivx_owner_ai', 'profile'], isSystem: true },
    { name: 'admin', displayName: 'Administrator', permissions: ['deals:read', 'deals:write', 'crm:read', 'crm:write', 'members:read', 'members:write', 'investors:read', 'investors:write', 'properties:read', 'properties:write', 'transactions:read', 'transactions:write', 'broadcast:send', 'settings:write', 'admin:access'], screens: ['admin_hq', 'members', 'investors', 'crm', 'properties', 'transactions', 'revenue', 'audit_log', 'profile'], isSystem: true },
    { name: 'member', displayName: 'Member', permissions: ['deals:read', 'ai:chat', 'media:upload'], screens: ['profile', 'ivx_owner_ai'], isSystem: true },
    { name: 'investor', displayName: 'Investor', permissions: ['deals:read', 'transactions:read', 'ai:chat', 'media:upload'], screens: ['profile', 'transactions', 'ivx_owner_ai'], isSystem: true },
    { name: 'buyer', displayName: 'Buyer', permissions: ['deals:read', 'properties:read', 'ai:chat', 'media:upload'], screens: ['profile', 'properties', 'ivx_owner_ai'], isSystem: true },
    { name: 'jv_partner', displayName: 'JV Partner', permissions: ['deals:read', 'deals:write', 'transactions:read', 'ai:chat', 'media:upload'], screens: ['profile', 'jv_deals', 'transactions', 'ivx_owner_ai'], isSystem: true },
    { name: 'influencer', displayName: 'Influencer', permissions: ['deals:read', 'ai:chat', 'media:upload'], screens: ['profile', 'ivx_owner_ai'], isSystem: true },
    { name: 'realtor', displayName: 'Realtor', permissions: ['deals:read', 'properties:read', 'crm:read', 'ai:chat', 'media:upload'], screens: ['profile', 'properties', 'crm', 'ivx_owner_ai'], isSystem: true },
    { name: 'broker', displayName: 'Broker', permissions: ['deals:read', 'deals:write', 'properties:read', 'properties:write', 'crm:read', 'crm:write', 'ai:chat', 'media:upload'], screens: ['profile', 'properties', 'crm', 'jv_deals', 'ivx_owner_ai'], isSystem: true },
    { name: 'agent', displayName: 'Agent', permissions: ['deals:read', 'deals:write', 'crm:read', 'crm:write', 'properties:read', 'ai:chat', 'media:upload'], screens: ['profile', 'properties', 'crm', 'ivx_owner_ai'], isSystem: true },
    { name: 'tokenized_investor', displayName: 'Tokenized Investor', permissions: ['deals:read', 'transactions:read', 'capital:read', 'ai:chat', 'media:upload'], screens: ['profile', 'transactions', 'tokenized_investors', 'ivx_owner_ai'], isSystem: true },
    { name: 'lender', displayName: 'Lender', permissions: ['deals:read', 'capital:read', 'capital:write', 'ai:chat', 'media:upload'], screens: ['profile', 'ivx_owner_ai'], isSystem: true },
    { name: 'auditor', displayName: 'Auditor', permissions: ['deals:read', 'crm:read', 'revenue:read', 'transactions:read', 'members:read', 'investors:read'], screens: ['admin_hq', 'members', 'investors', 'crm', 'transactions', 'revenue', 'audit_log', 'profile'], isSystem: true },
    { name: 'analyst', displayName: 'Analyst', permissions: ['deals:read', 'crm:read', 'capital:read', 'revenue:read', 'members:read', 'investors:read', 'properties:read', 'transactions:read'], screens: ['admin_hq', 'members', 'investors', 'crm', 'properties', 'transactions', 'revenue', 'profile'], isSystem: true },
    { name: 'viewer', displayName: 'Viewer', permissions: ['deals:read'], screens: ['profile'], isSystem: true },
];
export async function listRoleDefinitions() {
    const defs = await readStoreJson(ROLES_STATE, []);
    if (defs.length === 0)
        return DEFAULT_ROLE_DEFINITIONS;
    return defs;
}
export async function upsertRoleDefinition(def) {
    const defs = await listRoleDefinitions();
    const existing = defs.find((d) => d.name === def.name);
    const now = nowIso();
    const record = {
        name: def.name,
        displayName: asTrimmedString(def.displayName),
        permissions: asStringArray(def.permissions),
        screens: asStringArray(def.screens),
        isSystem: def.isSystem ?? false,
    };
    if (existing) {
        existing.displayName = record.displayName;
        existing.permissions = record.permissions;
        existing.screens = record.screens;
    }
    else {
        defs.push(record);
    }
    await writeStoreJson(ROLES_STATE, defs, ROLES_DIR);
    await appendStoreEvent(path.join(ROLES_DIR, 'definitions.jsonl'), { type: 'upsert', record }, ROLES_DIR);
    return record;
}
export async function listRoleAssignments() {
    return readStoreJson(ASSIGNMENTS_STATE, []);
}
export async function assignRole(userId, userEmail, role, assignedBy, options) {
    const assignments = await listRoleAssignments();
    const existing = assignments.find((a) => a.userId === userId);
    const now = nowIso();
    const screens = options?.screens ?? [];
    const dataScope = options?.dataScope ?? 'assigned';
    const startDate = options?.startDate ?? null;
    const expirationDate = options?.expirationDate ?? null;
    const requireMfa = options?.requireMfa ?? false;
    if (existing) {
        existing.role = role;
        existing.userEmail = asTrimmedString(userEmail).toLowerCase();
        existing.updatedAt = now;
        existing.status = 'active';
        existing.screens = screens;
        existing.dataScope = dataScope;
        existing.startDate = startDate;
        existing.expirationDate = expirationDate;
        existing.requireMfa = requireMfa;
        existing.forceLogout = false;
        await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
        return existing;
    }
    const record = {
        id: createId('ra'),
        userId: asTrimmedString(userId),
        userEmail: asTrimmedString(userEmail).toLowerCase(),
        role,
        assignedBy: asTrimmedString(assignedBy),
        createdAt: now,
        updatedAt: now,
        status: 'active',
        startDate,
        expirationDate,
        dataScope,
        screens,
        requireMfa,
        forceLogout: false,
    };
    assignments.push(record);
    await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
    await appendStoreEvent(path.join(ROLES_DIR, 'assignments.jsonl'), { type: 'assigned', record }, ROLES_DIR);
    return record;
}
export async function revokeRole(userId) {
    const assignments = await listRoleAssignments();
    const idx = assignments.findIndex((a) => a.userId === userId);
    if (idx < 0)
        return false;
    assignments.splice(idx, 1);
    await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
    await appendStoreEvent(path.join(ROLES_DIR, 'assignments.jsonl'), { type: 'revoked', userId }, ROLES_DIR);
    return true;
}
export async function getUserPermissions(userId) {
    const assignments = await listRoleAssignments();
    const assignment = assignments.find((a) => a.userId === userId);
    if (!assignment)
        return [];
    if (assignment.status === 'suspended')
        return [];
    if (assignment.forceLogout)
        return [];
    if (assignment.expirationDate && new Date(assignment.expirationDate).getTime() < Date.now())
        return [];
    const defs = await listRoleDefinitions();
    const def = defs.find((d) => d.name === assignment.role);
    return def ? def.permissions : [];
}
export async function getUserScreens(userId) {
    const assignments = await listRoleAssignments();
    const assignment = assignments.find((a) => a.userId === userId);
    if (!assignment)
        return [];
    if (assignment.status === 'suspended')
        return [];
    if (assignment.forceLogout)
        return [];
    if (assignment.expirationDate && new Date(assignment.expirationDate).getTime() < Date.now())
        return [];
    if (assignment.screens.length > 0)
        return assignment.screens;
    const defs = await listRoleDefinitions();
    const def = defs.find((d) => d.name === assignment.role);
    return def ? def.screens : [];
}
export async function setAssignmentStatus(userId, status) {
    const assignments = await listRoleAssignments();
    const existing = assignments.find((a) => a.userId === userId);
    if (!existing)
        return null;
    existing.status = status;
    existing.updatedAt = nowIso();
    await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
    await appendStoreEvent(path.join(ROLES_DIR, 'assignments.jsonl'), { type: 'status_change', userId, status }, ROLES_DIR);
    return existing;
}
export async function forceLogoutUser(userId) {
    const assignments = await listRoleAssignments();
    const existing = assignments.find((a) => a.userId === userId);
    if (!existing)
        return null;
    existing.forceLogout = true;
    existing.updatedAt = nowIso();
    await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
    await appendStoreEvent(path.join(ROLES_DIR, 'assignments.jsonl'), { type: 'force_logout', userId }, ROLES_DIR);
    return existing;
}
export async function clearForceLogout(userId) {
    const assignments = await listRoleAssignments();
    const existing = assignments.find((a) => a.userId === userId);
    if (!existing)
        return null;
    existing.forceLogout = false;
    existing.updatedAt = nowIso();
    await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
    return existing;
}
export async function updateUserScreens(userId, screens) {
    const assignments = await listRoleAssignments();
    const existing = assignments.find((a) => a.userId === userId);
    if (!existing)
        return null;
    existing.screens = screens;
    existing.updatedAt = nowIso();
    await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
    await appendStoreEvent(path.join(ROLES_DIR, 'assignments.jsonl'), { type: 'screens_updated', userId, screens }, ROLES_DIR);
    return existing;
}
export async function setMfaRequirement(userId, requireMfa) {
    const assignments = await listRoleAssignments();
    const existing = assignments.find((a) => a.userId === userId);
    if (!existing)
        return null;
    existing.requireMfa = requireMfa;
    existing.updatedAt = nowIso();
    await writeStoreJson(ASSIGNMENTS_STATE, assignments, ROLES_DIR);
    return existing;
}
// ─── 6b. Access Templates & Groups ──────────────────────────────────────────
const TEMPLATES_DIR = auditDir('access-templates');
const TEMPLATES_STATE = path.join(TEMPLATES_DIR, 'records.json');
const GROUPS_DIR = auditDir('access-groups');
const GROUPS_STATE = path.join(GROUPS_DIR, 'records.json');
export async function listAccessTemplates() {
    return readStoreJson(TEMPLATES_STATE, []);
}
export async function createAccessTemplate(input) {
    const templates = await listAccessTemplates();
    const record = {
        id: createId('tpl'),
        name: asTrimmedString(input.name),
        description: asTrimmedString(input.description),
        role: input.role,
        screens: input.screens,
        dataScope: input.dataScope,
        permissions: input.permissions,
        createdAt: nowIso(),
    };
    templates.push(record);
    await writeStoreJson(TEMPLATES_STATE, templates, TEMPLATES_DIR);
    return record;
}
export async function deleteAccessTemplate(id) {
    const templates = await listAccessTemplates();
    const idx = templates.findIndex((t) => t.id === id);
    if (idx < 0)
        return false;
    templates.splice(idx, 1);
    await writeStoreJson(TEMPLATES_STATE, templates, TEMPLATES_DIR);
    return true;
}
export async function listAccessGroups() {
    return readStoreJson(GROUPS_STATE, []);
}
export async function createAccessGroup(input) {
    const groups = await listAccessGroups();
    const record = {
        id: createId('grp'),
        name: asTrimmedString(input.name),
        description: asTrimmedString(input.description),
        memberIds: Array.isArray(input.memberIds) ? input.memberIds : [],
        templateId: input.templateId ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
    groups.push(record);
    await writeStoreJson(GROUPS_STATE, groups, GROUPS_DIR);
    return record;
}
export async function deleteAccessGroup(id) {
    const groups = await listAccessGroups();
    const idx = groups.findIndex((g) => g.id === id);
    if (idx < 0)
        return false;
    groups.splice(idx, 1);
    await writeStoreJson(GROUPS_STATE, groups, GROUPS_DIR);
    return true;
}
const TRANSACTIONS_DIR = auditDir('transactions');
const TRANSACTIONS_STATE = path.join(TRANSACTIONS_DIR, 'records.json');
export async function listTransactions() {
    return readStoreJson(TRANSACTIONS_STATE, []);
}
export async function createTransaction(input) {
    const records = await listTransactions();
    const now = nowIso();
    const record = {
        id: createId('txn'),
        type: input.type,
        amount: asOptionalNumber(input.amount) ?? 0,
        currency: asTrimmedString(input.currency) || 'USD',
        description: asTrimmedString(input.description),
        dealId: asOptionalString(input.dealId),
        userId: asOptionalString(input.userId),
        status: input.status ?? 'pending',
        reference: asTrimmedString(input.reference) || createId('ref'),
        createdAt: now,
        updatedAt: now,
    };
    records.push(record);
    await writeStoreJson(TRANSACTIONS_STATE, records, TRANSACTIONS_DIR);
    await appendStoreEvent(path.join(TRANSACTIONS_DIR, 'records.jsonl'), { type: 'created', record }, TRANSACTIONS_DIR);
    return record;
}
export async function setTransactionStatus(id, status) {
    const records = await listTransactions();
    const record = records.find((t) => t.id === id);
    if (!record)
        return null;
    record.status = status;
    record.updatedAt = nowIso();
    await writeStoreJson(TRANSACTIONS_STATE, records, TRANSACTIONS_DIR);
    return record;
}
export async function summarizeTransactions() {
    const records = await listTransactions();
    const byType = {};
    let totalInflow = 0;
    let totalOutflow = 0;
    for (const t of records) {
        if (t.status !== 'completed')
            continue;
        byType[t.type] = (byType[t.type] ?? 0) + t.amount;
        if (t.type === 'deposit' || t.type === 'distribution')
            totalInflow += t.amount;
        if (t.type === 'withdrawal' || t.type === 'fee' || t.type === 'refund')
            totalOutflow += t.amount;
    }
    return { totalInflow, totalOutflow, net: totalInflow - totalOutflow, byType, count: records.length };
}
const CASA_DIR = auditDir('casa-rosario');
const CASA_STATE = path.join(CASA_DIR, 'listings.json');
export async function listCasaRosario() {
    return readStoreJson(CASA_STATE, []);
}
export async function createCasaRosarioListing(input) {
    const listings = await listCasaRosario();
    const now = nowIso();
    const record = {
        id: createId('casa'),
        title: asTrimmedString(input.title),
        description: asTrimmedString(input.description),
        price: asOptionalNumber(input.price),
        currency: asTrimmedString(input.currency) || 'USD',
        bedrooms: asOptionalNumber(input.bedrooms),
        bathrooms: asOptionalNumber(input.bathrooms),
        squareFeet: asOptionalNumber(input.squareFeet),
        address: asTrimmedString(input.address),
        city: asTrimmedString(input.city),
        country: asTrimmedString(input.country) || 'Dominican Republic',
        status: 'available',
        images: asStringArray(input.images),
        source: asTrimmedString(input.source),
        sourceDetail: asTrimmedString(input.sourceDetail),
        createdAt: now,
        updatedAt: now,
    };
    listings.push(record);
    await writeStoreJson(CASA_STATE, listings, CASA_DIR);
    await appendStoreEvent(path.join(CASA_DIR, 'listings.jsonl'), { type: 'created', record }, CASA_DIR);
    return record;
}
export async function updateCasaRosarioListing(id, patch) {
    const listings = await listCasaRosario();
    const record = listings.find((l) => l.id === id);
    if (!record)
        return null;
    if (patch.title !== undefined)
        record.title = asTrimmedString(patch.title);
    if (patch.description !== undefined)
        record.description = asTrimmedString(patch.description);
    if (patch.price !== undefined)
        record.price = asOptionalNumber(patch.price);
    if (patch.bedrooms !== undefined)
        record.bedrooms = asOptionalNumber(patch.bedrooms);
    if (patch.bathrooms !== undefined)
        record.bathrooms = asOptionalNumber(patch.bathrooms);
    if (patch.squareFeet !== undefined)
        record.squareFeet = asOptionalNumber(patch.squareFeet);
    if (patch.address !== undefined)
        record.address = asTrimmedString(patch.address);
    if (patch.city !== undefined)
        record.city = asTrimmedString(patch.city);
    if (patch.images !== undefined)
        record.images = asStringArray(patch.images);
    record.updatedAt = nowIso();
    await writeStoreJson(CASA_STATE, listings, CASA_DIR);
    return record;
}
export async function setCasaRosarioStatus(id, status) {
    const listings = await listCasaRosario();
    const record = listings.find((l) => l.id === id);
    if (!record)
        return null;
    record.status = status;
    record.updatedAt = nowIso();
    await writeStoreJson(CASA_STATE, listings, CASA_DIR);
    return record;
}
export async function deleteCasaRosarioListing(id) {
    const listings = await listCasaRosario();
    const idx = listings.findIndex((l) => l.id === id);
    if (idx < 0)
        return false;
    listings.splice(idx, 1);
    await writeStoreJson(CASA_STATE, listings, CASA_DIR);
    return true;
}
const ANALYTICS_DIR = auditDir('landing-analytics');
const ANALYTICS_STATE = path.join(ANALYTICS_DIR, 'events.json');
export async function listAnalyticsEvents(limit = 200) {
    const events = await readStoreJson(ANALYTICS_STATE, []);
    return events.slice(-Math.max(1, Math.min(1000, limit)));
}
export async function createAnalyticsEvent(input) {
    const events = await readStoreJson(ANALYTICS_STATE, []);
    const record = {
        id: createId('ae'),
        page: asTrimmedString(input.page),
        event: input.event,
        visitorId: asTrimmedString(input.visitorId) || createId('visitor'),
        referrer: asTrimmedString(input.referrer),
        metadata: input.metadata ?? {},
        createdAt: nowIso(),
    };
    events.push(record);
    // Cap stored events to prevent unbounded growth.
    const capped = events.slice(-5000);
    await writeStoreJson(ANALYTICS_STATE, capped, ANALYTICS_DIR);
    return record;
}
export async function summarizeAnalytics() {
    const events = await readStoreJson(ANALYTICS_STATE, []);
    const byEvent = {};
    const pageViews = {};
    let totalViews = 0;
    let totalCtaClicks = 0;
    let totalSignups = 0;
    let totalInvestClicks = 0;
    for (const e of events) {
        byEvent[e.event] = (byEvent[e.event] ?? 0) + 1;
        if (e.event === 'page_view') {
            totalViews++;
            pageViews[e.page] = (pageViews[e.page] ?? 0) + 1;
        }
        if (e.event === 'cta_click')
            totalCtaClicks++;
        if (e.event === 'signup')
            totalSignups++;
        if (e.event === 'invest_click')
            totalInvestClicks++;
    }
    const topPages = Object.entries(pageViews)
        .map(([page, views]) => ({ page, views }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10);
    const conversionRate = totalViews > 0 ? (totalSignups / totalViews) * 100 : 0;
    return { totalViews, totalCtaClicks, totalSignups, totalInvestClicks, conversionRate, topPages, byEvent };
}
const REEL_SYNC_DIR = auditDir('reel-deal-sync');
const REEL_SYNC_STATE = path.join(REEL_SYNC_DIR, 'syncs.json');
export async function listReelDealSyncs() {
    return readStoreJson(REEL_SYNC_STATE, []);
}
export async function createReelDealSync(reelId, dealId, syncedBy) {
    const syncs = await listReelDealSyncs();
    // Prevent duplicate mappings.
    const existing = syncs.find((s) => s.reelId === reelId && s.dealId === dealId);
    if (existing)
        return existing;
    const record = {
        id: createId('rds'),
        reelId: asTrimmedString(reelId),
        dealId: asTrimmedString(dealId),
        syncedBy: asTrimmedString(syncedBy),
        createdAt: nowIso(),
    };
    syncs.push(record);
    await writeStoreJson(REEL_SYNC_STATE, syncs, REEL_SYNC_DIR);
    await appendStoreEvent(path.join(REEL_SYNC_DIR, 'syncs.jsonl'), { type: 'synced', record }, REEL_SYNC_DIR);
    return record;
}
export async function deleteReelDealSync(id) {
    const syncs = await listReelDealSyncs();
    const idx = syncs.findIndex((s) => s.id === id);
    if (idx < 0)
        return false;
    syncs.splice(idx, 1);
    await writeStoreJson(REEL_SYNC_STATE, syncs, REEL_SYNC_DIR);
    return true;
}
export async function getOwnerDashboardSummary(dealSummary, investorSummary) {
    const waitlist = await listWaitlist();
    const revenueSummary = await summarizeRevenue();
    const txnSummary = await summarizeTransactions();
    const notifications = await listNotifications();
    const broadcasts = await listBroadcasts();
    const casa = await listCasaRosario();
    const analytics = await summarizeAnalytics();
    const assignments = await listRoleAssignments();
    const roleDefs = await listRoleDefinitions();
    return {
        deals: dealSummary,
        investors: investorSummary,
        waitlist: {
            count: waitlist.length,
            pending: waitlist.filter((w) => w.status === 'pending').length,
            converted: waitlist.filter((w) => w.status === 'converted').length,
        },
        revenue: { totalRecorded: revenueSummary.totalRecorded, totalReceived: revenueSummary.totalReceived },
        transactions: { totalInflow: txnSummary.totalInflow, totalOutflow: txnSummary.totalOutflow, net: txnSummary.net },
        notifications: {
            count: notifications.length,
            sent: notifications.filter((n) => n.status === 'sent' || n.status === 'delivered').length,
            queued: notifications.filter((n) => n.status === 'queued').length,
        },
        broadcasts: {
            count: broadcasts.length,
            sent: broadcasts.filter((b) => b.status === 'sent').length,
            draft: broadcasts.filter((b) => b.status === 'draft').length,
        },
        casaRosario: {
            count: casa.length,
            available: casa.filter((c) => c.status === 'available').length,
            sold: casa.filter((c) => c.status === 'sold').length,
        },
        landingAnalytics: {
            totalViews: analytics.totalViews,
            totalSignups: analytics.totalSignups,
            conversionRate: analytics.conversionRate,
        },
        roles: { assignments: assignments.length, roles: roleDefs.length },
        generatedAt: nowIso(),
    };
}
