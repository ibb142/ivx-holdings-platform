/**
 * IVX Platform Modules — API handlers for the 28-module platform surface.
 *
 * Covers the genuinely missing modules with real, owner-gated, Supabase-backed
 * handlers. Public endpoints (waitlist signup, analytics event) return 200
 * without auth. All mutation endpoints require owner bearer auth.
 *
 * Routes (registered in hono.ts):
 *   Waitlist:
 *     GET  /api/ivx/waitlist               → list (owner)
 *     POST /api/ivx/waitlist               → create (public)
 *     POST /api/ivx/waitlist/:id/status    → update status (owner)
 *     POST /api/ivx/waitlist/:id/delete    → delete (owner)
 *
 *   Settings:
 *     GET  /api/ivx/settings               → list (owner)
 *     POST /api/ivx/settings               → upsert (owner)
 *
 *   Revenue:
 *     GET  /api/ivx/revenue                → list + summary (owner)
 *     POST /api/ivx/revenue                → create (owner)
 *     POST /api/ivx/revenue/:id/status     → update status (owner)
 *
 *   Push Notifications:
 *     GET  /api/ivx/notifications          → list (owner)
 *     POST /api/ivx/notifications          → create (owner)
 *     POST /api/ivx/notifications/:id/status → update status (owner)
 *
 *   Broadcast:
 *     GET  /api/ivx/broadcast              → list (owner)
 *     POST /api/ivx/broadcast              → create (owner)
 *     POST /api/ivx/broadcast/:id/status   → update status (owner)
 *     POST /api/ivx/broadcast/:id/delete   → delete (owner)
 *
 *   Roles & Permissions:
 *     GET  /api/ivx/roles                  → list definitions + assignments (owner)
 *     POST /api/ivx/roles/definitions      → upsert role definition (owner)
 *     POST /api/ivx/roles/assign           → assign role to user (owner)
 *     POST /api/ivx/roles/revoke           → revoke role (owner)
 *     GET  /api/ivx/roles/:userId/permissions → get user permissions (owner)
 *
 *   Transactions:
 *     GET  /api/ivx/transactions           → list + summary (owner)
 *     POST /api/ivx/transactions           → create (owner)
 *     POST /api/ivx/transactions/:id/status → update status (owner)
 *
 *   Casa Rosario:
 *     GET  /api/ivx/casa-rosario           → list (public)
 *     POST /api/ivx/casa-rosario           → create (owner)
 *     POST /api/ivx/casa-rosario/:id       → update (owner)
 *     POST /api/ivx/casa-rosario/:id/status → update status (owner)
 *     POST /api/ivx/casa-rosario/:id/delete → delete (owner)
 *
 *   Landing Analytics:
 *     GET  /api/ivx/landing-analytics      → summary (owner)
 *     POST /api/ivx/landing-analytics      → record event (public)
 *
 *   Reels → Deal Sync:
 *     GET  /api/ivx/reel-deal-sync         → list (owner)
 *     POST /api/ivx/reel-deal-sync         → create (owner)
 *     POST /api/ivx/reel-deal-sync/:id/delete → delete (owner)
 *
 *   Owner Dashboard:
 *     GET  /api/ivx/owner-dashboard        → aggregated summary (owner)
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { listWaitlist, createWaitlistEntry, setWaitlistStatus, deleteWaitlistEntry, listSettings, upsertSetting, listRevenue, createRevenueRecord, setRevenueStatus, summarizeRevenue, listNotifications, createNotification, setNotificationStatus, listBroadcasts, createBroadcast, setBroadcastStatus, deleteBroadcast, listRoleDefinitions, upsertRoleDefinition, listRoleAssignments, assignRole, revokeRole, getUserPermissions, getUserScreens, setAssignmentStatus, forceLogoutUser, clearForceLogout, updateUserScreens, setMfaRequirement, listAccessTemplates, createAccessTemplate, deleteAccessTemplate, listAccessGroups, createAccessGroup, deleteAccessGroup, listTransactions, createTransaction, setTransactionStatus, summarizeTransactions, listCasaRosario, createCasaRosarioListing, updateCasaRosarioListing, setCasaRosarioStatus, deleteCasaRosarioListing, listAnalyticsEvents, createAnalyticsEvent, summarizeAnalytics, listReelDealSyncs, createReelDealSync, deleteReelDealSync, getOwnerDashboardSummary, } from '../services/ivx-platform-modules-store';
export const OPTIONS = () => ownerOnlyOptions();
const VALID_WAITLIST_SOURCES = new Set([
    'landing_page', 'app', 'referral', 'owner_entered',
]);
const VALID_WAITLIST_STATUS = new Set([
    'pending', 'contacted', 'converted', 'declined',
]);
const VALID_REVENUE_TYPES = new Set([
    'deal_fee', 'management_fee', 'commission', 'subscription', 'other',
]);
const VALID_REVENUE_STATUS = new Set([
    'recorded', 'received', 'pending', 'written_off',
]);
const VALID_NOTIFICATION_CHANNELS = new Set([
    'push', 'email', 'sms', 'in_app',
]);
const VALID_NOTIFICATION_STATUS = new Set([
    'queued', 'sent', 'delivered', 'failed',
]);
const VALID_BROADCAST_STATUS = new Set([
    'draft', 'scheduled', 'sent', 'cancelled',
]);
const VALID_ROLES = new Set([
    'owner', 'ivx_staff', 'admin', 'member', 'investor',
    'buyer', 'jv_partner', 'influencer', 'realtor', 'broker',
    'agent', 'tokenized_investor', 'lender', 'auditor',
    'analyst', 'viewer',
]);
const VALID_TXN_TYPES = new Set([
    'deposit', 'withdrawal', 'distribution', 'fee', 'refund',
]);
const VALID_TXN_STATUS = new Set([
    'pending', 'completed', 'failed', 'reversed',
]);
const VALID_CASA_STATUS = new Set([
    'available', 'reserved', 'sold', 'off_market',
]);
const VALID_ANALYTICS_EVENTS = new Set([
    'page_view', 'cta_click', 'form_submit', 'invest_click', 'signup',
]);
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asOptionalNumber(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
}
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
async function readJsonBody(request) {
    try {
        const text = await request.text();
        if (!text)
            return {};
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
// ─── Waitlist handlers ───────────────────────────────────────────────────────
export async function handleWaitlistListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const entries = await listWaitlist();
    return ownerOnlyJson({ ok: true, entries, count: entries.length });
}
export async function handleWaitlistCreateRequest(request) {
    const body = await readJsonBody(request);
    const source = asString(body.source);
    if (!VALID_WAITLIST_SOURCES.has(source)) {
        return ownerOnlyJson({ ok: false, error: 'A valid source is required (landing_page | app | referral | owner_entered).' }, 400);
    }
    if (!asString(body.name)) {
        return ownerOnlyJson({ ok: false, error: 'Name is required.' }, 400);
    }
    if (!asString(body.email)) {
        return ownerOnlyJson({ ok: false, error: 'Email is required.' }, 400);
    }
    const entry = await createWaitlistEntry({
        name: asString(body.name),
        email: asString(body.email),
        phone: asString(body.phone),
        interest: asString(body.interest),
        source,
        sourceDetail: asString(body.sourceDetail),
    });
    return ownerOnlyJson({ ok: true, entry }, 201);
}
export async function handleWaitlistStatusRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    if (!VALID_WAITLIST_STATUS.has(status)) {
        return ownerOnlyJson({ ok: false, error: 'Invalid status.' }, 400);
    }
    const entry = await setWaitlistStatus(id, status);
    if (!entry)
        return ownerOnlyJson({ ok: false, error: 'Waitlist entry not found.' }, 404);
    return ownerOnlyJson({ ok: true, entry });
}
export async function handleWaitlistDeleteRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const deleted = await deleteWaitlistEntry(id);
    if (!deleted)
        return ownerOnlyJson({ ok: false, error: 'Waitlist entry not found.' }, 404);
    return ownerOnlyJson({ ok: true, deleted: true });
}
// ─── Settings handlers ───────────────────────────────────────────────────────
export async function handleSettingsListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const settings = await listSettings();
    return ownerOnlyJson({ ok: true, settings });
}
export async function handleSettingsUpsertRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const key = asString(body.key);
    const value = asString(body.value);
    if (!key) {
        return ownerOnlyJson({ ok: false, error: 'Setting key is required.' }, 400);
    }
    const owner = await assertIVXOwnerOnly(request);
    const record = await upsertSetting(key, value, owner.userId ?? 'owner');
    return ownerOnlyJson({ ok: true, setting: record });
}
// ─── Revenue handlers ────────────────────────────────────────────────────────
export async function handleRevenueListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const records = await listRevenue();
    const summary = await summarizeRevenue();
    return ownerOnlyJson({ ok: true, records, count: records.length, summary });
}
export async function handleRevenueCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const type = asString(body.type);
    if (!VALID_REVENUE_TYPES.has(type)) {
        return ownerOnlyJson({ ok: false, error: 'A valid revenue type is required.' }, 400);
    }
    if (!asString(body.description)) {
        return ownerOnlyJson({ ok: false, error: 'Description is required — IVX never fabricates revenue.' }, 400);
    }
    if (!asString(body.source)) {
        return ownerOnlyJson({ ok: false, error: 'Source attribution is required.' }, 400);
    }
    const record = await createRevenueRecord({
        description: asString(body.description),
        amount: asOptionalNumber(body.amount) ?? 0,
        currency: asString(body.currency),
        type,
        dealId: asString(body.dealId),
        source: asString(body.source),
        status: asString(body.status),
        receivedDate: asString(body.receivedDate) || null,
    });
    return ownerOnlyJson({ ok: true, record }, 201);
}
export async function handleRevenueStatusRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    if (!VALID_REVENUE_STATUS.has(status)) {
        return ownerOnlyJson({ ok: false, error: 'Invalid status.' }, 400);
    }
    const record = await setRevenueStatus(id, status);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Revenue record not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
// ─── Notifications handlers ──────────────────────────────────────────────────
export async function handleNotificationsListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const records = await listNotifications();
    return ownerOnlyJson({ ok: true, records, count: records.length });
}
export async function handleNotificationsCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const channel = asString(body.channel);
    if (!VALID_NOTIFICATION_CHANNELS.has(channel)) {
        return ownerOnlyJson({ ok: false, error: 'A valid channel is required (push | email | sms | in_app).' }, 400);
    }
    if (!asString(body.title)) {
        return ownerOnlyJson({ ok: false, error: 'Title is required.' }, 400);
    }
    const record = await createNotification({
        title: asString(body.title),
        body: asString(body.body),
        channel,
        audience: asString(body.audience),
        targetUserId: asString(body.targetUserId),
    });
    return ownerOnlyJson({ ok: true, record }, 201);
}
export async function handleNotificationsStatusRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    if (!VALID_NOTIFICATION_STATUS.has(status)) {
        return ownerOnlyJson({ ok: false, error: 'Invalid status.' }, 400);
    }
    const record = await setNotificationStatus(id, status);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Notification not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
// ─── Broadcast handlers ──────────────────────────────────────────────────────
export async function handleBroadcastListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const records = await listBroadcasts();
    return ownerOnlyJson({ ok: true, records, count: records.length });
}
export async function handleBroadcastCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    if (!asString(body.subject)) {
        return ownerOnlyJson({ ok: false, error: 'Subject is required.' }, 400);
    }
    if (!asString(body.message)) {
        return ownerOnlyJson({ ok: false, error: 'Message is required.' }, 400);
    }
    const owner = await assertIVXOwnerOnly(request);
    const record = await createBroadcast({
        subject: asString(body.subject),
        message: asString(body.message),
        audience: asString(body.audience),
        channel: asString(body.channel),
        scheduledAt: asString(body.scheduledAt) || null,
        createdBy: owner.userId ?? 'owner',
    });
    return ownerOnlyJson({ ok: true, record }, 201);
}
export async function handleBroadcastStatusRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    if (!VALID_BROADCAST_STATUS.has(status)) {
        return ownerOnlyJson({ ok: false, error: 'Invalid status.' }, 400);
    }
    const recipientCount = asOptionalNumber(body.recipientCount);
    const record = await setBroadcastStatus(id, status, recipientCount);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Broadcast not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
export async function handleBroadcastDeleteRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const deleted = await deleteBroadcast(id);
    if (!deleted)
        return ownerOnlyJson({ ok: false, error: 'Broadcast not found.' }, 404);
    return ownerOnlyJson({ ok: true, deleted: true });
}
// ─── Roles & Permissions handlers ────────────────────────────────────────────
export async function handleRolesListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const definitions = await listRoleDefinitions();
    const assignments = await listRoleAssignments();
    const templates = await listAccessTemplates();
    const groups = await listAccessGroups();
    return ownerOnlyJson({ ok: true, definitions, assignments, templates, groups, count: assignments.length });
}
export async function handleRoleDefinitionUpsertRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const name = asString(body.name);
    if (!VALID_ROLES.has(name)) {
        return ownerOnlyJson({ ok: false, error: 'A valid role name is required.' }, 400);
    }
    const screens = Array.isArray(body.screens) ? body.screens : [];
    const record = await upsertRoleDefinition({
        name,
        displayName: asString(body.displayName),
        permissions: Array.isArray(body.permissions) ? body.permissions : [],
        screens,
        isSystem: Boolean(body.isSystem),
    });
    return ownerOnlyJson({ ok: true, definition: record });
}
export async function handleRoleAssignRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const userId = asString(body.userId);
    const role = asString(body.role);
    if (!userId) {
        return ownerOnlyJson({ ok: false, error: 'userId is required.' }, 400);
    }
    if (!VALID_ROLES.has(role)) {
        return ownerOnlyJson({ ok: false, error: 'A valid role is required.' }, 400);
    }
    const owner = await assertIVXOwnerOnly(request);
    const screens = Array.isArray(body.screens) ? body.screens : [];
    const dataScope = (asString(body.dataScope) || 'assigned');
    const startDate = asString(body.startDate) || null;
    const expirationDate = asString(body.expirationDate) || null;
    const requireMfa = Boolean(body.requireMfa);
    const record = await assignRole(userId, asString(body.userEmail), role, owner.userId ?? 'owner', {
        screens,
        dataScope,
        startDate,
        expirationDate,
        requireMfa,
    });
    return ownerOnlyJson({ ok: true, assignment: record });
}
export async function handleUserScreensRequest(request, userId) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const screens = await getUserScreens(userId);
    return ownerOnlyJson({ ok: true, userId, screens });
}
export async function handleAssignmentStatusRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const userId = asString(body.userId);
    const status = asString(body.status);
    if (!userId) {
        return ownerOnlyJson({ ok: false, error: 'userId is required.' }, 400);
    }
    if (status !== 'active' && status !== 'suspended') {
        return ownerOnlyJson({ ok: false, error: 'status must be active or suspended.' }, 400);
    }
    const record = await setAssignmentStatus(userId, status);
    return ownerOnlyJson({ ok: true, assignment: record });
}
export async function handleForceLogoutRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const userId = asString(body.userId);
    if (!userId) {
        return ownerOnlyJson({ ok: false, error: 'userId is required.' }, 400);
    }
    const record = await forceLogoutUser(userId);
    return ownerOnlyJson({ ok: true, assignment: record });
}
export async function handleClearForceLogoutRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const userId = asString(body.userId);
    if (!userId) {
        return ownerOnlyJson({ ok: false, error: 'userId is required.' }, 400);
    }
    const record = await clearForceLogout(userId);
    return ownerOnlyJson({ ok: true, assignment: record });
}
export async function handleUpdateScreensRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const userId = asString(body.userId);
    if (!userId) {
        return ownerOnlyJson({ ok: false, error: 'userId is required.' }, 400);
    }
    const screens = Array.isArray(body.screens) ? body.screens : [];
    const record = await updateUserScreens(userId, screens);
    return ownerOnlyJson({ ok: true, assignment: record });
}
export async function handleSetMfaRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const userId = asString(body.userId);
    if (!userId) {
        return ownerOnlyJson({ ok: false, error: 'userId is required.' }, 400);
    }
    const requireMfa = Boolean(body.requireMfa);
    const record = await setMfaRequirement(userId, requireMfa);
    return ownerOnlyJson({ ok: true, assignment: record });
}
export async function handleAccessTemplateListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const templates = await listAccessTemplates();
    return ownerOnlyJson({ ok: true, templates, count: templates.length });
}
export async function handleAccessTemplateCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const name = asString(body.name);
    if (!name) {
        return ownerOnlyJson({ ok: false, error: 'Template name is required.' }, 400);
    }
    const role = asString(body.role);
    if (!VALID_ROLES.has(role)) {
        return ownerOnlyJson({ ok: false, error: 'A valid role is required.' }, 400);
    }
    const record = await createAccessTemplate({
        name,
        description: asString(body.description),
        role,
        screens: Array.isArray(body.screens) ? body.screens : [],
        dataScope: (asString(body.dataScope) || 'assigned'),
        permissions: Array.isArray(body.permissions) ? body.permissions : [],
    });
    return ownerOnlyJson({ ok: true, template: record }, 201);
}
export async function handleAccessTemplateDeleteRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const id = asString(body.id);
    if (!id) {
        return ownerOnlyJson({ ok: false, error: 'Template id is required.' }, 400);
    }
    const deleted = await deleteAccessTemplate(id);
    return ownerOnlyJson({ ok: true, deleted });
}
export async function handleAccessGroupListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const groups = await listAccessGroups();
    return ownerOnlyJson({ ok: true, groups, count: groups.length });
}
export async function handleAccessGroupCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const name = asString(body.name);
    if (!name) {
        return ownerOnlyJson({ ok: false, error: 'Group name is required.' }, 400);
    }
    const record = await createAccessGroup({
        name,
        description: asString(body.description),
        memberIds: Array.isArray(body.memberIds) ? body.memberIds : [],
        templateId: asString(body.templateId) || null,
    });
    return ownerOnlyJson({ ok: true, group: record }, 201);
}
export async function handleAccessGroupDeleteRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const id = asString(body.id);
    if (!id) {
        return ownerOnlyJson({ ok: false, error: 'Group id is required.' }, 400);
    }
    const deleted = await deleteAccessGroup(id);
    return ownerOnlyJson({ ok: true, deleted });
}
export async function handleRoleRevokeRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const userId = asString(body.userId);
    if (!userId) {
        return ownerOnlyJson({ ok: false, error: 'userId is required.' }, 400);
    }
    const revoked = await revokeRole(userId);
    return ownerOnlyJson({ ok: true, revoked });
}
export async function handleUserPermissionsRequest(request, userId) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const permissions = await getUserPermissions(userId);
    return ownerOnlyJson({ ok: true, userId, permissions });
}
// ─── Transactions handlers ───────────────────────────────────────────────────
export async function handleTransactionsListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const records = await listTransactions();
    const summary = await summarizeTransactions();
    return ownerOnlyJson({ ok: true, records, count: records.length, summary });
}
export async function handleTransactionsCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const type = asString(body.type);
    if (!VALID_TXN_TYPES.has(type)) {
        return ownerOnlyJson({ ok: false, error: 'A valid transaction type is required.' }, 400);
    }
    if (!asString(body.description)) {
        return ownerOnlyJson({ ok: false, error: 'Description is required — IVX never fabricates transactions.' }, 400);
    }
    const record = await createTransaction({
        type,
        amount: asOptionalNumber(body.amount) ?? 0,
        currency: asString(body.currency),
        description: asString(body.description),
        dealId: asString(body.dealId),
        userId: asString(body.userId),
        status: asString(body.status),
        reference: asString(body.reference),
    });
    return ownerOnlyJson({ ok: true, record }, 201);
}
export async function handleTransactionsStatusRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    if (!VALID_TXN_STATUS.has(status)) {
        return ownerOnlyJson({ ok: false, error: 'Invalid status.' }, 400);
    }
    const record = await setTransactionStatus(id, status);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Transaction not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
// ─── Casa Rosario handlers ───────────────────────────────────────────────────
export async function handleCasaRosarioListRequest(request) {
    // Public: anyone can view available listings.
    const listings = await listCasaRosario();
    return ownerOnlyJson({ ok: true, listings, count: listings.length });
}
export async function handleCasaRosarioCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    if (!asString(body.title)) {
        return ownerOnlyJson({ ok: false, error: 'Title is required — IVX never fabricates listings.' }, 400);
    }
    if (!asString(body.source)) {
        return ownerOnlyJson({ ok: false, error: 'Source attribution is required.' }, 400);
    }
    const record = await createCasaRosarioListing({
        title: asString(body.title),
        description: asString(body.description),
        price: asOptionalNumber(body.price),
        currency: asString(body.currency),
        bedrooms: asOptionalNumber(body.bedrooms),
        bathrooms: asOptionalNumber(body.bathrooms),
        squareFeet: asOptionalNumber(body.squareFeet),
        address: asString(body.address),
        city: asString(body.city),
        country: asString(body.country),
        images: Array.isArray(body.images) ? body.images : [],
        source: asString(body.source),
        sourceDetail: asString(body.sourceDetail),
    });
    return ownerOnlyJson({ ok: true, record }, 201);
}
export async function handleCasaRosarioUpdateRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const record = await updateCasaRosarioListing(id, body);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Listing not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
export async function handleCasaRosarioStatusRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    if (!VALID_CASA_STATUS.has(status)) {
        return ownerOnlyJson({ ok: false, error: 'Invalid status.' }, 400);
    }
    const record = await setCasaRosarioStatus(id, status);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Listing not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
export async function handleCasaRosarioDeleteRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const deleted = await deleteCasaRosarioListing(id);
    if (!deleted)
        return ownerOnlyJson({ ok: false, error: 'Listing not found.' }, 404);
    return ownerOnlyJson({ ok: true, deleted: true });
}
// ─── Landing Analytics handlers ──────────────────────────────────────────────
export async function handleAnalyticsSummaryRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const summary = await summarizeAnalytics();
    const recent = await listAnalyticsEvents(50);
    return ownerOnlyJson({ ok: true, summary, recent });
}
export async function handleAnalyticsEventRequest(request) {
    // Public: anyone can record an analytics event.
    const body = await readJsonBody(request);
    const event = asString(body.event);
    if (!VALID_ANALYTICS_EVENTS.has(event)) {
        return ownerOnlyJson({ ok: false, error: 'A valid event type is required.' }, 400);
    }
    if (!asString(body.page)) {
        return ownerOnlyJson({ ok: false, error: 'Page is required.' }, 400);
    }
    const record = await createAnalyticsEvent({
        page: asString(body.page),
        event: event,
        visitorId: asString(body.visitorId),
        referrer: asString(body.referrer),
        metadata: body.metadata,
    });
    return ownerOnlyJson({ ok: true, record }, 201);
}
// ─── Reels → Deal Sync handlers ──────────────────────────────────────────────
export async function handleReelDealSyncListRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const syncs = await listReelDealSyncs();
    return ownerOnlyJson({ ok: true, syncs, count: syncs.length });
}
export async function handleReelDealSyncCreateRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const body = await readJsonBody(request);
    const reelId = asString(body.reelId);
    const dealId = asString(body.dealId);
    if (!reelId || !dealId) {
        return ownerOnlyJson({ ok: false, error: 'Both reelId and dealId are required.' }, 400);
    }
    const owner = await assertIVXOwnerOnly(request);
    const record = await createReelDealSync(reelId, dealId, owner.userId ?? 'owner');
    return ownerOnlyJson({ ok: true, record }, 201);
}
export async function handleReelDealSyncDeleteRequest(request, id) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    const deleted = await deleteReelDealSync(id);
    if (!deleted)
        return ownerOnlyJson({ ok: false, error: 'Sync record not found.' }, 404);
    return ownerOnlyJson({ ok: true, deleted: true });
}
// ─── Owner Dashboard handler ─────────────────────────────────────────────────
export async function handleOwnerDashboardRequest(request) {
    const authError = await requireOwner(request);
    if (authError)
        return authError;
    // Import existing deal/investor summaries lazily to avoid circular deps.
    const { summarizeDeals } = await import('../services/ivx-deal-tracking-store');
    const { summarizeInvestors } = await import('../services/ivx-investor-crm-store');
    const dealMetrics = await summarizeDeals();
    const investorMetrics = await summarizeInvestors();
    const dealSummary = {
        count: dealMetrics.total,
        active: dealMetrics.byStatus.open + dealMetrics.byStatus.in_progress,
        closedWon: dealMetrics.byStatus.closed_won,
        closedLost: dealMetrics.byStatus.closed_lost,
    };
    const investorSummary = {
        count: investorMetrics.total,
        active: investorMetrics.byStatus.active,
        invested: investorMetrics.byStatus.invested,
    };
    const summary = await getOwnerDashboardSummary(dealSummary, investorSummary);
    return ownerOnlyJson({ ok: true, dashboard: summary });
}
