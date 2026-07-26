/**
 * IVX IA Brain Memory — durable user-profile memory (Supabase-backed).
 *
 * IVX IA must remember WHO it is talking to across conversations, app reloads,
 * and Render restarts: the owner name, company, user names, roles, language and
 * preferred greeting. This is persisted in the same durable Supabase document
 * store the rest of the platform uses (survives deploy/restart on any tier — no
 * paid disk required), NOT in local app state.
 *
 * HARD HONESTY / PRIVACY RULE (platform-wide):
 *   - Only data the user explicitly asks IVX IA to remember is stored.
 *   - No sensitive data (passwords, tokens, payment, government IDs) is ever
 *     stored here, even if a command tries to — those values are rejected.
 *
 * Default identity (seeded once, owner profile):
 *   AI name:   IVX IA
 *   Company:   IVX Holding
 *   Owner:     Ivan Perez
 *
 * Durable layout (mirrors the proven business-store pattern):
 *   logs/audit/ia-memory/profiles.json   materialised current state (one row per user)
 *   logs/audit/ia-memory/profiles.jsonl  append-only forensic event log
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_IA_MEMORY_MARKER = 'ivx-ia-brain-memory-2026-06-08';
/** The fixed AI identity name. IVX IA always introduces itself by this name. */
export const IVX_IA_NAME = 'IVX IA';
/** The default owner profile identity, seeded on first use. */
export const IVX_DEFAULT_OWNER = {
    userId: 'owner',
    fullName: 'Ivan Perez',
    preferredName: 'Ivan Perez',
    company: 'IVX Holding',
    role: 'owner',
    email: '',
    language: 'en',
    greetingStyle: 'time_of_day',
};
const VALID_GREETING_STYLES = new Set([
    'time_of_day', 'formal', 'casual',
]);
const ROOT = auditDir('ia-memory');
const STATE = path.join(ROOT, 'profiles.json');
function nowIso() {
    return new Date().toISOString();
}
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeGreetingStyle(value) {
    const v = asTrimmedString(value).toLowerCase();
    return (VALID_GREETING_STYLES.has(v) ? v : 'time_of_day');
}
/**
 * Reject obviously-sensitive values so IVX IA never persists secrets even when a
 * command tries to. Privacy rule: only non-sensitive identity is remembered.
 */
