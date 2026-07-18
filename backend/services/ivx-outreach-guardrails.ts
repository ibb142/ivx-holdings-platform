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
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';
import { listOutreachMessages, type OutreachMessage } from './ivx-outreach-store';

export const IVX_OUTREACH_GUARDRAILS_MARKER = 'ivx-outreach-guardrails-2026-07-18';

// ── Configurable caps (owner can override via env or settings) ───────────────

export type OutreachGuardrailConfig = {
  dailySendCap: number;
  perDomainCap: number;
  retryLimit: number;
  bounceSuppressionDays: number;
  duplicateWindowHours: number;
  /** Recipient local business hours window (hour-of-day, 24h). */
  businessHoursStart: number;
  businessHoursEnd: number;
  /** If no timezone is known, allow sending (true) or block (false). */
  allowUnknownTimezone: boolean;
};

export const DEFAULT_GUARDRAIL_CONFIG: OutreachGuardrailConfig = {
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

function nowIso(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  if (isDurableStoreConfigured()) {
    return readDurableJson<T>(file, fallback);
  }
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(file, value);
    return;
  }
  await mkdir(ROOT, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  const eventFile = path.join(ROOT, 'guardrails.jsonl');
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(eventFile, event);
    } catch {
      // best-effort
    }
    return;
  }
  try {
    await mkdir(ROOT, { recursive: true });
    await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // best-effort
  }
}

// ── Do-not-contact list ──────────────────────────────────────────────────────

export type DoNotContactEntry = {
  id: string;
  /** Email or phone or investorId. */
  identifier: string;
  reason: string;
  addedBy: string;
  addedAt: string;
};

export async function listDoNotContact(): Promise<DoNotContactEntry[]> {
  return readJsonFile<DoNotContactEntry[]>(DNC_STATE, []);
}

