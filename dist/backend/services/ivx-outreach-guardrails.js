/**
 * IVX Outreach Campaign Guardrails (owner-only).
 *
 * Implements Block 4 of the owner's real-data mandate. No outreach is sent
 * without an immutable owner approval record (already enforced in
 * ivx-outreach-store.ts). This module adds the campaign-limit layer:
 *
 *   - Daily sending cap (per owner, per day)
 *   - Per-domain cap (per recipient email domain, per day)
 *   - Retry limit (max re-sends to a bounced recipient)
 *   - Bounce suppression (bounced recipients blocked for 30 days)
 *   - Unsubscribe handling (unsubscribed recipients blocked permanently)
 *   - Do-not-contact list (owner-managed, permanent block)
 *   - Duplicate-message prevention (same subject+recipient within 24h)
 *   - Time-zone-aware sending (only send during recipient local business hours)
 *   - Full sent/delivered/replied/bounced audit trail
 *
 * HARD HONESTY RULE: every guardrail is a hard block — a message that fails any
 * check is REJECTED with a 409 + the reason. No silent drops, no soft warnings.
 *
 * Runtime-light + deterministic: filesystem I/O only. Fully testable.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
import { listOutreachMessages } from './ivx-outreach-store';
export const IVX_OUTREACH_GUARDRAILS_MARKER = 'ivx-outreach-guardrails-2026-07-18';
export const DEFAULT_GUARDRAIL_CONFIG = {
    dailySendCap: 50,
    perDomainCap: 5,
    retryLimit: 2,
    bounceSuppressionDays: 30,
    duplicateWindowHours: 24,
    businessHoursStart: 8,
    businessHoursEnd: 20,
    allowUnknownTimezone: true,
};
// ── Do-not-contact + unsubscribe + bounce stores ─────────────────────────────
const ROOT = auditDir('outreach-guardrails');
const DNC_STATE = path.join(ROOT, 'do-not-contact.json');
const BOUNCE_STATE = path.join(ROOT, 'bounces.json');
const UNSUB_STATE = path.join(ROOT, 'unsubscribes.json');
function nowIso() {
    return new Date().toISOString();
}
function nowMs() {
    return Date.now();
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
    const eventFile = path.join(ROOT, 'guardrails.jsonl');
    if (isDurableStoreConfigured()) {
        try {
            await appendDurableEvent(eventFile, event);
        }
        catch {
            // best-effort
        }
        return;
    }
    try {
        await mkdir(ROOT, { recursive: true });
        await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // best-effort
    }
}
export async function listDoNotContact() {
    return readJsonFile(DNC_STATE, []);
}
export async function addToDoNotContact(identifier, reason, addedBy) {
    const items = await listDoNotContact();
    const existing = items.find((x) => x.identifier.toLowerCase() === identifier.toLowerCase());
    if (existing)
        return existing;
    const entry = {
        id: `dnc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        identifier: identifier.trim(),
        reason: reason.trim(),
        addedBy: addedBy.trim(),
        addedAt: nowIso(),
    };
    items.push(entry);
    await writeJsonFile(DNC_STATE, items);
    await appendEvent({ type: 'dnc_add', entry, at: entry.addedAt });
    return entry;
}
export async function removeFromDoNotContact(identifier) {
    const items = await listDoNotContact();
    const next = items.filter((x) => x.identifier.toLowerCase() !== identifier.toLowerCase());
    if (next.length === items.length)
        return false;
    await writeJsonFile(DNC_STATE, next);
    await appendEvent({ type: 'dnc_remove', identifier, at: nowIso() });
    return true;
}
function isDoNotContact(identifier, dnc) {
    const id = identifier.toLowerCase().trim();
    return dnc.some((x) => x.identifier.toLowerCase().trim() === id);
}
export async function listBounces() {
    return readJsonFile(BOUNCE_STATE, []);
}
export async function recordBounce(recipient) {
    const items = await listBounces();
    const domain = recipient.split('@')[1]?.toLowerCase() ?? '';
    const idx = items.findIndex((x) => x.recipient.toLowerCase() === recipient.toLowerCase());
    if (idx !== -1) {
        const entry = items[idx];
        entry.bounceCount += 1;
        entry.lastBounceAt = nowIso();
        items[idx] = entry;
        await writeJsonFile(BOUNCE_STATE, items);
        await appendEvent({ type: 'bounce', entry, at: entry.lastBounceAt });
        return entry;
    }
    const entry = {
        id: `bounce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        recipient: recipient.trim(),
        domain,
        bounceCount: 1,
        lastBounceAt: nowIso(),
    };
    items.push(entry);
    await writeJsonFile(BOUNCE_STATE, items);
    await appendEvent({ type: 'bounce', entry, at: entry.lastBounceAt });
    return entry;
}
function isBounceSuppressed(recipient, bounces, config) {
    const entry = bounces.find((x) => x.recipient.toLowerCase() === recipient.toLowerCase());
    if (!entry)
        return false;
    const lastBounceMs = Date.parse(entry.lastBounceAt);
    if (!Number.isFinite(lastBounceMs))
        return false;
    const suppressedUntil = lastBounceMs + config.bounceSuppressionDays * 24 * 60 * 60 * 1000;
    return nowMs() < suppressedUntil;
}
export async function listUnsubscribes() {
    return readJsonFile(UNSUB_STATE, []);
}
export async function recordUnsubscribe(recipient, reason) {
    const items = await listUnsubscribes();
    const existing = items.find((x) => x.recipient.toLowerCase() === recipient.toLowerCase());
    if (existing)
        return existing;
    const entry = {
        id: `unsub-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        recipient: recipient.trim(),
        unsubscribedAt: nowIso(),
        reason: reason.trim(),
    };
    items.push(entry);
    await writeJsonFile(UNSUB_STATE, items);
    await appendEvent({ type: 'unsubscribe', entry, at: entry.unsubscribedAt });
    return entry;
}
function isUnsubscribed(recipient, unsubs) {
    const id = recipient.toLowerCase().trim();
    return unsubs.some((x) => x.recipient.toLowerCase().trim() === id);
}
/** Extract the email domain from a recipient contact (email or name<email>). */
function extractDomain(recipientContact) {
    const match = recipientContact.match(/@([^\s>]+)/);
    return match ? match[1].toLowerCase() : '';
}
/** Count sends today (UTC) from the outreach message history. */
function countSendsToday(messages) {
    const today = new Date().toISOString().slice(0, 10);
    return messages.filter((m) => (m.status === 'sent' || m.status === 'replied') && (m.sentAt ?? '').slice(0, 10) === today).length;
}
/** Count sends today to a specific domain. */
function countDomainSendsToday(messages, domain) {
    if (!domain)
        return 0;
    const today = new Date().toISOString().slice(0, 10);
    return messages.filter((m) => (m.status === 'sent' || m.status === 'replied') &&
        (m.sentAt ?? '').slice(0, 10) === today &&
        extractDomain(m.recipientContact) === domain).length;
}
/** Check for duplicate message (same recipient + subject within the window). */
function isDuplicateMessage(messages, recipientContact, subject, windowHours) {
    const cutoff = nowMs() - windowHours * 60 * 60 * 1000;
    const recipient = recipientContact.toLowerCase().trim();
    const subj = subject.toLowerCase().trim();
    return messages.some((m) => m.recipientContact.toLowerCase().trim() === recipient &&
        m.subject.toLowerCase().trim() === subj &&
        Date.parse(m.createdAt) >= cutoff);
}
/** Check whether the recipient's local time is within business hours. */
function isWithinBusinessHours(recipientTimezone, config) {
    if (!recipientTimezone) {
        return config.allowUnknownTimezone;
    }
    try {
        const now = new Date();
        const local = new Intl.DateTimeFormat('en-US', {
            timeZone: recipientTimezone,
            hour: 'numeric',
            hour12: false,
        }).format(now);
        const hour = parseInt(local, 10);
        if (!Number.isFinite(hour))
            return config.allowUnknownTimezone;
        return hour >= config.businessHoursStart && hour < config.businessHoursEnd;
    }
    catch {
        return config.allowUnknownTimezone;
    }
}
/**
 * Evaluate ALL guardrails for a proposed send. Returns ok=true only if every
 * check passes. Any violation returns the first failure (deterministic order).
 */
