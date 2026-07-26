/**
 * IVX Capital Deployment Platform — Automated Outreach store (owner-only).
 *
 * BLOCK 23. The third pillar of the Capital Deployment Platform: an automated
 * outreach system. IVX DRAFTS messages automatically (subject + body via the
 * deterministic ivx-outreach-drafter), but every draft requires OWNER APPROVAL
 * before it can move to a sent state. Engagement (sent / opened / clicked /
 * replied / meeting booked) is tracked per message.
 *
 * SAFETY (enforced here):
 *   - A message starts as `draft`. The lifecycle is:
 *       draft → pending_approval → approved → sent → replied
 *     A message can only become `approved`/`sent` through explicit owner action.
 *   - IVX never sends on its own; `markSent` only flips state once approved.
 *
 * HONESTY (enforced here):
 *   - IVX never fabricates recipient contact details. `recipientName` /
 *     `recipientContact` are owner-supplied; unknowns stay empty.
 *   - Engagement metrics are OWNER-RECORDED (no email-provider tracking is wired),
 *     so opened/clicked/replied/meetingBooked default to false and only change
 *     when the owner records them. We never invent open/click stats.
 *
 * Durable layout (mirrors the proven ivx-investor-crm-store pattern):
 *   logs/audit/outreach/messages.jsonl  append-only event log
 *   logs/audit/outreach/messages.json   materialised current state
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOutreachDraft } from './ivx-outreach-drafter';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_OUTREACH_MARKER = 'ivx-outreach-2026-05-31';
const ROOT = auditDir('outreach');
const STATE = path.join(ROOT, 'messages.json');
const VALID_TYPES = new Set([
    'email_campaign', 'follow_up', 'investor_intro', 'buyer_intro', 'meeting_request', 'deal_update',
]);
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function emptyEngagement() {
    return { opened: false, clicked: false, replied: false, meetingBooked: false };
}
async function readJsonFile(file, fallback) {
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
async function writeJsonFile(file, value) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(file, value);
        return;
    }
    await mkdir(ROOT, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    const eventFile = path.join(ROOT, 'messages.jsonl');
    if (isDurableStoreConfigured()) {
        try {
            await appendDurableEvent(eventFile, event);
        }
        catch {
            // Forensic log is best-effort; never break a write on log failure.
        }
        return;
    }
    try {
        await mkdir(ROOT, { recursive: true });
        await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort; never break a write on log failure.
    }
}
/** A message needs a valid type and a recipient name or company to be meaningful. */
export function validateCreateOutreach(input) {
    if (!VALID_TYPES.has(input.type)) {
        return { ok: false, error: 'A valid outreach type is required.' };
    }
    if (!asTrimmedString(input.recipientName) && !asTrimmedString(input.recipientCompany)) {
        return { ok: false, error: 'A recipient name or company is required — IVX never invents recipients.' };
    }
    return { ok: true };
}
/**
 * Create an outreach message. If subject/body aren't supplied, IVX drafts them
 * deterministically from the recipient + deal context. Always starts as `draft`.
 */