const SENSITIVE_PATTERN = /(password|passcode|secret|token|api[\s_-]?key|ssn|social security|credit card|card number|cvv|seed phrase|private key|bank account)/i;
export function isSensitiveValue(value) {
    if (SENSITIVE_PATTERN.test(value))
        return true;
    // A long all-digit string looks like a card / account / id number.
    const digits = value.replace(/[\s-]/g, '');
    if (/^\d{12,}$/.test(digits))
        return true;
    return false;
}
async function readProfiles() {
    if (isDurableStoreConfigured()) {
        return readDurableJson(STATE, []);
    }
    try {
        const raw = await readFile(STATE, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
async function writeProfiles(value) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(STATE, value);
        return;
    }
    await mkdir(ROOT, { recursive: true });
    await writeFile(STATE, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    const eventFile = path.join(ROOT, 'profiles.jsonl');
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
        // Best-effort.
    }
}
function defaultProfileFor(userId) {
    const isOwner = userId === IVX_DEFAULT_OWNER.userId;
    const at = nowIso();
    return {
        userId,
        fullName: isOwner ? IVX_DEFAULT_OWNER.fullName : '',
        preferredName: isOwner ? IVX_DEFAULT_OWNER.preferredName : '',
        company: isOwner ? IVX_DEFAULT_OWNER.company : IVX_DEFAULT_OWNER.company,
        role: isOwner ? IVX_DEFAULT_OWNER.role : 'user',
        email: '',
        language: IVX_DEFAULT_OWNER.language,
        greetingStyle: IVX_DEFAULT_OWNER.greetingStyle,
        lastSeenAt: null,
        createdAt: at,
        updatedAt: at,
    };
}
/** Normalize a raw userId; empty/unknown collapses to the owner profile. */
export function normalizeUserId(value) {
    const v = asTrimmedString(value);
    return v || IVX_DEFAULT_OWNER.userId;
}
/**
 * Read a profile, seeding the owner default the first time it is requested so the
 * very first conversation already greets "Ivan Perez" / IVX Holding.
 */
export async function getProfile(userId) {
    const id = normalizeUserId(userId);
    const profiles = await readProfiles();
    const existing = profiles.find((p) => p.userId === id);
    if (existing)
        return existing;
    const seeded = defaultProfileFor(id);
    // Persist the owner seed so the row exists in the DB (proof: createMemoryRow).
    if (id === IVX_DEFAULT_OWNER.userId) {
        profiles.push(seeded);
        await writeProfiles(profiles);
        await appendEvent({ type: 'seed_owner', profile: seeded, at: seeded.createdAt });
    }
    return seeded;
}
/**
 * Create or update a user's remembered profile. Only the fields supplied are
 * changed. Sensitive values are rejected (privacy rule). `preferredName` falls
 * back to the first token of `fullName` when not given.
 */
export async function upsertProfile(userId, input) {
    const id = normalizeUserId(userId);
    for (const value of Object.values(input)) {
        if (typeof value === 'string' && isSensitiveValue(value)) {
            return { ok: false, error: 'I will not store sensitive data (passwords, tokens, card or account numbers). Only your name, company, role, language and greeting are remembered.' };
        }
    }
    const profiles = await readProfiles();
    const index = profiles.findIndex((p) => p.userId === id);
    const prior = index >= 0 ? profiles[index] : defaultProfileFor(id);
    const next = {
        ...prior,
        fullName: input.fullName !== undefined ? asTrimmedString(input.fullName) : prior.fullName,
        preferredName: input.preferredName !== undefined
            ? asTrimmedString(input.preferredName)
            : (input.fullName !== undefined && !prior.preferredName
                ? asTrimmedString(input.fullName).split(/\s+/)[0] ?? ''
                : prior.preferredName),
        company: input.company !== undefined ? asTrimmedString(input.company) : prior.company,
        role: input.role !== undefined ? (asTrimmedString(input.role) || prior.role) : prior.role,
        email: input.email !== undefined ? asTrimmedString(input.email) : prior.email,
        language: input.language !== undefined ? (asTrimmedString(input.language) || prior.language) : prior.language,
        greetingStyle: input.greetingStyle !== undefined ? normalizeGreetingStyle(input.greetingStyle) : prior.greetingStyle,
        updatedAt: nowIso(),
    };
    if (index >= 0) {
        profiles[index] = next;
    }
    else {
        profiles.push(next);
    }
    await writeProfiles(profiles);
    await appendEvent({ type: index >= 0 ? 'update' : 'create', profile: next, at: next.updatedAt });
    return { ok: true, profile: next };
}
/** Record that the user was just seen (drives "lastSeenAt" for greeting). */
export async function touchLastSeen(userId) {
    const id = normalizeUserId(userId);
    await getProfile(id); // ensure owner seed exists
    const profiles = await readProfiles();
    const index = profiles.findIndex((p) => p.userId === id);
    const at = nowIso();
    if (index >= 0) {
        profiles[index] = { ...profiles[index], lastSeenAt: at, updatedAt: at };
    }
    else {
        profiles.push({ ...defaultProfileFor(id), lastSeenAt: at });
    }
    await writeProfiles(profiles);
    return profiles.find((p) => p.userId === id);
}
/**
 * Forget a user's remembered NAME (clears fullName + preferredName) while keeping
 * the row. Use `deleteProfile` to remove the row entirely.
 */
export async function forgetName(userId) {
    const id = normalizeUserId(userId);
    const profiles = await readProfiles();
    const index = profiles.findIndex((p) => p.userId === id);
    if (index < 0)
        return null;
    const next = { ...profiles[index], fullName: '', preferredName: '', updatedAt: nowIso() };
    profiles[index] = next;
    await writeProfiles(profiles);
    await appendEvent({ type: 'forget_name', userId: id, at: next.updatedAt });
    return next;
}
/** Delete a user's entire remembered profile (owner edit/delete control). */
export async function deleteProfile(userId) {
    const id = normalizeUserId(userId);
    const profiles = await readProfiles();
    const next = profiles.filter((p) => p.userId !== id);
    if (next.length === profiles.length)
        return false;
    await writeProfiles(next);
    await appendEvent({ type: 'delete', userId: id, at: nowIso() });
    return true;
}
/** List every remembered profile (owner view control). */
export async function listProfiles() {
    const profiles = await readProfiles();
    return [...profiles].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