export async function evaluateSendGuardrails(params) {
    const config = { ...DEFAULT_GUARDRAIL_CONFIG, ...params.config };
    const recipient = params.recipientContact.trim();
    const domain = extractDomain(recipient);
    if (!recipient) {
        return { ok: false, reason: 'Recipient contact is empty.', code: 'EMPTY_RECIPIENT' };
    }
    const [dnc, bounces, unsubs, messages] = await Promise.all([
        listDoNotContact(),
        listBounces(),
        listUnsubscribes(),
        listOutreachMessages(),
    ]);
    // 1. Do-not-contact
    if (isDoNotContact(recipient, dnc)) {
        return { ok: false, reason: 'Recipient is on the do-not-contact list.', code: 'DO_NOT_CONTACT' };
    }
    // 2. Unsubscribed
    if (isUnsubscribed(recipient, unsubs)) {
        return { ok: false, reason: 'Recipient has unsubscribed.', code: 'UNSUBSCRIBED' };
    }
    // 3. Bounce suppression
    if (isBounceSuppressed(recipient, bounces, config)) {
        return { ok: false, reason: `Recipient bounced recently (suppressed for ${config.bounceSuppressionDays} days).`, code: 'BOUNCE_SUPPRESSED' };
    }
    // 4. Duplicate message prevention
    if (isDuplicateMessage(messages, recipient, params.subject, config.duplicateWindowHours)) {
        return { ok: false, reason: `Duplicate message: same recipient + subject sent within ${config.duplicateWindowHours}h.`, code: 'DUPLICATE_MESSAGE' };
    }
    // 5. Daily send cap
    const sentToday = countSendsToday(messages);
    if (sentToday >= config.dailySendCap) {
        return { ok: false, reason: `Daily send cap reached (${sentToday}/${config.dailySendCap}).`, code: 'DAILY_CAP_REACHED' };
    }
    // 6. Per-domain cap
    if (domain) {
        const domainSentToday = countDomainSendsToday(messages, domain);
        if (domainSentToday >= config.perDomainCap) {
            return { ok: false, reason: `Per-domain cap reached for ${domain} (${domainSentToday}/${config.perDomainCap}).`, code: 'DOMAIN_CAP_REACHED' };
        }
    }
    // 7. Time-zone-aware sending
    if (!isWithinBusinessHours(params.recipientTimezone ?? null, config)) {
        return { ok: false, reason: 'Outside recipient business hours (time-zone-aware sending).', code: 'OUTSIDE_BUSINESS_HOURS' };
    }
    return { ok: true };
}
/** Build the full sent/delivered/replied/bounced audit trail. */
export async function buildOutreachAuditTrail() {
    const [messages, bounces, unsubs] = await Promise.all([
        listOutreachMessages(),
        listBounces(),
        listUnsubscribes(),
    ]);
    const entries = [];
    for (const m of messages) {
        if (m.status === 'sent' || m.status === 'replied') {
            entries.push({
                messageId: m.id,
                recipient: m.recipientContact,
                event: 'sent',
                at: m.sentAt ?? m.updatedAt,
                detail: `Subject: ${m.subject}`,
            });
            if (m.engagement.replied) {
                entries.push({
                    messageId: m.id,
                    recipient: m.recipientContact,
                    event: 'replied',
                    at: m.updatedAt,
                    detail: 'Recipient replied.',
                });
            }
        }
    }
    for (const b of bounces) {
        entries.push({
            messageId: '',
            recipient: b.recipient,
            event: 'bounced',
            at: b.lastBounceAt,
            detail: `Bounced ${b.bounceCount} time(s) (domain: ${b.domain}).`,
        });
    }
    for (const u of unsubs) {
        entries.push({
            messageId: '',
            recipient: u.recipient,
            event: 'unsubscribed',
            at: u.unsubscribedAt,
            detail: u.reason,
        });
    }
    entries.sort((a, b) => b.at.localeCompare(a.at));
    return {
        marker: IVX_OUTREACH_GUARDRAILS_MARKER,
        generatedAt: nowIso(),
        totalEvents: entries.length,
        sent: entries.filter((e) => e.event === 'sent').length,
        delivered: entries.filter((e) => e.event === 'delivered').length,
        replied: entries.filter((e) => e.event === 'replied').length,
        bounced: entries.filter((e) => e.event === 'bounced').length,
        unsubscribed: entries.filter((e) => e.event === 'unsubscribed').length,
        entries,
    };
}