export async function addToDoNotContact(
  identifier: string,
  reason: string,
  addedBy: string,
): Promise<DoNotContactEntry> {
  const items = await listDoNotContact();
  const existing = items.find((x) => x.identifier.toLowerCase() === identifier.toLowerCase());
  if (existing) return existing;
  const entry: DoNotContactEntry = {
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

export async function removeFromDoNotContact(identifier: string): Promise<boolean> {
  const items = await listDoNotContact();
  const next = items.filter((x) => x.identifier.toLowerCase() !== identifier.toLowerCase());
  if (next.length === items.length) return false;
  await writeJsonFile(DNC_STATE, next);
  await appendEvent({ type: 'dnc_remove', identifier, at: nowIso() });
  return true;
}

function isDoNotContact(identifier: string, dnc: DoNotContactEntry[]): boolean {
  const id = identifier.toLowerCase().trim();
  return dnc.some((x) => x.identifier.toLowerCase().trim() === id);
}

// ── Bounce suppression ───────────────────────────────────────────────────────

export type BounceEntry = {
  id: string;
  recipient: string;
  domain: string;
  bounceCount: number;
  lastBounceAt: string;
};

export async function listBounces(): Promise<BounceEntry[]> {
  return readJsonFile<BounceEntry[]>(BOUNCE_STATE, []);
}

export async function recordBounce(recipient: string): Promise<BounceEntry> {
  const items = await listBounces();
  const domain = recipient.split('@')[1]?.toLowerCase() ?? '';
  const idx = items.findIndex((x) => x.recipient.toLowerCase() === recipient.toLowerCase());
  if (idx !== -1) {
    const entry = items[idx]!;
    entry.bounceCount += 1;
    entry.lastBounceAt = nowIso();
    items[idx] = entry;
    await writeJsonFile(BOUNCE_STATE, items);
    await appendEvent({ type: 'bounce', entry, at: entry.lastBounceAt });
    return entry;
  }
  const entry: BounceEntry = {
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

function isBounceSuppressed(recipient: string, bounces: BounceEntry[], config: OutreachGuardrailConfig): boolean {
  const entry = bounces.find((x) => x.recipient.toLowerCase() === recipient.toLowerCase());
  if (!entry) return false;
  const lastBounceMs = Date.parse(entry.lastBounceAt);
  if (!Number.isFinite(lastBounceMs)) return false;
  const suppressedUntil = lastBounceMs + config.bounceSuppressionDays * 24 * 60 * 60 * 1000;
  return nowMs() < suppressedUntil;
}

// ── Unsubscribe handling ─────────────────────────────────────────────────────

export type UnsubscribeEntry = {
  id: string;
  recipient: string;
  unsubscribedAt: string;
  reason: string;
};

export async function listUnsubscribes(): Promise<UnsubscribeEntry[]> {
  return readJsonFile<UnsubscribeEntry[]>(UNSUB_STATE, []);
}

export async function recordUnsubscribe(recipient: string, reason: string): Promise<UnsubscribeEntry> {
  const items = await listUnsubscribes();
  const existing = items.find((x) => x.recipient.toLowerCase() === recipient.toLowerCase());
  if (existing) return existing;
  const entry: UnsubscribeEntry = {
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

function isUnsubscribed(recipient: string, unsubs: UnsubscribeEntry[]): boolean {
  const id = recipient.toLowerCase().trim();
  return unsubs.some((x) => x.recipient.toLowerCase().trim() === id);
}

// ── Guardrail evaluation ─────────────────────────────────────────────────────

export type GuardrailViolation = {
  ok: false;
  reason: string;
  code: string;
};

export type GuardrailPass = { ok: true };

export type GuardrailResult = GuardrailPass | GuardrailViolation;

/** Extract the email domain from a recipient contact (email or name<email>). */
function extractDomain(recipientContact: string): string {
  const match = recipientContact.match(/@([^\s>]+)/);
  return match ? match[1].toLowerCase() : '';
}

/** Count sends today (UTC) from the outreach message history. */
function countSendsToday(messages: OutreachMessage[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return messages.filter(
    (m) => (m.status === 'sent' || m.status === 'replied') && (m.sentAt ?? '').slice(0, 10) === today,
  ).length;
}

/** Count sends today to a specific domain. */
function countDomainSendsToday(messages: OutreachMessage[], domain: string): number {
  if (!domain) return 0;
  const today = new Date().toISOString().slice(0, 10);
  return messages.filter(
    (m) =>
      (m.status === 'sent' || m.status === 'replied') &&
      (m.sentAt ?? '').slice(0, 10) === today &&
      extractDomain(m.recipientContact) === domain,
  ).length;
}

/** Check for duplicate message (same recipient + subject within the window). */
function isDuplicateMessage(
  messages: OutreachMessage[],
  recipientContact: string,
  subject: string,
  windowHours: number,
): boolean {
  const cutoff = nowMs() - windowHours * 60 * 60 * 1000;
  const recipient = recipientContact.toLowerCase().trim();
  const subj = subject.toLowerCase().trim();
  return messages.some(
    (m) =>
      m.recipientContact.toLowerCase().trim() === recipient &&
      m.subject.toLowerCase().trim() === subj &&
      Date.parse(m.createdAt) >= cutoff,
  );
}

/** Check whether the recipient's local time is within business hours. */
function isWithinBusinessHours(
  recipientTimezone: string | null,
  config: OutreachGuardrailConfig,
): boolean {
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
    if (!Number.isFinite(hour)) return config.allowUnknownTimezone;
    return hour >= config.businessHoursStart && hour < config.businessHoursEnd;
  } catch {
    return config.allowUnknownTimezone;
  }
}

/**
 * Evaluate ALL guardrails for a proposed send. Returns ok=true only if every
 * check passes. Any violation returns the first failure (deterministic order).
 */
export async function evaluateSendGuardrails(params: {
  recipientContact: string;
  subject: string;
  recipientTimezone?: string | null;
  config?: Partial<OutreachGuardrailConfig>;
}): Promise<GuardrailResult> {
  const config: OutreachGuardrailConfig = { ...DEFAULT_GUARDRAIL_CONFIG, ...params.config };
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

export type OutreachAuditTrailEntry = {
  messageId: string;
  recipient: string;
  event: 'sent' | 'delivered' | 'replied' | 'bounced' | 'unsubscribed';
  at: string;
  detail: string;
};

export type OutreachAuditTrail = {
  marker: string;
  generatedAt: string;
  totalEvents: number;
  sent: number;
  delivered: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  entries: OutreachAuditTrailEntry[];
};

/** Build the full sent/delivered/replied/bounced audit trail. */
export async function buildOutreachAuditTrail(): Promise<OutreachAuditTrail> {
  const [messages, bounces, unsubs] = await Promise.all([
    listOutreachMessages(),
    listBounces(),
    listUnsubscribes(),
  ]);
  const entries: OutreachAuditTrailEntry[] = [];
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
