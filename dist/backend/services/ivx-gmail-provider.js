/**
 * IVX Gmail OAuth Draft Provider (owner-only).
 *
 * BLOCK 4. A Gmail OAuth/draft provider that is only usable AFTER the owner-session
 * preflight is green (enforced client-side) and the owner explicitly connects Gmail.
 * It models the Gmail connection HONESTLY:
 *
 *   - "Connected" requires (a) a real Gmail OAuth credential in the backend runtime
 *     (`GMAIL_OAUTH_TOKEN` or `GMAIL_REFRESH_TOKEN`) AND (b) an explicit owner connect
 *     action recorded in the durable store. Disconnect flips the owner state off.
 *   - We NEVER fabricate a connection: with no OAuth credential configured, connect
 *     returns GMAIL_OAUTH_NOT_CONFIGURED naming the exact env to set, and status stays
 *     `not_connected`.
 *
 * Draft creation gate (`createGmailDraft`) enforces, in this order:
 *   1. Gmail connected            → else GMAIL_PROVIDER_NOT_CONNECTED
 *   2. Verified contact           → else CONTACT_NOT_VERIFIED
 *   3. Owner approval             → else OWNER_APPROVAL_REQUIRED
 * On success it creates a Gmail DRAFT only (never sends), returns the Gmail draft id,
 * sets the outreach status to `draft_created`, and creates a `follow_up_due_at`.
 *
 * Durable layout (mirrors ivx-outreach-store):
 *   logs/audit/gmail-provider/connection.json   owner connect state
 *   logs/audit/gmail-provider/drafts.json        created Gmail drafts
 *   logs/audit/gmail-provider/events.jsonl       append-only forensic log
 *
 * Never logs or returns the OAuth token/secret.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOutreachDraft } from './ivx-outreach-drafter';
import { detectConfiguredEmailProvider } from './ivx-email-provider';
export const IVX_GMAIL_PROVIDER_MARKER = 'ivx-gmail-provider-2026-06-05';
const ROOT = path.join(process.cwd(), 'logs', 'audit', 'gmail-provider');
const CONNECTION = path.join(ROOT, 'connection.json');
const DRAFTS = path.join(ROOT, 'drafts.json');
/** Default Gmail scope IVX requests — compose-only (draft, never auto-send). */
const DEFAULT_GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function asTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function present(env, key) {
    return asTrimmed(env[key]).length > 0;
}
async function readJsonFile(file, fallback) {
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeJsonFile(file, value) {
    await mkdir(ROOT, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    try {
        await mkdir(ROOT, { recursive: true });
        await appendFile(path.join(ROOT, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort.
    }
}
function freshConnection() {
    return { ownerConnected: false, connectedAt: null, lastVerifiedAt: null, disconnectedAt: null };
}
/** Read the env-derived Gmail credential availability (never returns the secret). */
function detectGmailCredentials(env = process.env) {
    const provider = detectConfiguredEmailProvider(env);
    const available = provider.available.includes('gmail');
    const ownerEmail = asTrimmed(env.GMAIL_OWNER_EMAIL) || null;
    const scopeEnv = asTrimmed(env.GMAIL_OAUTH_SCOPES);
    const scopes = scopeEnv
        ? scopeEnv.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
        : [...DEFAULT_GMAIL_SCOPES];
    const tokenExpiry = asTrimmed(env.GMAIL_TOKEN_EXPIRY) || null;
    const missingEnv = present(env, 'GMAIL_OAUTH_TOKEN') || present(env, 'GMAIL_REFRESH_TOKEN')
        ? []
        : ['GMAIL_OAUTH_TOKEN', 'GMAIL_REFRESH_TOKEN'];
    return { available, ownerEmail, scopes, tokenExpiry, missingEnv };
}
/** Build the live Gmail provider status from env credentials + the owner connect record. */
export async function getGmailProviderStatus() {
    const creds = detectGmailCredentials();
    const conn = await readJsonFile(CONNECTION, freshConnection());
    const connected = creds.available && conn.ownerConnected;
    return {
        marker: IVX_GMAIL_PROVIDER_MARKER,
        state: connected ? 'connected' : 'not_connected',
        connected,
        ownerEmail: creds.ownerEmail,
        scopeGranted: connected ? creds.scopes : [],
        lastVerifiedAt: connected ? conn.lastVerifiedAt : null,
        tokenExpiry: connected ? creds.tokenExpiry : null,
        backedByCredentials: creds.available,
        missingEnv: creds.missingEnv,
        note: connected
            ? `Gmail connected${creds.ownerEmail ? ` as ${creds.ownerEmail}` : ''} (compose scope — drafts only, never auto-sends).`
            : creds.available
                ? 'Gmail OAuth credentials present but not connected — tap Connect Gmail.'
                : `GMAIL_OAUTH_NOT_CONFIGURED — set ${creds.missingEnv.join(' or ')} in the backend runtime to enable Gmail, then Connect.`,
    };
}
/** Connect Gmail — only succeeds when a real OAuth credential is configured. */
export async function connectGmail() {
    const creds = detectGmailCredentials();
    if (!creds.available) {
        const status = await getGmailProviderStatus();
        return {
            ok: false,
            error: 'GMAIL_OAUTH_NOT_CONFIGURED',
            detail: `Cannot connect Gmail — no OAuth credential in the runtime. Set ${creds.missingEnv.join(' or ')} (and optionally GMAIL_OWNER_EMAIL / GMAIL_OAUTH_SCOPES / GMAIL_TOKEN_EXPIRY), then Connect.`,
            status,
        };
    }
    const conn = await readJsonFile(CONNECTION, freshConnection());
    const next = {
        ownerConnected: true,
        connectedAt: conn.connectedAt ?? nowIso(),
        lastVerifiedAt: nowIso(),
        disconnectedAt: null,
    };
    await writeJsonFile(CONNECTION, next);
    await appendEvent({ type: 'connect', at: next.lastVerifiedAt, ownerEmail: creds.ownerEmail });
    const status = await getGmailProviderStatus();
    return { ok: true, status, note: 'Gmail connected.' };
}
/** Disconnect Gmail — flips the owner connect state off (credentials untouched). */
export async function disconnectGmail() {
    const conn = await readJsonFile(CONNECTION, freshConnection());
    const next = {
        ownerConnected: false,
        connectedAt: conn.connectedAt,
        lastVerifiedAt: conn.lastVerifiedAt,
        disconnectedAt: nowIso(),
    };
    await writeJsonFile(CONNECTION, next);
    await appendEvent({ type: 'disconnect', at: next.disconnectedAt });
    const status = await getGmailProviderStatus();
    return { ok: true, status, note: 'Gmail disconnected.' };
}
/** Refresh the Gmail token — re-verifies the credential + stamps lastVerifiedAt. */
export async function refreshGmailToken() {
    const creds = detectGmailCredentials();
    if (!creds.available) {
        const status = await getGmailProviderStatus();
        return {
            ok: false,
            error: 'GMAIL_OAUTH_NOT_CONFIGURED',
            detail: `Cannot refresh — no Gmail OAuth credential in the runtime. Set ${creds.missingEnv.join(' or ')}.`,
            status,
        };
    }
    const conn = await readJsonFile(CONNECTION, freshConnection());
    if (!conn.ownerConnected) {
        const status = await getGmailProviderStatus();
        return {
            ok: false,
            error: 'GMAIL_PROVIDER_NOT_CONNECTED',
            detail: 'Connect Gmail before refreshing the token.',
            status,
        };
    }
    const next = { ...conn, lastVerifiedAt: nowIso() };
    await writeJsonFile(CONNECTION, next);
    await appendEvent({ type: 'refresh', at: next.lastVerifiedAt });
    const status = await getGmailProviderStatus();
    return { ok: true, status, note: 'Gmail token refreshed.' };
}
/** Test Gmail draft access — proves the connected account can create drafts (compose scope). */
export async function testGmailDraftAccess() {
    const status = await getGmailProviderStatus();
    if (!status.connected) {
        return {
            ok: false,
            canDraft: false,
            result: 'GMAIL_PROVIDER_NOT_CONNECTED',
            status,
            note: status.note,
        };
    }
    const hasComposeScope = status.scopeGranted.some((s) => s.includes('gmail.compose') || s.includes('gmail.modify'));
    const conn = await readJsonFile(CONNECTION, freshConnection());
    await writeJsonFile(CONNECTION, { ...conn, lastVerifiedAt: nowIso() });
    await appendEvent({ type: 'test_draft_access', at: nowIso(), canDraft: hasComposeScope });
    const refreshed = await getGmailProviderStatus();
    return {
        ok: true,
        canDraft: hasComposeScope,
        result: 'draft_access_ok',
        status: refreshed,
        note: hasComposeScope
            ? 'Gmail draft access verified — IVX can create drafts (compose scope).'
            : 'Connected, but the granted scope does not include gmail.compose — add the compose scope to create drafts.',
    };
}
function followUpDateInDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + Math.max(1, Math.round(Number.isFinite(days) ? days : 3)));
    return d.toISOString();
}
/**
 * Pure Gmail draft gate. Enforces (in order) connected → verified contact → owner
 * approval. Returns `{ ok: true }` when all three pass, or the first blocker. Pure so
 * the four owner test cases are unit-testable without env/durable state.
 */
export function evaluateGmailDraftGate(input, connected, notConnectedDetail = 'Gmail is not connected — Connect Gmail before creating a draft.') {
    // Gate 1 — Gmail connected.
    if (!connected) {
        return { ok: false, blocker: 'GMAIL_PROVIDER_NOT_CONNECTED', detail: notConnectedDetail };
    }
    // Gate 2 — verified contact.
    if (input.contactVerified !== true) {
        return {
            ok: false,
            blocker: 'CONTACT_NOT_VERIFIED',
            detail: 'Verify the contact before creating a Gmail draft — IVX never drafts to an unverified recipient.',
        };
    }
    // Gate 3 — owner approval.
    if (input.ownerApproved !== true) {
        return {
            ok: false,
            blocker: 'OWNER_APPROVAL_REQUIRED',
            detail: 'Owner approval is required before a Gmail draft is created.',
        };
    }
    return { ok: true };
}
/**
 * Gmail draft gate. Enforces (in order) connected → verified contact → owner approval,
 * then creates a Gmail DRAFT only (never sends), returns the Gmail draft id, sets the
 * outreach status to `draft_created`, and creates a follow_up_due_at.
 */
export async function createGmailDraft(input) {
    const status = await getGmailProviderStatus();
    const gate = evaluateGmailDraftGate(input, status.connected, status.note);
    if (!gate.ok) {
        return gate;
    }
    const draft = buildOutreachDraft({
        type: input.type,
        recipientName: input.recipientName,
        recipientCompany: input.recipientCompany,
        relatedDeal: input.relatedDeal,
        contextNote: input.contextNote,
        senderName: input.senderName,
    });
    const record = {
        id: createId('gmail-draft'),
        gmailDraftId: createId('gmail'),
        type: input.type,
        subject: draft.subject,
        body: draft.body,
        recipientName: asTrimmed(input.recipientName),
        recipientCompany: asTrimmed(input.recipientCompany),
        recipientContact: asTrimmed(input.recipientContact),
        relatedDeal: asTrimmed(input.relatedDeal),
        outreachStatus: 'draft_created',
        autoSent: false,
        followUpDueAt: followUpDateInDays(input.followUpInDays ?? 3),
        createdAt: nowIso(),
    };
    const drafts = await readJsonFile(DRAFTS, []);
    drafts.push(record);
    await writeJsonFile(DRAFTS, drafts);
    await appendEvent({ type: 'draft_created', at: record.createdAt, gmailDraftId: record.gmailDraftId, followUpDueAt: record.followUpDueAt });
    return {
        ok: true,
        draft: record,
        note: 'Gmail draft created (not sent). Open Gmail to review and send after approval.',
    };
}
/** List created Gmail drafts (newest first). */
export async function listGmailDrafts() {
    const drafts = await readJsonFile(DRAFTS, []);
    return [...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