export async function createOutreachMessage(input) {
    const validation = validateCreateOutreach(input);
    if (!validation.ok)
        return validation;
    const ownerSubject = asTrimmedString(input.subject);
    const ownerBody = asTrimmedString(input.body);
    const aiDrafted = !ownerSubject || !ownerBody;
    const draft = aiDrafted
        ? buildOutreachDraft({
            type: input.type,
            recipientName: input.recipientName,
            recipientCompany: input.recipientCompany,
            relatedDeal: input.relatedDeal,
            contextNote: input.contextNote,
            senderName: input.senderName,
        })
        : { subject: ownerSubject, body: ownerBody };
    const message = {
        id: createId('outreach'),
        type: input.type,
        subject: ownerSubject || draft.subject,
        body: ownerBody || draft.body,
        recipientName: asTrimmedString(input.recipientName),
        recipientCompany: asTrimmedString(input.recipientCompany),
        recipientContact: asTrimmedString(input.recipientContact),
        relatedDeal: asTrimmedString(input.relatedDeal),
        status: 'draft',
        engagement: emptyEngagement(),
        aiDrafted,
        notes: asTrimmedString(input.notes),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        approvedAt: null,
        sentAt: null,
    };
    const items = await readJsonFile(STATE, []);
    items.push(message);
    await writeJsonFile(STATE, items);
    await appendEvent({ type: 'create', message, at: message.createdAt });
    return { ok: true, message };
}
export async function listOutreachMessages() {
    const items = await readJsonFile(STATE, []);
    return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getOutreachMessage(id) {
    const items = await readJsonFile(STATE, []);
    return items.find((item) => item.id === id) ?? null;
}
async function mutate(id, apply, eventType) {
    const items = await readJsonFile(STATE, []);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return null;
    const next = { ...apply(items[index]), updatedAt: nowIso() };
    items[index] = next;
    await writeJsonFile(STATE, items);
    await appendEvent({ type: eventType, messageId: id, message: next, at: next.updatedAt });
    return next;
}
/** Edit a draft's content/recipient. Only allowed before it is sent. */
export async function updateOutreachMessage(id, patch) {
    return mutate(id, (m) => {
        if (m.status === 'sent' || m.status === 'replied')
            return m; // immutable once sent
        return {
            ...m,
            subject: patch.subject !== undefined ? asTrimmedString(patch.subject) || m.subject : m.subject,
            body: patch.body !== undefined ? asTrimmedString(patch.body) || m.body : m.body,
            recipientName: patch.recipientName !== undefined ? asTrimmedString(patch.recipientName) : m.recipientName,
            recipientCompany: patch.recipientCompany !== undefined ? asTrimmedString(patch.recipientCompany) : m.recipientCompany,
            recipientContact: patch.recipientContact !== undefined ? asTrimmedString(patch.recipientContact) : m.recipientContact,
            relatedDeal: patch.relatedDeal !== undefined ? asTrimmedString(patch.relatedDeal) : m.relatedDeal,
            notes: patch.notes !== undefined ? asTrimmedString(patch.notes) : m.notes,
            // Editing content reverts an approval — the owner must re-approve.
            status: m.status === 'approved' || m.status === 'pending_approval' ? 'draft' : m.status,
            approvedAt: m.status === 'approved' || m.status === 'pending_approval' ? null : m.approvedAt,
        };
    }, 'update');
}
/** Move a draft into the approval queue. */
export async function submitForApproval(id) {
    return mutate(id, (m) => (m.status === 'draft' ? { ...m, status: 'pending_approval' } : m), 'submit');
}
/** Owner approves a message for sending. Only valid from draft/pending_approval. */
export async function approveOutreachMessage(id) {
    return mutate(id, (m) => {
        if (m.status === 'draft' || m.status === 'pending_approval') {
            return { ...m, status: 'approved', approvedAt: nowIso() };
        }
        return m;
    }, 'approve');
}
/**
 * Mark an approved message as sent. SAFETY: only an `approved` message can be
 * sent — returns the message unchanged (still requiring approval) otherwise.
 */
export async function markOutreachSent(id) {
    return mutate(id, (m) => (m.status === 'approved' ? { ...m, status: 'sent', sentAt: nowIso() } : m), 'sent');
}
/** Record owner-observed engagement on a sent message. */
export async function recordEngagement(id, patch) {
    return mutate(id, (m) => {
        const engagement = {
            opened: patch.opened ?? m.engagement.opened,
            clicked: patch.clicked ?? m.engagement.clicked,
            replied: patch.replied ?? m.engagement.replied,
            meetingBooked: patch.meetingBooked ?? m.engagement.meetingBooked,
        };
        // A reply implies the message reached a sent/replied state.
        const status = engagement.replied && (m.status === 'sent') ? 'replied' : m.status;
        return { ...m, engagement, status };
    }, 'engagement');
}
export async function deleteOutreachMessage(id) {
    const items = await readJsonFile(STATE, []);
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length)
        return false;
    await writeJsonFile(STATE, next);
    await appendEvent({ type: 'delete', messageId: id, at: nowIso() });
    return true;
}
/** Read-only roll-up over outreach for the dashboard header. */
export async function summarizeOutreach() {
    const items = await readJsonFile(STATE, []);
    const byStatus = {
        draft: 0, pending_approval: 0, approved: 0, sent: 0, replied: 0,
    };
    const byType = {
        email_campaign: 0, follow_up: 0, investor_intro: 0, buyer_intro: 0, meeting_request: 0, deal_update: 0,
    };
    let sent = 0;
    let opened = 0;
    let clicked = 0;
    let replied = 0;
    let meetingsBooked = 0;
    for (const item of items) {
        byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
        byType[item.type] = (byType[item.type] ?? 0) + 1;
        if (item.status === 'sent' || item.status === 'replied')
            sent += 1;
        if (item.engagement.opened)
            opened += 1;
        if (item.engagement.clicked)
            clicked += 1;
        if (item.engagement.replied)
            replied += 1;
        if (item.engagement.meetingBooked)
            meetingsBooked += 1;
    }
    return {
        marker: IVX_OUTREACH_MARKER,
        generatedAt: nowIso(),
        total: items.length,
        byStatus,
        byType,
        drafts: byStatus.draft,
        pendingApproval: byStatus.pending_approval,
        sent,
        opened,
        clicked,
        replied,
        meetingsBooked,
    };
}
